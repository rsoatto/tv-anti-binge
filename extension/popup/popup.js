import {
  detectShow,
  detectFromMediaSession,
  parseNetflixMetadata,
} from "../lib/detect.js";
import { parseSubtitles } from "../lib/subtitles.js";

const $ = (id) => document.getElementById(id);

const els = {
  form: $("controls"),
  show: $("show"),
  season: $("season"),
  episode: $("episode"),
  minutes: $("minutes"),
  stopBtn: $("stop-btn"),
  planBtn: $("plan-btn"),
  analyzeBtn: $("analyze-btn"),
  subFile: $("sub-file"),
  status: $("status"),
  results: $("results"),
  source: $("source"),
  progress: $("progress"),
  progressLabel: $("progress-label"),
  barFill: $("bar-fill"),
  captionsPrompt: $("captions-prompt"),
  pickFile: $("pick-file"),
};

function setProgress(label, pct) {
  if (label == null) {
    els.progress.hidden = true;
    els.barFill.style.width = "0%";
    return;
  }
  els.progress.hidden = false;
  els.progressLabel.textContent = label;
  els.barFill.style.width = `${pct}%`;
}

function send(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!resp?.ok) {
        reject(new Error(resp?.error || "unknown error"));
      } else {
        resolve(resp.value);
      }
    });
  });
}

function sendToTab(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(resp);
    });
  });
}

// Message the tab's content script; if it's gone (extension was reloaded
// after the tab opened — Chrome doesn't re-inject), inject it and retry.
// Works on the active tab thanks to the activeTab grant from opening the
// popup; content.js itself refuses to double-run.
async function askTab(tabId, msg) {
  const first = await sendToTab(tabId, msg);
  if (first !== null) return first;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content.js"],
    });
  } catch {
    return null; // not a page we can script (chrome://, other sites, …)
  }
  await new Promise((r) => setTimeout(r, 250));
  return sendToTab(tabId, msg);
}

function setStatus(text, isError = false) {
  els.status.hidden = !text;
  els.status.textContent = text || "";
  els.status.classList.toggle("error", isError);
}

function setBusy(busy) {
  for (const b of [els.stopBtn, els.planBtn, els.analyzeBtn]) b.disabled = busy;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function epCode(ep) {
  const pad = (n) => String(n).padStart(2, "0");
  return `S${pad(ep.season)}E${pad(ep.number)}`;
}

function fmtTime(seconds) {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function readInputs() {
  return {
    query: els.show.value.trim(),
    season: parseInt(els.season.value, 10) || 1,
    episode: parseInt(els.episode.value, 10) || 1,
    minutes: parseInt(els.minutes.value, 10) || 120,
  };
}

// What the currently displayed result was computed for. Anything rendered
// for other inputs is stale and must not linger on screen.
let rendered = null; // {query, season, episode, canonicalShow}

function markRendered(inputs, result) {
  rendered = {
    query: (inputs.query || "").toLowerCase(),
    season: inputs.season,
    episode: inputs.episode,
    canonicalShow: (result?.show?.name || "").toLowerCase(),
  };
}

function clearIfStale() {
  if (!rendered) return;
  const now = readInputs();
  const q = now.query.toLowerCase();
  const sameShow = q === rendered.query || q === rendered.canonicalShow;
  if (sameShow && now.season === rendered.season && now.episode === rendered.episode) {
    return;
  }
  rendered = null;
  els.results.replaceChildren();
  els.source.hidden = true;
  els.captionsPrompt.hidden = true;
  setStatus("");
}

// ---------- stop point flow ----------

async function getCuesFromTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  const resp = await askTab(tab.id, { type: "collectCues" });
  if (resp?.cues?.length >= 30) return resp;
  return null;
}

// Explicit user action only — never auto-opened. Resolves null on cancel
// (the 'cancel' event fires when the user dismisses the dialog).
function getCuesFromFile() {
  return new Promise((resolve) => {
    const input = els.subFile;
    const finish = (val) => {
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
      input.value = "";
      resolve(val);
    };
    const onChange = async () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      const cues = parseSubtitles(await file.text());
      finish(cues.length ? { cues, duration: null } : null);
    };
    const onCancel = () => finish(null);
    input.addEventListener("change", onChange, { once: true });
    input.addEventListener("cancel", onCancel, { once: true });
    input.click();
  });
}

