import { test } from "node:test";
import assert from "node:assert/strict";
import { EpisodeGuard, END_BLOCK_SECONDS } from "../lib/guard.js";

const DURATION = 2520;

test("triggers once at the stop point", () => {
  const g = new EpisodeGuard({ durationSeconds: DURATION, stopAtSeconds: 2300 });
  assert.equal(g.check(2000), null);
  assert.equal(g.check(2299), null);
  assert.equal(g.check(2301), "stop-point");
  assert.equal(g.check(2305), null); // no re-trigger
});

test("snooze re-triggers after the snooze window", () => {
  const g = new EpisodeGuard({ durationSeconds: DURATION, stopAtSeconds: 2300 });
  g.check(2301);
  g.snooze(2301, 100); // until 2401, inside the end block
  assert.equal(g.check(2350), null);
  assert.equal(g.check(2400.5), null);
  assert.equal(g.check(2401), "stop-point");
});

test("snooze never escapes the end block", () => {
  const g = new EpisodeGuard({ durationSeconds: DURATION, stopAtSeconds: 2490 });
  g.check(2492);
  g.snooze(2492, 600); // would land past the end
  assert.ok(g.snoozeUntil <= DURATION - END_BLOCK_SECONDS);
});

test("finish episode arms the end block (autoplay defense)", () => {
  const g = new EpisodeGuard({ durationSeconds: DURATION, stopAtSeconds: 2300 });
  g.check(2301);
  g.finishEpisode();
  assert.equal(g.check(2400), null);
  assert.equal(g.check(DURATION - END_BLOCK_SECONDS), "episode-end");
  assert.equal(g.check(DURATION - 1), null); // terminal
});

test("done silences everything", () => {
  const g = new EpisodeGuard({ durationSeconds: DURATION, stopAtSeconds: 2300 });
  g.check(2301);
  g.done();
  assert.equal(g.check(2500), null);
  assert.equal(g.secondsUntilStop(2500), null);
});

test("stop point clamped inside the episode", () => {
  const g = new EpisodeGuard({ durationSeconds: DURATION, stopAtSeconds: 99999 });
  assert.ok(g.stopAt <= DURATION - END_BLOCK_SECONDS);
});

test("countdown reports seconds until next intervention", () => {
  const g = new EpisodeGuard({ durationSeconds: DURATION, stopAtSeconds: 2300 });
  assert.equal(g.secondsUntilStop(2200), 100);
  g.check(2301);
  g.finishEpisode();
  assert.equal(
    g.secondsUntilStop(2400),
    DURATION - END_BLOCK_SECONDS - 2400
  );
});
