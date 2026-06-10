import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectShow,
  parseEpisodeRef,
  detectFromSnippets,
  detectFromMediaSession,
  parseNetflixMetadata,
} from "../lib/detect.js";

test("netflix title page", () => {
  assert.equal(
    detectShow("Watch Breaking Bad | Netflix Official Site", "https://www.netflix.com/title/70143836"),
    "Breaking Bad"
  );
});

test("generic netflix pattern only trusted on netflix.com", () => {
  assert.equal(
    detectShow("Dark | Netflix", "https://www.netflix.com/browse"),
    "Dark"
  );
  assert.equal(detectShow("Dark | Netflix", "https://evil.example.com/"), null);
});

test("prime video", () => {
  assert.equal(
    detectShow("Prime Video: The Boys", "https://www.primevideo.com/detail/x"),
    "The Boys"
  );
});

test("season suffix stripped", () => {
  assert.equal(
    detectShow("Watch Severance | Disney+", "https://www.disneyplus.com/x"),
    "Severance"
  );
  assert.equal(
    detectShow(
      "Watch The Bear Season 2 Streaming Online | Hulu",
      "https://www.hulu.com/series/the-bear"
    ),
    "The Bear"
  );
});

test("no match returns null", () => {
  assert.equal(detectShow("Gmail - Inbox", "https://mail.google.com/"), null);
  assert.equal(detectShow("", ""), null);
  assert.equal(detectShow("Netflix", "https://www.netflix.com/"), null);
});

test("parseEpisodeRef handles common formats", () => {
  assert.deepEqual(parseEpisodeRef("Breaking Bad S2:E5 Breakage"), {
    season: 2,
    episode: 5,
    index: 13,
  });
  assert.partialDeepStrictEqual(parseEpisodeRef("S02E05"), { season: 2, episode: 5 });
  assert.partialDeepStrictEqual(parseEpisodeRef("now playing 2x05"), {
    season: 2,
    episode: 5,
  });
  assert.partialDeepStrictEqual(parseEpisodeRef("Season 2, Ep. 5 — Breakage"), {
    season: 2,
    episode: 5,
  });
  assert.partialDeepStrictEqual(parseEpisodeRef("Season 2 Episode 5"), {
    season: 2,
    episode: 5,
  });
  assert.equal(parseEpisodeRef("nothing here"), null);
  assert.equal(parseEpisodeRef("error 404x500 page"), null); // out of range
});

test("detectFromSnippets: Netflix-style combined title", () => {
  const got = detectFromSnippets(
    ["Breaking Bad S2:E5 Breakage", "Netflix"],
    "https://www.netflix.com/watch/70196252"
  );
  assert.deepEqual(got, { show: "Breaking Bad", season: 2, episode: 5 });
});

test("detectFromSnippets: Prime-style split elements", () => {
  const got = detectFromSnippets(
    ["The Boys", "Season 2, Ep. 5 We Gotta Go Now", "The Boys Season 2, Ep. 5 We Gotta Go Now", "Prime Video: The Boys"],
    "https://www.primevideo.com/detail/x"
  );
  assert.equal(got.show, "The Boys");
  assert.equal(got.season, 2);
  assert.equal(got.episode, 5);
});

const NETFLIX_URL = "https://www.netflix.com/watch/70196252";

test("parseNetflixMetadata: finds season/episode by video id", () => {
  const json = {
    video: {
      title: "Breaking Bad",
      type: "show",
      seasons: [
        { seq: 1, episodes: [{ id: 70196243, seq: 1 }, { id: 70196244, seq: 2 }] },
        { seq: 2, episodes: [{ id: 70196251, seq: 4 }, { id: 70196252, seq: 5 }] },
      ],
    },
  };
  assert.deepEqual(parseNetflixMetadata(json, 70196252), {
    show: "Breaking Bad",
    season: 2,
    episode: 5,
  });
});

test("parseNetflixMetadata: movie / unknown id still yields the title", () => {
  assert.deepEqual(
    parseNetflixMetadata({ video: { title: "The Irishman", type: "movie" } }, 1),
    { show: "The Irishman", season: null, episode: null }
  );
  assert.equal(parseNetflixMetadata({ video: {} }, 1), null);
  assert.equal(parseNetflixMetadata(null, 1), null);
});

test("mediaSession: episode ref in one field, show in another", () => {
  const got = detectFromMediaSession(
    { title: "Breaking Bad", artist: "S2:E5 Breakage", album: "" },
    NETFLIX_URL
  );
  assert.deepEqual(got, { show: "Breaking Bad", season: 2, episode: 5 });
});

test("mediaSession: combined field with show before the ref", () => {
  const got = detectFromMediaSession(
    { title: "The Bear S3:E2 Next", artist: "", album: "" },
    "https://www.hulu.com/watch/abc"
  );
  assert.deepEqual(got, { show: "The Bear", season: 3, episode: 2 });
});

test("mediaSession: no ref -> artist preferred as show on streaming hosts", () => {
  const got = detectFromMediaSession(
    { title: "Pilot", artist: "Breaking Bad", album: "" },
    NETFLIX_URL
  );
  assert.equal(got.show, "Breaking Bad");
  assert.equal(got.season, null);
});

test("mediaSession: bare metadata not trusted off streaming hosts", () => {
  const got = detectFromMediaSession(
    { title: "Some Song", artist: "Some Artist", album: "" },
    "https://music.example.com/"
  );
  assert.equal(got.show, null);
});

test("mediaSession: null metadata", () => {
  assert.deepEqual(detectFromMediaSession(null, NETFLIX_URL), {
    show: null,
    season: null,
    episode: null,
  });
});

test("detectFromSnippets: title-only page still finds the show", () => {
  const got = detectFromSnippets(
    ["Watch Severance | Disney+"],
    "https://www.disneyplus.com/x"
  );
  assert.equal(got.show, "Severance");
  assert.equal(got.season, null);
});
