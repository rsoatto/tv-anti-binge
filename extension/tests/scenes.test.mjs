import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentScenes, boundaries } from "../lib/scenes.js";

function cue(start, end, text = "talk") {
  return { start, end, text };
}

test("splits on gaps >= threshold", () => {
  const cues = [
    cue(0, 2),
    cue(3, 5),
    cue(20, 22), // 15s gap -> new scene
    cue(23, 25),
    cue(60, 62), // 35s gap -> new scene
  ];
  const scenes = segmentScenes(cues, 8);
  assert.equal(scenes.length, 3);
  assert.equal(scenes[0].start, 0);
  assert.equal(scenes[0].end, 5);
  assert.equal(scenes[1].gapBefore, 15);
  assert.equal(scenes[2].gapBefore, 35);
});

test("ignores sound-effect cues for timing", () => {
  const cues = [
    cue(0, 2),
    cue(10, 12, ""), // empty text: doesn't bridge the gap
    cue(20, 22),
  ];
  const scenes = segmentScenes(cues, 8);
  assert.equal(scenes.length, 2);
});

test("boundaries expose transition times and gaps", () => {
  const cues = [cue(0, 5), cue(30, 35), cue(70, 75)];
  const scenes = segmentScenes(cues, 8);
  const bounds = boundaries(scenes);
  assert.equal(bounds.length, 2);
  assert.equal(bounds[0].time, 5);
  assert.equal(bounds[0].gapSeconds, 25);
  assert.equal(bounds[1].sceneIndex, 2);
});

test("empty input", () => {
  assert.deepEqual(segmentScenes([]), []);
});
