// Automatic subtitle fetching via Gestdown (https://api.gestdown.info), a
// keyless REST proxy for Addic7ed's community subtitles. Single host, no
// auth. Used when the player doesn't expose caption tracks, so the user
// never has to hunt for an .srt by hand.
//
// Caveat: community subs are timed for broadcast/rip cuts and can be offset
// a few seconds from a streaming player. Scene-break analysis tolerates
// this; the guard's duration sanity check (±4 min) catches gross mismatches.

import { parseSubtitles } from "./subtitles.js";

const API = "https://api.gestdown.info";

export class SubtitlesUnavailable extends Error {}

async function getJson(path, fetchFn) {
  let resp;
  try {
    resp = await fetchFn(`${API}${path}`, { signal: AbortSignal.timeout(15000) });
  } catch (err) {
    throw new SubtitlesUnavailable(`subtitle service unreachable (${err.message})`);
  }
  if (resp.status === 404) return null;
  if (!resp.ok) {
    throw new SubtitlesUnavailable(`subtitle service error: HTTP ${resp.status}`);
  }
  return resp.json();
}

export function pickShow(shows, showName) {
  if (!shows?.length) return null;
  const wanted = showName.toLowerCase().trim();
  return (
    shows.find((s) => s.name.toLowerCase() === wanted) ||
    shows.find((s) => s.name.toLowerCase().startsWith(wanted)) ||
    shows[0]
  );
}

// Prefer completed + corrected subs, then the most-downloaded (a community
// proxy for "well-synced").
export function pickSubtitle(subtitles) {
  const usable = (subtitles || []).filter((s) => s.completed);
  if (!usable.length) return null;
  return usable.sort(
    (a, b) =>
      (b.corrected === true) - (a.corrected === true) ||
      (b.downloadCount || 0) - (a.downloadCount || 0)
  )[0];
}

// Returns {cues, provider, version} or throws SubtitlesUnavailable.
export async function fetchSubtitles(
  { showName, season, episode, language = "English" },
  { fetchFn = fetch } = {}
) {
  const search = await getJson(
    `/shows/search/${encodeURIComponent(showName)}`,
    fetchFn
  );
  const show = pickShow(search?.shows, showName);
  if (!show) {
    throw new SubtitlesUnavailable(`no subtitles indexed for "${showName}"`);
  }

  const listing = await getJson(
    `/subtitles/get/${show.id}/${season}/${episode}/${language}`,
    fetchFn
  );
  const sub = pickSubtitle(listing?.matchingSubtitles);
  if (!sub) {
    throw new SubtitlesUnavailable(
      `no ${language} subtitles found for ${show.name} S${season}E${episode}`
    );
  }

  let resp;
  try {
    resp = await fetchFn(`${API}${sub.downloadUri}`, {
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new SubtitlesUnavailable(`subtitle download failed (${err.message})`);
  }
  if (!resp.ok) {
    throw new SubtitlesUnavailable(`subtitle download failed: HTTP ${resp.status}`);
  }
  const cues = parseSubtitles(await resp.text());
  if (cues.length < 30) {
    throw new SubtitlesUnavailable("downloaded subtitle file looks empty/corrupt");
  }
  return {
    cues,
    provider: `Addic7ed via Gestdown (${sub.version || "unknown"} sync)`,
  };
}
