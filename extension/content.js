// BingeBreak content script: runs on streaming sites.
//
//  1. On request from the popup, harvests timed caption cues from the page's
//     <video> text tracks (the timestamp source for stop-point analysis).
//  2. When a stop point is armed, watches playback and intervenes at the
//     computed timestamp: badge countdown -> pause + overlay; if you choose
//     to finish the episode, it pauses again just before the end so autoplay
//     never decides for you.
//
// Self-contained except for lib/guard.js (dynamically imported, listed in
// web_accessible_resources).

(async () => {
  // Re-injection guard: the popup injects this file on demand when an
  // extension reload has killed the original copy (Chrome does not re-inject
  // content scripts into open tabs on reload). Never run twice per frame.
  if (globalThis.__bingebreakLoaded) return;
  globalThis.__bingebreakLoaded = true;

  const { EpisodeGuard } = await import(chrome.runtime.getURL("lib/guard.js"));
  const { detectFromSnippets, parseEpisodeRef } = await import(
    chrome.runtime.getURL("lib/detect.js")
  );

  const MIN_EPISODE_SECONDS = 600; // ignore trailers/ads
  let guard = null;
  let guardedVideo = null;
  let armed = null; // {stopAtSeconds, durationSeconds, show, code, setAt}
  let ui = null;

  // ---------- video discovery ----------

  function pickVideo() {
    let best = null;
    for (const v of document.querySelectorAll("video")) {
      if (!Number.isFinite(v.duration) || v.duration < MIN_EPISODE_SECONDS) continue;
      if (!best || v.duration > best.duration) best = v;
    }
    return best;
  }

  // ---------- caption harvesting (popup request) ----------

  async function collectCues() {
    const video = pickVideo();
    if (!video) return { cues: [], duration: null };

    const tracks = [...video.textTracks].filter(
      (t) => t.kind === "subtitles" || t.kind === "captions"
    );
    // Cues only load for non-disabled tracks; flip to hidden and give the
    // player a moment to populate them.
    const restore = [];
    for (const t of tracks) {
      if (t.mode === "disabled") {
        restore.push(t);
        t.mode = "hidden";
      }
    }
    await new Promise((r) => setTimeout(r, 1200));

    let best = [];
    for (const t of tracks) {
      if (!t.cues) continue;
      const cues = [...t.cues].map((c) => ({
        start: c.startTime,
        end: c.endTime,
        text: (c.text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      }));
      if (cues.length > best.length) best = cues;
    }
    for (const t of restore) t.mode = "disabled";
    return { cues: best, duration: video.duration };
  }

  // ---------- show/episode detection from the player UI ----------

  // Known player metadata elements (best-effort; selectors drift, the
  // generic document.title fallback always runs last).
  const TITLE_SELECTORS = [
    '[data-uia="video-title"]', // Netflix player: "Show  S2:E5  Episode name"
    ".atvwebplayersdk-title-text", // Prime Video: show title
    ".atvwebplayersdk-subtitle-text", // Prime Video: "Season 2, Ep. 5 ..."
    '[data-testid="playback-overlay-title"]',
    '[class*="video-title"]',
    '[class*="title-field"]',
    '[class*="metadata-area"]', // Hulu player metadata block
  ];

  // Players unmount their title/metadata chrome when controls are idle —
  // which is exactly when the popup opens. A synthetic pointer move wakes
  // most players' controls (plain JS listeners don't require isTrusted).
  function wakeControls() {
    const video = pickVideo() || document.querySelector("video");
    const opts = {
      bubbles: true,
      clientX: Math.floor(innerWidth / 2),
      clientY: Math.floor(innerHeight / 2),
    };
    for (const target of [video?.parentElement, document.body, document]) {
      if (!target) continue;
      try {
        target.dispatchEvent(new PointerEvent("pointermove", opts));
        target.dispatchEvent(new MouseEvent("mousemove", opts));
      } catch {
        // some pages restrict synthetic events; harmless
      }
    }
  }

  async function detectEpisode() {
    wakeControls();
    await new Promise((r) => setTimeout(r, 450));

    const snippets = [];
    for (const sel of TITLE_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        // innerText preserves element boundaries as whitespace; textContent
        // would glue "Breaking Bad"+"S2:E5" into "Breaking BadS2:E5".
        snippets.push(el.innerText || el.textContent);
      }
    }
    // Prime splits show and "Season 2, Ep. 5" across two elements — also try
    // them joined.
    snippets.push(snippets.filter(Boolean).join(" "));

    // Selector-free net: on dedicated watch pages the visible text is mostly
    // player chrome. Any line carrying an episode ref is interesting; its
    // neighbors usually carry the show / episode name (most players stack
    // "Show" above "S2 E5 Episode name").
    const lines = (document.body?.innerText || "")
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 100)
      .slice(0, 80);
    lines.forEach((line, i) => {
      if (!parseEpisodeRef(line)) return;
      if (i > 0) snippets.push(`${lines[i - 1]} ${line}`);
      snippets.push(line);
      if (i + 1 < lines.length) snippets.push(`${line} ${lines[i + 1]}`);
    });

    snippets.push(document.title);
    return detectFromSnippets(snippets, location.href);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "collectCues") {
      collectCues().then(sendResponse);
      return true;
    }
    if (msg?.type === "detectEpisode") {
      detectEpisode().then(sendResponse);
      return true; // async response
    }
    if (msg?.type === "guardStatus") {
      sendResponse({
        armed: Boolean(armed),
        guarding: Boolean(guard && guard.state !== "done"),
        state: guard?.state || null,
      });
      return false;
    }
    return false;
  });

  // ---------- UI (shadow DOM so site CSS can't touch it) ----------

  function buildUi() {
    const host = document.createElement("div");
    host.id = "bingebreak-host";
    host.style.cssText =
      "all: initial; position: fixed; z-index: 2147483647; inset: auto 16px 16px auto;";
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      .badge {
        font: 12px/1.4 -apple-system, BlinkMacSystemFont, sans-serif;
        background: rgba(20, 21, 31, 0.92); color: #e8e8f0;
        border: 1px solid #4caf7d; border-radius: 8px;
        padding: 6px 10px; cursor: default; user-select: none;
      }
      .overlay {
        position: fixed; inset: 0; display: flex;
        align-items: center; justify-content: center;
        background: rgba(10, 10, 16, 0.82);
      }
      .card {
        font: 15px/1.5 -apple-system, BlinkMacSystemFont, sans-serif;
        background: #1e2030; color: #e8e8f0; max-width: 440px;
        border-radius: 12px; padding: 22px 24px;
        border: 1px solid #4caf7d;
      }
      .card h2 { font-size: 18px; margin: 0 0 8px; }
      .card p { color: #9a9ab0; margin: 0 0 16px; font-size: 13.5px; }
      .row { display: flex; gap: 8px; flex-wrap: wrap; }
      button {
        font: 600 13px -apple-system, sans-serif; cursor: pointer;
        border-radius: 7px; padding: 9px 14px;
        border: 1px solid #303246; background: #14151f; color: #e8e8f0;
      }
      button.primary { background: #4caf7d; border-color: #4caf7d; color: #10101a; }
    `;
    root.append(style);
    const badge = document.createElement("div");
    badge.className = "badge";
    badge.hidden = true;
    root.append(badge);
    document.documentElement.append(host);
    return { host, root, badge, overlay: null };
  }

  function mountPoint() {
    return document.fullscreenElement || document.documentElement;
  }

  function fmt(seconds) {
    const s = Math.max(0, Math.round(seconds));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  }

  function showOverlay({ title, body, buttons }) {
    removeOverlay();
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const card = document.createElement("div");
    card.className = "card";
    const h = document.createElement("h2");
    h.textContent = title;
    const p = document.createElement("p");
    p.textContent = body;
    const row = document.createElement("div");
    row.className = "row";
    for (const { label, primary, onClick } of buttons) {
      const btn = document.createElement("button");
      btn.textContent = label;
      if (primary) btn.className = "primary";
      btn.addEventListener("click", () => {
        removeOverlay();
        onClick();
      });
      row.append(btn);
    }
    card.append(h, p, row);
    overlay.append(card);
    ui.root.append(overlay);
    ui.overlay = overlay;
    // Keep the host inside the fullscreen element so the overlay is visible.
    mountPoint().append(ui.host);
  }

  function removeOverlay() {
    if (ui?.overlay) {
      ui.overlay.remove();
      ui.overlay = null;
    }
  }

  // ---------- guard wiring ----------

  function onTimeUpdate() {
    const video = guardedVideo;
    if (!guard || !video) return;
    const action = guard.check(video.currentTime);

    const remaining = guard.secondsUntilStop(video.currentTime);
    if (remaining != null && remaining < 1800) {
      ui.badge.hidden = false;
      ui.badge.textContent =
        guard.state === "finishing"
          ? `episode ends in ${fmt(remaining)}`
          : `natural stop in ${fmt(remaining)}`;
    } else {
      ui.badge.hidden = true;
    }

    if (action === "stop-point") {
      video.pause();
      showOverlay({
        title: "Natural stopping point",
        body:
          "The episode's main story has landed — what's left is the closing " +
          "hook. Stop here and tonight ends on your terms.",
        buttons: [
          {
            label: "Done for tonight",
            primary: true,
            onClick: () => {
              guard.done();
              ui.badge.hidden = true;
            },
          },
          {
            label: "+5 minutes",
            onClick: () => {
              guard.snooze(video.currentTime);
              video.play();
            },
          },
          {
            label: "Finish the episode",
            onClick: () => {
              guard.finishEpisode();
              video.play();
            },
          },
        ],
      });
    } else if (action === "episode-end") {
      video.pause();
      showOverlay({
        title: "Episode over",
        body: "Autoplay wants to choose your next hour. You don't have to let it.",
        buttons: [
          {
            label: "Done for tonight",
            primary: true,
            onClick: () => {
              guard.done();
              ui.badge.hidden = true;
            },
          },
          {
            label: "Keep watching",
            onClick: () => {
              guard.done();
              ui.badge.hidden = true;
              video.play();
            },
          },
        ],
      });
    }
  }

  function armGuard() {
    const video = pickVideo();
    if (!video || !armed) return false;
    // Sanity: the armed stop must belong to a video of similar length.
    // Subtitle timing ends at the last line of dialogue, while player
    // duration includes credits/recap — allow up to 10 minutes of slack;
    // this still rejects trailers and feature-length content.
    if (
      armed.durationSeconds &&
      Math.abs(video.duration - armed.durationSeconds) > 600
    ) {
      return false;
    }
    if (guardedVideo) {
      guardedVideo.removeEventListener("timeupdate", onTimeUpdate);
    }
    guard = new EpisodeGuard({
      durationSeconds: video.duration,
      stopAtSeconds: armed.stopAtSeconds,
    });
    guardedVideo = video;
    video.addEventListener("timeupdate", onTimeUpdate);
    return true;
  }

  async function loadArmed() {
    const { armed: stored } = await chrome.storage.local.get("armed");
    // An armed stop point is for tonight, not forever.
    if (stored && Date.now() - stored.setAt < 12 * 3600 * 1000) {
      armed = stored;
      armGuard();
    } else {
      armed = null;
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.armed) {
      armed = changes.armed.newValue || null;
      if (armed) {
        if (!armGuard()) {
          // Video not present/loaded yet — retry briefly.
          const retry = setInterval(() => {
            if (!armed || armGuard()) clearInterval(retry);
          }, 2000);
          setTimeout(() => clearInterval(retry), 60000);
        }
      } else if (guard) {
        guard.done();
        ui.badge.hidden = true;
        removeOverlay();
      }
    }
  });

  ui = buildUi();
  document.addEventListener("fullscreenchange", () => {
    mountPoint().append(ui.host);
  });
  await loadArmed();
})();