// Run the stop-point pipeline over a progress port. cues may be null —
// the worker then downloads community subtitles itself.
function runStopPoint(payload, onProgress) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: "stoppoint" });
    port.onMessage.addListener((msg) => {
      if (msg.progress) onProgress(msg.progress, msg.pct ?? 50);
      if (msg.done) {
        port.disconnect();
        if (msg.error) {
          const err = new Error(msg.error);
          err.needsCaptions = Boolean(msg.needsCaptions);
          reject(err);
        } else {
          resolve(msg.value);
        }
      }
    });
    port.onDisconnect.addListener(() => {
      reject(new Error("The analysis was interrupted — try again."));
    });
    port.postMessage(payload);
  });
}

async function findStopPoint(fileCues = null) {
  const inputs = readInputs();
  if (!inputs.query) return;
  setBusy(true);
  setStatus("");
  els.captionsPrompt.hidden = true;
  els.results.replaceChildren();
  els.source.hidden = true;

  try {
    let timed = fileCues;
    if (!timed) {
      setProgress("Checking this tab for caption tracks…", 8);
      timed = await getCuesFromTab(); // null on most players; that's fine
    }

    const result = await runStopPoint(
      {
        type: "stoppoint",
        query: inputs.query,
        season: inputs.season,
        episode: inputs.episode,
        cues: timed?.cues ?? null,
        duration: timed?.duration ?? null,
      },
      setProgress
    );
    setProgress("Done", 100);
    setTimeout(() => setProgress(null), 350);
    renderStopPoint(result);
    markRendered(inputs, result);
    await chrome.storage.local.set({
      ui_state: { ...inputs, lastAction: "stoppoint", lastResult: result },
    });
  } catch (err) {
    setProgress(null);
    if (err.needsCaptions) {
      // Automatic sources failed: explain and offer the file picker —
      // visible inline, opened only when clicked.
      setStatus(err.message, true);
      els.captionsPrompt.hidden = false;
    } else {
      setStatus(err.message, true);
    }
  } finally {
    setBusy(false);
  }
}

const BASIS_LABEL = {
  "plot-aligned":
    "the scene break right before the episode's closing plot beat begins",
  "scene-break": "the strongest real scene break late in the episode",
};

function renderStopPoint(result) {
  els.results.replaceChildren();
  const { episode, stopAtSeconds, durationSeconds, basis, confidence } = result;

  els.results.append(
    el(
      "div",
      "season-head",
      `${result.show.name} ${epCode(episode)} — “${episode.title}”`
    )
  );

  const big = el("div", "stop-time");
  big.append(
    el("div", "stop-clock", fmtTime(stopAtSeconds)),
    el(
      "div",
      "stop-sub",
      `natural stop · episode runs ${fmtTime(durationSeconds)}`
    )
  );
  els.results.append(big);

  els.results.append(
    el(
      "div",
      "verdict",
      `This is ${BASIS_LABEL[basis]}. Everything after it is the part ` +
        "engineered to pull you into the next episode."
    )
  );

  if (result.candidates?.length > 1) {
    const alts = result.candidates
      .filter((c) => Math.abs(c.time - stopAtSeconds) > 30)
      .map((c) => `${fmtTime(c.time)} (${c.gapSeconds}s break)`)
      .join(" · ");
    if (alts) {
      els.results.append(el("div", "bonus", `Other measured scene breaks: ${alts}`));
    }
  }

  const armBtn = el("button", "primary arm-btn", "");
  const setArmedUi = (isArmed) => {
    armBtn.classList.toggle("armed", isArmed);
    armBtn.textContent = isArmed
      ? `Guard armed — pauses at ${fmtTime(stopAtSeconds)} (click to disarm)`
      : "Arm the guard at this point";
  };
  armBtn.addEventListener("click", async () => {
    const isArmed = armBtn.classList.contains("armed");
    if (isArmed) {
      await chrome.storage.local.remove("armed");
    } else {
      await chrome.storage.local.set({
        armed: {
          stopAtSeconds,
          durationSeconds,
          show: result.show.name,
          code: epCode(episode),
          setAt: Date.now(),
        },
      });
    }
    setArmedUi(!isArmed);
  });
  setArmedUi(false);
  els.results.append(armBtn);
  // Reflect reality on reopen: the guard may already be armed for this stop.
  chrome.storage.local.get("armed").then(({ armed }) => {
    const fresh = armed && Date.now() - armed.setAt < 12 * 3600 * 1000;
    if (
      fresh &&
      armed.show === result.show.name &&
      armed.code === epCode(episode) &&
      armed.stopAtSeconds === stopAtSeconds
    ) {
      setArmedUi(true);
    }
  });

  els.source.hidden = false;
  els.source.textContent =
    `timestamps: ${result.sceneCount} scenes from ${result.captionSource || "captions"} · ` +
    `plot: ${result.summarySource || "none available"} · ` +
    `matching: ${result.engine || "lexical"} · confidence: ${confidence}` +
    (result.embedNote ? ` · ${result.embedNote}` : "");
}

