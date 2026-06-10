// Integration test: the service worker pipeline with stubbed chrome.* and
// fetch — no Chrome, no network, no API keys anywhere.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { makeCues, SUMMARY } from "./fixtures.mjs";

const store = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        return { [key]: store[key] };
      },
      async set(obj) {
        Object.assign(store, obj);
      },
    },
  },
  runtime: {
    onMessage: { addListener() {} },
    onConnect: { addListener() {} },
  },
};

const SHOW_FIXTURE = {
  id: 1,
  name: "Bakery Noir",
  premiered: "2020-01-01",
  status: "Ended",
  genres: ["Drama"],
  averageRuntime: 42,
  _embedded: {
    episodes: [
      {
        id: 11,
        season: 1,
        number: 1,
        name: "The Ledger",
        runtime: 42,
        airdate: "",
        summary: "<p>Marta finds a ledger; Reyes investigates a robbery.</p>",
        type: "regular",
      },
      { id: 12, season: 1, number: 2, name: "Crumbs", runtime: 42, airdate: "", summary: "", type: "regular" },
      { id: 13, season: 1, number: 3, name: "Proof (Part 1)", runtime: 42, airdate: "", summary: "", type: "regular" },
      { id: 14, season: 1, number: 4, name: "Proof (Part 2)", runtime: 42, airdate: "", summary: "", type: "regular" },
    ],
  },
};

const WIKI_EXTRACT = `The Ledger is the pilot episode.\n\n== Plot ==\n${SUMMARY}\n\n== Production ==\nStuff.\n`;

// Serialize fixture cues to SRT so the auto-download path is exercised
// through the real parser.
function toSrt(cues) {
  const ts = (s) => {
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const sec = String(Math.floor(s % 60)).padStart(2, "0");
    return `${h}:${m}:${sec},000`;
  };
  return cues
    .map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`)
    .join("\n");
}

let gestdownHasSubs = true;

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("api.tvmaze.com")) {
    return { ok: true, status: 200, json: async () => SHOW_FIXTURE };
  }
  if (u.includes("api.gestdown.info")) {
    if (u.includes("/shows/search/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ shows: [{ name: "Bakery Noir", id: "uuid-1" }] }),
      };
    }
    if (u.includes("/subtitles/get/")) {
      if (!gestdownHasSubs) return { ok: false, status: 404 };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          matchingSubtitles: [
            {
              completed: true,
              corrected: true,
              downloadCount: 10,
              version: "WEB",
              downloadUri: "/subtitles/download/abc",
            },
          ],
        }),
      };
    }
    if (u.includes("/subtitles/download/")) {
      return { ok: true, status: 200, text: async () => toSrt(makeCues()) };
    }
  }
  if (u.includes("en.wikipedia.org")) {
    if (u.includes("list=search")) {
      return {
        ok: true,
        json: async () => ({
          query: { search: [{ title: "The Ledger (Bakery Noir)", pageid: 7 }] },
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({ query: { pages: { 7: { extract: WIKI_EXTRACT } } } }),
    };
  }
  throw new Error(`unexpected fetch: ${u}`);
};

let HANDLERS;
before(async () => {
  ({ HANDLERS } = await import("../background.js"));
});

test("stoppoint: plot-aligned stop from cues + wikipedia summary", async () => {
  const result = await HANDLERS.stoppoint({
    query: "bakery noir",
    season: 1,
    episode: 1,
    cues: makeCues(),
    duration: 2520,
  });
  assert.equal(result.basis, "plot-aligned");
  assert.ok(
    result.stopAtSeconds >= 2300 && result.stopAtSeconds <= 2320,
    String(result.stopAtSeconds)
  );
  assert.match(result.summarySource, /Wikipedia/);
  assert.ok(result.sceneCount >= 5);
  assert.ok(result.candidates.length >= 1);
  // Spoiler safety: no summary text in the payload.
  const flat = JSON.stringify(result);
  assert.ok(!flat.includes("stranger"));
  assert.ok(!flat.includes("ledger"));
});

test("stoppoint: no cues -> auto-downloads subtitles, reports progress", async () => {
  const stages = [];
  const result = await HANDLERS.stoppoint({
    query: "bakery noir",
    season: 1,
    episode: 1,
    cues: null,
    onProgress: (label, pct) => stages.push([label, pct]),
  });
  assert.match(result.captionSource, /Addic7ed.*WEB/);
  assert.equal(result.basis, "plot-aligned");
  assert.ok(stages.some(([l]) => /subtitles/i.test(l)));
  assert.ok(stages.every(([, p]) => p >= 0 && p <= 100));

  // Second run hits the subtitle cache.
  const again = await HANDLERS.stoppoint({
    query: "bakery noir",
    season: 1,
    episode: 1,
  });
  assert.match(again.captionSource, /cached/);
});

test("stoppoint: no cues anywhere -> SubtitlesUnavailable surfaces", async () => {
  gestdownHasSubs = false;
  await assert.rejects(
    () => HANDLERS.stoppoint({ query: "bakery noir", season: 1, episode: 2 }),
    (err) => err.constructor.name === "SubtitlesUnavailable"
  );
  gestdownHasSubs = true;
});

test("stoppoint: unknown episode errors", async () => {
  await assert.rejects(
    () =>
      HANDLERS.stoppoint({
        query: "bakery noir",
        season: 9,
        episode: 9,
        cues: makeCues(),
      }),
    /S9E9 not found/
  );
});

test("plan: episode-level night plan still works, offline source", async () => {
  const result = await HANDLERS.plan({
    query: "bakery noir",
    season: 1,
    episode: 1,
    minutes: 130, // 3 x 42m fit
  });
  assert.equal(result.plan.items.length, 3);
  // E3 is "Proof (Part 1)" — high risk; planner stops earlier.
  assert.ok(result.plan.stopIndex < 2);
  assert.match(result.source, /offline/);
  assert.ok(!("llmNote" in result));
});

test("analyze: two-parter flagged, fully offline", async () => {
  const result = await HANDLERS.analyze({ query: "bakery noir", season: 1 });
  const part1 = result.episodes.find((e) => e.number === 3);
  assert.equal(part1.ending, "cliffhanger");
});

test("seasons listing", async () => {
  const result = await HANDLERS.seasons({ query: "bakery noir" });
  assert.deepEqual(result.seasons, [1]);
});
