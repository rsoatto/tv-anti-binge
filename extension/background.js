// BingeBreak service worker. Fully offline-scoring: no LLM, no API tokens.
//
//  - "stoppoint": the core feature — given subtitle cues for the episode
//    you're watching, segment scenes from real timestamps, align the known
//    plot summary (Wikipedia episode article when one exists, TVMaze synopsis
//    otherwise) to those scenes, and return the natural in-episode stop.
//  - "plan"/"analyze"/"seasons": episode-level structural views (TVMaze data).
//
// Results cache in chrome.storage.local.

import * as tvmaze from "./lib/tvmaze.js";
import * as heuristics from "./lib/heuristics.js";
import * as wiki from "./lib/wiki.js";
import { segmentScenes } from "./lib/scenes.js";
import { splitBeats, alignBeatsToScenes, chooseStopPoint } from "./lib/align.js";
import { buildPlan } from "./lib/planner.js";
import { EMBED_MODEL, EmbedUnavailable } from "./lib/embed.js";
import { fetchSubtitles, SubtitlesUnavailable } from "./lib/subfetch.js";

// The embedding engine is injected by sw.js (it imports the bundled
// transformers.js, which node can't load — this module stays node-testable).
let embedTextsImpl = null;
export function setEmbedEngine(fn) {
  embedTextsImpl = fn;
}

const SHOW_TTL_MS = 7 * 24 * 3600 * 1000;
const WIKI_TTL_MS = 30 * 24 * 3600 * 1000;

async function cacheGet(key, ttlMs) {
  const wrapper = (await chrome.storage.local.get(key))[key];
  if (!wrapper) return null;
  if (ttlMs != null && Date.now() - wrapper.storedAt > ttlMs) return null;
  return wrapper.value;
}

async function cacheSet(key, value) {
  await chrome.storage.local.set({ [key]: { storedAt: Date.now(), value } });
}

async function fetchShow(query, refresh) {
  const key = `show_${query.toLowerCase().trim()}`;
  if (!refresh) {
    const cached = await cacheGet(key, SHOW_TTL_MS);
    if (cached) return cached;
  }
  const show = await tvmaze.getShow(query);
  await cacheSet(key, show);
  return show;
}

function scoreEpisodes(show, episodes) {
  return episodes.map((ep) => ({
    ...ep,
    ...heuristics.scoreEpisode(ep, show.episodes, show.genres),
    note: "",
  }));
}

// ---------- in-episode stop point ----------

async function fetchPlotSummary(show, episode, refresh) {
  const key = `wiki_${show.id}_s${episode.season}e${episode.number}`;
  if (!refresh) {
    const cached = await cacheGet(key, WIKI_TTL_MS);
    if (cached) return cached; // may be {text: null} = "known absent"
  }
  let result = null;
  try {
    result = await wiki.fetchEpisodePlot(show.name, episode.title);
  } catch {
    // network/API failure -> just use TVMaze synopsis, don't cache failure
    return { text: null, source: null };
  }
  const value = result || { text: null, source: null };
  await cacheSet(key, value);
  return value;
}

const SUBS_TTL_MS = 30 * 24 * 3600 * 1000;