// ---------- episode-level views (unchanged behavior) ----------

const TIER_LABEL = {
  clean: "clean break",
  soft_hook: "mild hook",
  cliffhanger: "cliffhanger",
};

function epRow(ep, { minsText = null, extraClass = "" } = {}) {
  const row = el("div", `ep-row ${extraClass}`.trim());
  row.append(
    el("span", "ep-code", epCode(ep)),
    el("span", `chip ${ep.ending}`, TIER_LABEL[ep.ending] || ep.ending),
    el("span", "ep-title", ep.title),
    el("span", "ep-mins", minsText ?? `${ep.runtime}m · risk ${ep.risk}`)
  );
  return row;
}

function noteFor(ep) {
  return ep.flags?.length ? ep.flags.join("; ") : "";
}

function renderPlan(result) {
  els.results.replaceChildren();
  const { plan, show, budgetMinutes } = result;
  if (!plan.items.length) {
    setStatus("No episodes found from that starting point.", true);
    return;
  }
  els.results.append(
    el("div", "season-head", `${show.name} — tonight (${budgetMinutes} min budget)`)
  );
  plan.items.forEach((item, i) => {
    const included = i <= plan.stopIndex;
    els.results.append(
      epRow(item.episode, {
        minsText: `${item.episode.runtime}m · total ${item.cumulativeMinutes}m`,
        extraClass: i === plan.stopIndex ? "stop" : included ? "" : "excluded",
      })
    );
    const note = noteFor(item.episode);
    if (note && included) els.results.append(el("div", "ep-note", note));
  });
  const stopItem = plan.items[plan.stopIndex];
  els.results.append(
    el(
      "div",
      "verdict",
      `Last episode tonight: ${epCode(stopItem.episode)} (${plan.rationale}). ` +
        `Open it and hit "Find tonight's stop point" for the exact timestamp.`
    )
  );
  els.source.hidden = false;
  els.source.textContent = `scores from: ${result.source}`;
}

function renderAnalysis(result) {
  els.results.replaceChildren();
  const { episodes, show } = result;
  let currentSeason = null;
  for (const ep of episodes) {
    if (ep.season !== currentSeason) {
      currentSeason = ep.season;
      els.results.append(
        el("div", "season-head", `${show.name} — Season ${currentSeason}`)
      );
    }
    els.results.append(epRow(ep));
    const note = noteFor(ep);
    if (note) els.results.append(el("div", "ep-note", note));
  }
  els.source.hidden = false;
  els.source.textContent = `scores from: ${result.source}`;
}

async function run(action) {
  const inputs = readInputs();
  if (!inputs.query) return;
  setBusy(true);
  setStatus("Looking up episodes…");
  els.results.replaceChildren();
  els.source.hidden = true;
  try {
    let result;
    if (action === "plan") {
      result = await send({ type: "plan", ...inputs });
      setStatus("");
      renderPlan(result);
    } else {
      result = await send({ type: "analyze", query: inputs.query, season: inputs.season });
      setStatus("");
      renderAnalysis(result);
    }
    markRendered(inputs, result);
    await chrome.storage.local.set({
      ui_state: { ...inputs, lastAction: action, lastResult: result },
    });
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    setBusy(false);
  }
}

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  findStopPoint();
});
els.planBtn.addEventListener("click", () => run("plan"));
els.analyzeBtn.addEventListener("click", () => run("analyze"));
els.pickFile.addEventListener("click", async () => {
  const timed = await getCuesFromFile();
  if (timed) {
    els.captionsPrompt.hidden = true;
    findStopPoint(timed);
  }
  // cancel: prompt stays visible, nothing hangs
});
$("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

// Read the page's Media Session metadata (MAIN world — the content script's
// isolated world can't see what the page set).
async function getMediaSession(tabId) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const m = navigator.mediaSession && navigator.mediaSession.metadata;
        return m
          ? { title: m.title || "", artist: m.artist || "", album: m.album || "" }
          : null;
      },
    });
    return res?.[0]?.result ?? null;
  } catch {
    return null; // page not scriptable
  }
}

