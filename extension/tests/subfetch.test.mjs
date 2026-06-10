import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchSubtitles,
  pickShow,
  pickSubtitle,
  SubtitlesUnavailable,
} from "../lib/subfetch.js";

const SRT = Array.from(
  { length: 40 },
  (_, i) => `${i + 1}\n00:0${Math.floor(i / 10)}:${String((i * 6) % 60).padStart(2, "0")},000 --> 00:0${Math.floor(i / 10)}:${String((i * 6 + 4) % 60).padStart(2, "0")},000\nLine ${i + 1}\n`
).join("\n");

function gestdownStub({ shows, subtitles, srt = SRT }) {
  return async (url) => {
    const u = String(url);
    if (u.includes("/shows/search/")) {
      return { ok: true, status: 200, json: async () => ({ shows }) };
    }
    if (u.includes("/subtitles/get/")) {
      if (!subtitles) return { ok: false, status: 404 };
      return {
        ok: true,
        status: 200,
        json: async () => ({ matchingSubtitles: subtitles }),
      };
    }
    if (u.includes("/subtitles/download/")) {
      return { ok: true, status: 200, text: async () => srt };
    }
    throw new Error(`unexpected: ${u}`);
  };
}

test("pickShow prefers exact name match", () => {
  const shows = [
    { name: "Breaking Bad Minisodes", id: "a" },
    { name: "Breaking Bad", id: "b" },
  ];
  assert.equal(pickShow(shows, "breaking bad").id, "b");
  assert.equal(pickShow([], "x"), null);
});

test("pickSubtitle prefers corrected, then download count", () => {
  const subs = [
    { completed: true, corrected: false, downloadCount: 900, version: "A" },
    { completed: true, corrected: true, downloadCount: 100, version: "B" },
    { completed: false, corrected: true, downloadCount: 999, version: "C" },
  ];
  assert.equal(pickSubtitle(subs).version, "B");
  assert.equal(pickSubtitle([{ completed: false }]), null);
});

test("full fetch chain returns parsed cues + provenance", async () => {
  const fetchFn = gestdownStub({
    shows: [{ name: "Bakery Noir", id: "uuid-1" }],
    subtitles: [
      {
        completed: true,
        corrected: true,
        downloadCount: 50,
        version: "WEB",
        downloadUri: "/subtitles/download/xyz",
      },
    ],
  });
  const result = await fetchSubtitles(
    { showName: "Bakery Noir", season: 1, episode: 1 },
    { fetchFn }
  );
  assert.ok(result.cues.length >= 30);
  assert.match(result.provider, /Addic7ed.*WEB/);
});

test("unknown show -> SubtitlesUnavailable", async () => {
  const fetchFn = gestdownStub({ shows: [] });
  await assert.rejects(
    () => fetchSubtitles({ showName: "Nope", season: 1, episode: 1 }, { fetchFn }),
    SubtitlesUnavailable
  );
});

test("no subs for episode -> SubtitlesUnavailable", async () => {
  const fetchFn = gestdownStub({
    shows: [{ name: "Bakery Noir", id: "uuid-1" }],
    subtitles: null,
  });
  await assert.rejects(
    () =>
      fetchSubtitles({ showName: "Bakery Noir", season: 9, episode: 9 }, { fetchFn }),
    SubtitlesUnavailable
  );
});

test("corrupt download -> SubtitlesUnavailable", async () => {
  const fetchFn = gestdownStub({
    shows: [{ name: "Bakery Noir", id: "uuid-1" }],
    subtitles: [
      { completed: true, downloadUri: "/subtitles/download/xyz", version: "X" },
    ],
    srt: "<html>captcha page</html>",
  });
  await assert.rejects(
    () =>
      fetchSubtitles({ showName: "Bakery Noir", season: 1, episode: 1 }, { fetchFn }),
    SubtitlesUnavailable
  );
});
