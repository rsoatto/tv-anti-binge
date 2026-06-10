import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "../lib/planner.js";

function ep(number, risk, runtime = 45, season = 1) {
  return {
    season,
    number,
    title: `Episode ${number}`,
    runtime,
    risk,
    ending: risk <= 35 ? "clean" : risk <= 65 ? "soft_hook" : "cliffhanger",
    note: "",
    flags: [],
  };
}

test("empty input", () => {
  const plan = buildPlan([]);
  assert.deepEqual(plan.items, []);
  assert.equal(plan.stopIndex, null);
});

test("budget limits window", () => {
  const eps = [1, 2, 3, 4, 5].map((i) => ep(i, 20));
  const plan = buildPlan(eps, { budgetMinutes: 100 }); // 45m each -> 2 fit
  assert.equal(plan.items.length, 2);
  assert.equal(plan.items.at(-1).cumulativeMinutes, 90);
});

test("stops on latest clean ending", () => {
  const eps = [ep(1, 20), ep(2, 80), ep(3, 30), ep(4, 90)];
  const plan = buildPlan(eps, { budgetMinutes: 180 });
  assert.equal(plan.stopIndex, 2);
  assert.match(plan.rationale, /clean/);
});

test("falls back to soft hook", () => {
  const eps = [ep(1, 80), ep(2, 50), ep(3, 90)];
  const plan = buildPlan(eps, { budgetMinutes: 180 });
  assert.equal(plan.stopIndex, 1);
});

test("all cliffhangers picks least severe", () => {
  const eps = [ep(1, 90), ep(2, 70), ep(3, 95)];
  const plan = buildPlan(eps, { budgetMinutes: 180 });
  assert.equal(plan.stopIndex, 1);
  assert.match(plan.rationale, /cliffhanger/);
});

test("maxEpisodes cap", () => {
  const eps = Array.from({ length: 9 }, (_, i) => ep(i + 1, 20));
  const plan = buildPlan(eps, { maxEpisodes: 3 });
  assert.equal(plan.items.length, 3);
});

test("single episode over budget still included", () => {
  const plan = buildPlan([ep(1, 20, 90)], { budgetMinutes: 60 });
  assert.equal(plan.items.length, 1);
  assert.ok(plan.overflow);
});

test("next episode reported", () => {
  const eps = [ep(1, 20), ep(2, 90)];
  const plan = buildPlan(eps, { budgetMinutes: 45 });
  assert.equal(plan.stopIndex, 0);
  assert.equal(plan.nextEpisode?.number, 2);
});

test("no next episode at series end", () => {
  const plan = buildPlan([ep(1, 20)], { budgetMinutes: 200 });
  assert.equal(plan.nextEpisode, null);
});

test("default budget when nothing given", () => {
  const eps = Array.from({ length: 9 }, (_, i) => ep(i + 1, 20));
  const plan = buildPlan(eps); // default 120 min -> 2 x 45m fit
  assert.equal(plan.items.length, 2);
});
