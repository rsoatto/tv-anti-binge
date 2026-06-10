import { test } from "node:test";
import assert from "node:assert/strict";
import { stripHtml, normalizeShow } from "../lib/tvmaze.js";

test("stripHtml", () => {
  assert.equal(stripHtml("<p>Walt &amp; Jesse cook.</p>"), "Walt & Jesse cook.");
  assert.equal(stripHtml(null), "");
  assert.equal(stripHtml(""), "");
  assert.equal(stripHtml("<b>It&#39;s here</b>"), "It's here");
});

const SAMPLE = {
  id: 169,
  name: "Breaking Bad",
  premiered: "2008-01-20",
  status: "Ended",
  genres: ["Drama", "Crime", "Thriller"],
  averageRuntime: 60,
  _embedded: {
    episodes: [
      {
        id: 2,
        season: 1,
        number: 2,
        name: "Cat's in the Bag...",
        runtime: 48,
        airdate: "2008-01-27",
        summary: "<p>Cleanup time.</p>",
        type: "regular",
      },
      {
        id: 1,
        season: 1,
        number: 1,
        name: "Pilot",
        runtime: null,
        airdate: "2008-01-20",
        summary: null,
        type: "regular",
      },
      {
        id: 99,
        season: 1,
        number: null, // unnumbered special: dropped
        name: "Special",
        runtime: 30,
        airdate: "",
        summary: "",
        type: "insignificant_special",
      },
    ],
  },
};

test("normalizeShow sorts, drops specials, falls back runtime", () => {
  const show = normalizeShow(SAMPLE);
  assert.equal(show.name, "Breaking Bad");
  assert.equal(show.premiered, "2008");
  assert.deepEqual(
    show.episodes.map((e) => e.number),
    [1, 2]
  );
  assert.equal(show.episodes[0].runtime, 60); // null -> averageRuntime
  assert.equal(show.episodes[1].summary, "Cleanup time.");
});
