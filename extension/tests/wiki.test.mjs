import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractPlotSection,
  pickEpisodeArticle,
  fetchEpisodePlot,
} from "../lib/wiki.js";

const LONG_PLOT = "Walter wakes in the desert and stumbles toward the road. ".repeat(8);

const EXTRACT = `Ozymandias is the fourteenth episode of the fifth season.

== Plot ==
${LONG_PLOT}

== Production ==
The episode was written by Moira Walley-Beckett.
`;

test("extractPlotSection pulls the Plot body only", () => {
  const plot = extractPlotSection(EXTRACT);
  assert.ok(plot.startsWith("Walter wakes in the desert"));
  assert.ok(!plot.includes("Production"));
  assert.ok(!plot.includes("Moira"));
});

test("extractPlotSection keeps multi-paragraph plots intact", () => {
  // Regression: a multiline-$ lookahead once truncated this to paragraph one.
  const para = "A long paragraph about the episode that runs on. ".repeat(4);
  const extract = `Intro.\n\n== Plot ==\n${para}\n\n${para}\n\n== Reception ==\nGood.`;
  const plot = extractPlotSection(extract);
  assert.ok(plot.length > para.length, "second paragraph must be included");
  assert.ok(!plot.includes("Reception"));
});

test("extractPlotSection works when Plot is the last section", () => {
  const para = "Closing section paragraph with plenty of content here. ".repeat(5);
  const plot = extractPlotSection(`Intro.\n\n== Plot ==\n${para}`);
  assert.ok(plot && plot.length >= 200);
});

test("extractPlotSection rejects missing/short sections", () => {
  assert.equal(extractPlotSection("No sections here at all."), null);
  assert.equal(extractPlotSection("== Plot ==\nToo short.\n== Next =="), null);
  assert.equal(extractPlotSection(null), null);
});

test("pickEpisodeArticle prefers the episode's own page", () => {
  const results = [
    { title: "Breaking Bad season 5", pageid: 1 },
    { title: "Ozymandias (Breaking Bad)", pageid: 2 },
  ];
  const hit = pickEpisodeArticle(results, "Ozymandias", "Breaking Bad");
  assert.equal(hit.pageid, 2);
  assert.equal(pickEpisodeArticle(results, "Granite State", "Breaking Bad"), null);
});

test("fetchEpisodePlot end-to-end with stubbed fetch", async () => {
  const fetchFn = async (url) => {
    const u = String(url);
    assert.ok(u.includes("en.wikipedia.org"));
    assert.ok(u.includes("origin=*"));
    if (u.includes("list=search")) {
      return {
        ok: true,
        json: async () => ({
          query: {
            search: [{ title: "Ozymandias (Breaking Bad)", pageid: 42 }],
          },
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        query: { pages: { 42: { extract: EXTRACT } } },
      }),
    };
  };
  const plot = await fetchEpisodePlot("Breaking Bad", "Ozymandias", fetchFn);
  assert.equal(plot.source, "wikipedia");
  assert.equal(plot.title, "Ozymandias (Breaking Bad)");
  assert.ok(plot.text.includes("desert"));
});

test("fetchEpisodePlot returns null when no article matches", async () => {
  const fetchFn = async () => ({
    ok: true,
    json: async () => ({ query: { search: [] } }),
  });
  assert.equal(await fetchEpisodePlot("Some Show", "Some Episode", fetchFn), null);
});