// Netflix-specific: ask Netflix's own metadata endpoint (from the page's
// MAIN world, with the page's session) about the video id in the watch URL.
// Works regardless of player UI state; Netflix sets no media-session
// metadata and unmounts its title overlay with the controls.
async function getNetflixInfo(tabId) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async () => {
        try {
          const m = location.pathname.match(/^\/watch\/(\d+)/);
          if (!m) return null;
          const movieId = parseInt(m[1], 10);
          // Verified current endpoint (2026-06): the "release" alias needs no
          // build id. Legacy shakti path kept as fallback.
          const build =
            window.netflix?.reactContext?.models?.serverDefs?.data
              ?.BUILD_IDENTIFIER;
          const paths = [
            `/nq/website/memberapi/release/metadata?movieid=${movieId}`,
            build ? `/api/shakti/${build}/metadata?movieid=${movieId}` : null,
          ].filter(Boolean);
          for (const path of paths) {
            const resp = await fetch(path, { credentials: "include" });
            if (resp.ok) return { movieId, data: await resp.json() };
          }
          return { movieId, data: null };
        } catch {
          return null;
        }
      },
    });
    const out = res?.[0]?.result;
    if (!out?.data) return null;
    return parseNetflixMetadata(out.data, out.movieId);
  } catch {
    return null;
  }
}

async function init() {
  // Restoring old state must never block detection (stale stored shapes
  // from previous extension versions could throw during render).
  try {
    const { ui_state: state } = await chrome.storage.local.get("ui_state");
    if (state) {
      els.show.value = state.query || "";
      els.season.value = state.season || 1;
      els.episode.value = state.episode || 1;
      els.minutes.value = state.minutes || 120;
      if (state.lastResult) {
        if (state.lastAction === "stoppoint") renderStopPoint(state.lastResult);
        else if (state.lastAction === "plan") renderPlan(state.lastResult);
        else if (state.lastAction === "analyze") renderAnalysis(state.lastResult);
        markRendered(state, state.lastResult);
      }
    }
  } catch {
    els.results.replaceChildren();
  }

  // Prefill from the active tab. Sources, most to least specific:
  // player UI text (content script) > media-session metadata > tab title.
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    const onNetflix = /(^|\.)netflix\.com$/.test(
      (() => {
        try {
          return new URL(tab.url || "").hostname.replace(/^www\./, "");
        } catch {
          return "";
        }
      })()
    );
    const [nfInfo, fromPage, msMeta] = await Promise.all([
      onNetflix ? getNetflixInfo(tab.id) : Promise.resolve(null),
      askTab(tab.id, { type: "detectEpisode" }),
      getMediaSession(tab.id),
    ]);
    const fromMs = detectFromMediaSession(msMeta, tab.url || "");
    const detected = {
      show:
        nfInfo?.show ??
        fromPage?.show ??
        fromMs.show ??
        detectShow(tab.title || "", tab.url || ""),
      season: nfInfo?.season ?? fromPage?.season ?? fromMs.season ?? null,
      episode: nfInfo?.episode ?? fromPage?.episode ?? fromMs.episode ?? null,
    };
    if (detected.show) {
      const differentShow =
        rendered &&
        detected.show.toLowerCase() !== rendered.query &&
        detected.show.toLowerCase() !== rendered.canonicalShow;
      els.show.value = detected.show;
      // New show: stale episode numbers must not carry over from the last one.
      els.season.value = detected.season ?? (differentShow ? 1 : els.season.value);
      els.episode.value = detected.episode ?? (differentShow ? 1 : els.episode.value);
      clearIfStale();
      const epBit =
        detected.season && detected.episode
          ? ` S${detected.season}E${detected.episode}`
          : "";
      setStatus(`Detected ${detected.show}${epBit} from this tab.`);
      if (differentShow) {
        // Don't resurrect the old show's result on the next open either.
        await chrome.storage.local.set({
          ui_state: { ...readInputs(), lastAction: null, lastResult: null },
        });
      }
    } else {
      // Nothing detected: say what each source actually returned so failures
      // are diagnosable instead of silent.
      const parts = [];
      if (onNetflix) parts.push(`netflix api: ${nfInfo?.show || "none"}`);
      parts.push(
        `player UI: ${fromPage ? fromPage.show || "responded, no title text" : "no content script reply"}`
      );
      parts.push(
        `media session: ${msMeta ? `"${(msMeta.title || "").slice(0, 30)}" / "${(msMeta.artist || "").slice(0, 30)}"` : "none"}`
      );
      parts.push(`tab title: "${(tab.title || "").slice(0, 40)}"`);
      setStatus(`No show detected — ${parts.join(" · ")}`);
      console.warn("bingebreak detection debug", { nfInfo, fromPage, msMeta, tab });
    }
  } catch (err) {
    setStatus(`Detection error: ${err.message}`, true);
  }
}

for (const field of [els.show, els.season, els.episode]) {
  field.addEventListener("input", clearIfStale);
}

init();
