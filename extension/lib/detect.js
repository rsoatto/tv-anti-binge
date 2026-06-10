// Best-effort show-name detection from a streaming tab's title.
// Only returns a name on confident matches; the user can always type.

// generic: true patterns ("X | Service") match too loosely to trust off-site,
// so they only apply when the tab URL is actually on a known streaming host.
const PATTERNS = [
  { re: /^Watch (.+?) \| Netflix/i, generic: false },
  { re: /^(.+?) \| Netflix/i, generic: true },
  { re: /^Prime Video: (.+)$/i, generic: false },
  { re: /^Watch (.+?) Streaming Online \| Hulu/i, generic: false },
  { re: /^(.+?) \| Hulu/i, generic: true },
  { re: /^Watch (.+?) \| Disney\+/i, generic: false },
  { re: /^(.+?) \| Disney\+/i, generic: true },
  { re: /^Watch (.+?) \| HBO Max/i, generic: false },
  { re: /^(.+?) \| (HBO )?Max$/i, generic: true },
  { re: /^Watch (.+?) - Crunchyroll/i, generic: false },
  { re: /^(.+?) - Watch on Crunchyroll/i, generic: false },
  { re: /^Watch (.+?) Season \d+ /i, generic: true },
];

const STREAMING_HOSTS = [
  "netflix.com",
  "primevideo.com",
  "amazon.com",
  "hulu.com",
  "disneyplus.com",
  "max.com",
  "hbomax.com",
  "crunchyroll.com",
  "paramountplus.com",
  "peacocktv.com",
  "tv.apple.com",
];

function cleanup(name) {
  return name
    .replace(/[:\-–—]?\s*Season \d+.*$/i, "")
    .replace(/\s*\(TV Series.*\)$/i, "")
    .trim();
}

function isStreamingHost(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return STREAMING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

// Season/episode references as streaming UIs render them:
// "S2:E5", "S02E05", "2x05", "Season 2, Ep. 5", "Season 2 Episode 5".
const EPISODE_REFS = [
  /\bS(\d{1,2})\s*[:.]?\s*E(\d{1,3})\b/i,
  /\b(\d{1,2})x(\d{1,3})\b/,
  /\bSeason\s+(\d{1,2})\s*[,:–-]?\s*(?:Episode|Ep\.?)\s*(\d{1,3})\b/i,
];

// Parse a season/episode reference out of arbitrary UI text.
// Returns {season, episode, index} or null. index = match position, so
// callers can treat the preceding text as a show-name candidate.
export function parseEpisodeRef(text) {
  if (!text) return null;
  for (const re of EPISODE_REFS) {
    const m = text.match(re);
    if (!m) continue;
    const season = parseInt(m[1], 10);
    const episode = parseInt(m[2], 10);
    if (season >= 1 && season <= 60 && episode >= 1 && episode <= 300) {
      return { season, episode, index: m.index };
    }
  }
  return null;
}

// Combine text snippets scraped from a player page (titles, overlays,
// metadata lines) into a best-effort {show, season, episode} (fields null
// when unknown). Snippets are tried in order — put the most specific first.
export function detectFromSnippets(snippets, url = "") {
  let show = null;
  let ref = null;
  for (const raw of snippets) {
    const text = (raw || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const r = parseEpisodeRef(text);
    if (r) {
      if (!ref) ref = r;
      // "Breaking Bad S2:E5 Breakage" -> show name precedes the ref.
      if (!show && r.index >= 3) {
        const before = cleanup(text.slice(0, r.index).replace(/[\s:\-–—,|·]+$/, ""));
        if (before.length >= 2 && before.length <= 80) show = before;
      }
    }
    if (!show) show = detectShow(text, url);
    if (show && ref) break;
  }
  return { show, season: ref?.season ?? null, episode: ref?.episode ?? null };
}

// Detection from Media Session metadata (navigator.mediaSession.metadata,
// read in the page's MAIN world) — what streaming sites publish for OS media
// controls. Available whenever something is playing, independent of player
// UI state, which makes it the most reliable source.
// meta: {title, artist, album} or null. Returns {show, season, episode}.
export function detectFromMediaSession(meta, url = "") {
  const none = { show: null, season: null, episode: null };
  if (!meta) return none;
  const fields = [meta.title, meta.artist, meta.album].map((t) =>
    (t || "").replace(/\s+/g, " ").trim()
  );

  // A field carrying an SxEy-style ref pins season/episode.
  let ref = null;
  let refField = -1;
  fields.forEach((t, i) => {
    if (ref) return;
    const r = parseEpisodeRef(t);
    if (r) {
      ref = r;
      refField = i;
    }
  });

  let show = null;
  if (ref && ref.index >= 3) {
    // "Breaking Bad S2:E5 Breakage" — the show precedes the ref.
    const before = cleanup(
      fields[refField].slice(0, ref.index).replace(/[\s:\-–—,|·]+$/, "")
    );
    if (before.length >= 2 && before.length <= 80) show = before;
  }
  if (!show && isStreamingHost(url)) {
    // Services usually put the show in artist (title holds the episode name).
    // Bare metadata is only trusted on known streaming hosts.
    const order = [1, 2, 0].filter((i) => i !== refField);
    show =
      order
        .map((i) => fields[i])
        .find((t) => t.length >= 2 && t.length <= 80) || null;
    if (show) show = cleanup(show);
  }
  return { show, season: ref?.season ?? null, episode: ref?.episode ?? null };
}

// Parse Netflix's internal metadata response (the player's own endpoint,
// fetched from the page session) for the playing video id.
// json shape: {video: {title, type, seasons: [{seq, episodes: [{id, seq}]}]}}
// Returns {show, season, episode} or null when unrecognizable.
export function parseNetflixMetadata(json, movieId) {
  const video = json?.video;
  if (!video || !video.title) return null;
  for (const season of video.seasons || []) {
    for (const ep of season.episodes || []) {
      if (ep.id === movieId) {
        return {
          show: video.title,
          season: season.seq ?? null,
          episode: ep.seq ?? null,
        };
      }
    }
  }
  return { show: video.title, season: null, episode: null };
}

// title: tab title; url: tab url (optional). Returns a show name or null.
export function detectShow(title, url = "") {
  if (!title) return null;
  const onStreamingSite = isStreamingHost(url);

  for (const { re, generic } of PATTERNS) {
    const m = title.match(re);
    if (!m) continue;
    if (generic && !onStreamingSite) continue;
    const name = cleanup(m[1]);
    if (name && name.length >= 2 && !/^(home|browse|netflix)$/i.test(name)) {
      return name;
    }
  }
  return null;
}