async function handleStopPoint({
  query,
  season,
  episode,
  cues = null,
  duration = null,
  refresh = false,
  onProgress = () => {},
}) {
  onProgress("Looking up the episode…", 20);
  const show = await fetchShow(query, refresh);
  const ep = show.episodes.find(
    (e) => e.season === season && e.number === episode
  );
  if (!ep) throw new Error(`S${season}E${episode} not found for ${show.name}.`);

  // Caption source chain: cues passed in (player tracks or a user-picked
  // file) > cached download > fresh automatic download (Addic7ed/Gestdown).
  let captionSource = "this tab's player captions";
  if (!cues || cues.length < 30) {
    const subsKey = `subs_${show.id}_s${season}e${episode}`;
    const cached = refresh ? null : await cacheGet(subsKey, SUBS_TTL_MS);
    if (cached) {
      cues = cached.cues;
      captionSource = `${cached.provider} (cached)`;
    } else {
      onProgress("Downloading community subtitles…", 40);
      const fetched = await fetchSubtitles({
        showName: show.name,
        season,
        episode,
      }); // throws SubtitlesUnavailable -> popup offers the file picker
      cues = fetched.cues;
      captionSource = fetched.provider;
      await cacheSet(subsKey, fetched);
    }
  } else if (duration == null) {
    captionSource = "subtitle file";
  }

  const scenes = segmentScenes(cues);
  if (scenes.length < 3) {
    throw new Error(
      "Could not find scene structure in these captions (too few dialogue breaks)."
    );
  }

  // Known plot summaries: Wikipedia episode article >> TVMaze synopsis.
  onProgress("Fetching the plot summary…", 55);
  const wikiPlot = await fetchPlotSummary(show, ep, refresh);
  const summaryText = wikiPlot.text || ep.summary || "";
  const summarySource = wikiPlot.text
    ? `Wikipedia ("${wikiPlot.title}", Plot section)`
    : ep.summary
      ? "TVMaze episode synopsis"
      : null;

  const beats = summaryText ? splitBeats(summaryText) : [];

  // Semantic layer: the bundled embedding model bridges the paraphrase gap
  // between summary prose and dialogue. Falls back to lexical matching
  // (and says so) if the model can't load — e.g. first run while offline.
  let vectors = null;
  let embedNote = "";
  if (beats.length) {
    try {
      if (!embedTextsImpl) throw new EmbedUnavailable("embedding engine not loaded");
      onProgress("Matching plot to scenes (on-device model)…", 70);
      // Stall watchdog: if the engine makes no progress for 60s (dead
      // download, wedged runtime), give up and fall back to lexical —
      // a hang is never an acceptable outcome.
      const texts = [...beats, ...scenes.map((s) => s.text)];
      const all = await new Promise((resolve, reject) => {
        let timer;
        const arm = () => {
          clearTimeout(timer);
          timer = setTimeout(
            () =>
              reject(
                new EmbedUnavailable("embedding timed out (no progress for 60s)")
              ),
            60000
          );
        };
        arm();
        embedTextsImpl(texts, {
          onProgress: (label) => {
            arm();
            onProgress(label, 72);
          },
        }).then(
          (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          (e) => {
            clearTimeout(timer);
            reject(e);
          }
        );
      });
      vectors = {
        beatVecs: all.slice(0, beats.length),
        sceneVecs: all.slice(beats.length),
      };
    } catch (err) {
      if (!(err instanceof EmbedUnavailable)) throw err;
      embedNote = err.message;
    }
  }

  onProgress("Choosing the stop point…", 90);
  const alignment = beats.length
    ? alignBeatsToScenes(beats, scenes, summaryText, vectors || {})
    : null;

  const totalDuration =
    duration || cues[cues.length - 1].end;
  const stop = chooseStopPoint({ scenes, alignment, duration: totalDuration });
  if (!stop) {
    throw new Error("No usable scene break found late in this episode.");
  }

  // Spoiler safety: beat texts never leave the worker — only timestamps.
  return {
    show: { id: show.id, name: show.name },
    episode: { season: ep.season, number: ep.number, title: ep.title },
    stopAtSeconds: Math.round(stop.stopAtSeconds),
    durationSeconds: Math.round(totalDuration),
    basis: stop.basis,
    confidence: Number(stop.confidence.toFixed(2)),
    summarySource,
    captionSource,
    sceneCount: scenes.length,
    engine: vectors
      ? `on-device embeddings (${EMBED_MODEL}, bundled) + lexical`
      : "lexical word-overlap",
    embedNote,
    candidates: stop.candidates.map((c) => ({
      time: Math.round(c.time),
      gapSeconds: Math.round(c.gapSeconds),
    })),
  };
}

// ---------- episode-level views ----------

async function handlePlan({
  query,
  season = 1,
  episode = 1,
  minutes = null,
  maxEpisodes = null,
  refresh = false,
}) {
  const show = await fetchShow(query, refresh);
  const fromStart = show.episodes.filter(
    (e) => e.season > season || (e.season === season && e.number >= episode)
  );
  if (!fromStart.length) {
    throw new Error("No episodes at or after that starting point.");
  }

  let budget = minutes;
  if (budget == null && maxEpisodes == null) budget = 120;

  let lookahead;
  if (maxEpisodes != null) {
    lookahead = maxEpisodes + 1;
  } else {
    lookahead = 1;
    let total = 0;
    for (const e of fromStart) {
      total += e.runtime;
      if (total > budget) break;
      lookahead += 1;
    }
    lookahead += 1;
  }
  const window = fromStart.slice(0, lookahead);
  const scored = scoreEpisodes(show, window);
  const plan = buildPlan(scored, { budgetMinutes: budget, maxEpisodes });
  return {
    show: { id: show.id, name: show.name, premiered: show.premiered },
    plan,
    budgetMinutes: budget,
    source: "structural heuristics (genre, finales, two-parters) — fully offline",
  };
}

async function handleAnalyze({ query, season, refresh = false }) {
  const show = await fetchShow(query, refresh);
  let episodes = show.episodes;
  if (season != null) {
    episodes = episodes.filter((e) => e.season === season);
    if (!episodes.length) throw new Error(`No episodes found for season ${season}.`);
  }
  return {
    show: { id: show.id, name: show.name, premiered: show.premiered },
    episodes: scoreEpisodes(show, episodes),
    source: "structural heuristics (genre, finales, two-parters) — fully offline",
  };
}

async function handleSeasons({ query }) {
  const show = await fetchShow(query, false);
  const seasons = [...new Set(show.episodes.map((e) => e.season))].sort(
    (a, b) => a - b
  );
  return { name: show.name, seasons };
}

// Exported for the node integration tests (tests/background.test.mjs).
export const HANDLERS = {
  stoppoint: handleStopPoint,
  plan: handlePlan,
  analyze: handleAnalyze,
  seasons: handleSeasons,
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = HANDLERS[msg?.type];
  if (!handler) {
    sendResponse({ ok: false, error: `unknown message type: ${msg?.type}` });
    return false;
  }
  handler(msg)
    .then((value) => sendResponse({ ok: true, value }))
    .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
  return true; // keep the message channel open for the async response
});

// Long-lived port for the stop-point flow so the popup can render progress.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "stoppoint") return;
  port.onMessage.addListener(async (msg) => {
    const post = (m) => {
      try {
        port.postMessage(m);
      } catch {
        // popup closed mid-run; keep working so caches stay warm
      }
    };
    try {
      const value = await handleStopPoint({
        ...msg,
        onProgress: (stage, pct) => post({ progress: stage, pct }),
      });
      post({ done: true, value });
    } catch (err) {
      post({
        done: true,
        error: err.message || String(err),
        needsCaptions: err instanceof SubtitlesUnavailable,
      });
    }
  });
});
