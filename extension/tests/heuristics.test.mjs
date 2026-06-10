import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreEpisode, tier } from "../lib/heuristics.js";

function ep(season, number, title = "Episode", summary = "") {
  return { season, number, title, summary, runtime: 45 };
}

function season(nEps, s = 1, titles = {}) {
  return Array.from({ length: nEps }, (_, i) =>
    ep(s, i + 1, titles[i + 1] || `Episode ${i + 1}`)
  );
}

test("tier boundaries", () => {
  assert.equal(tier(35), "clean");
  assert.equal(tier(36), "soft_hook");
  assert.equal(tier(65), "soft_hook");
  assert.equal(tier(66), "cliffhanger");
});

test("part one is high risk", () => {
  const eps = season(10, 1, { 5: "The Heist (Part 1)", 6: "The Heist (Part 2)" });
  const result = scoreEpisode(eps[4], eps, ["Comedy"]);
  assert.ok(result.risk >= 85);
  assert.ok(result.flags.some((f) => f.includes("multi-part")));
});

test("part two is treated as resolution", () => {
  const eps = season(10, 1, { 5: "The Heist (Part 1)", 6: "The Heist (Part 2)" });
  const part1 = scoreEpisode(eps[4], eps, ["Drama"]);
  const part2 = scoreEpisode(eps[5], eps, ["Drama"]);
  assert.ok(part2.risk < part1.risk);
  assert.ok(part2.flags.some((f) => f.includes("conclusion")));
});

test("'to be continued' in summary", () => {
  const eps = season(10);
  eps[2].summary = "A quiet day at the office. To be continued...";
  const result = scoreEpisode(eps[2], eps, ["Comedy"]);
  assert.ok(result.risk >= 85);
});

test("finale of continuing show flagged and riskier", () => {
  const eps = [...season(10, 1), ...season(10, 2)];
  const mid = scoreEpisode(eps[4], eps, ["Drama"]);
  const finale = scoreEpisode(eps[9], eps, ["Drama"]);
  assert.ok(finale.flags.includes("season finale"));
  assert.ok(finale.risk > mid.risk);
});

test("final-season finale not inflated", () => {
  const eps = season(10, 1);
  const finale = scoreEpisode(eps[9], eps, ["Drama"]);
  const mid = scoreEpisode(eps[4], eps, ["Drama"]);
  assert.ok(finale.flags.includes("season finale"));
  assert.equal(finale.risk, mid.risk);
});

test("comedy lower base than thriller", () => {
  const eps = season(10);
  const comedy = scoreEpisode(eps[2], eps, ["Comedy"]);
  const thriller = scoreEpisode(eps[2], eps, ["Thriller"]);
  assert.ok(comedy.risk < thriller.risk);
});

test("cross-season two-parter (TNG Best of Both Worlds)", () => {
  const eps = [...season(26, 3), ...season(26, 4)];
  eps[25].title = "The Best of Both Worlds";
  eps[26].title = "The Best of Both Worlds, Part II";
  const finale = scoreEpisode(eps[25], eps, ["Science-Fiction"]);
  assert.ok(finale.risk >= 85);
  assert.ok(finale.flags.some((f) => f.includes("multi-part")));
});

test("plain 'Finale' title not marked as conclusion", () => {
  const eps = season(10, 1, { 10: "Finale" });
  const result = scoreEpisode(eps[9], eps, ["Comedy"]);
  assert.ok(!result.flags.some((f) => f.includes("conclusion")));
});

test("risk clamped to [5, 95]", () => {
  const eps = season(3, 1, { 2: "Doom (Part 1)" });
  eps[1].summary = "Kidnapped! Betrayal! Cliffhanger! To be continued.";
  const result = scoreEpisode(eps[1], eps, ["Thriller"]);
  assert.ok(result.risk >= 5 && result.risk <= 95);
});
