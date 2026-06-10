import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentScenes } from "../lib/scenes.js";
import {
  splitBeats,
  alignBeatsToScenes,
  chooseStopPoint,
} from "../lib/align.js";

import { makeCues, SUMMARY, DURATION } from "./fixtures.mjs";

test("splitBeats splits sentences and merges fragments", () => {
  const beats = splitBeats("First thing happens. Then more. Wow. A third development occurs at the docks.");
  assert.ok(beats.length >= 2);
  assert.ok(beats.every((b) => b.length >= 10));
});

test("alignment is monotonic and tracks plot order", () => {
  const scenes = segmentScenes(makeCues());
  assert.equal(scenes.length, 6);
  const beats = splitBeats(SUMMARY);
  const alignment = alignBeatsToScenes(beats, scenes, SUMMARY);
  assert.ok(alignment);
  for (let i = 1; i < alignment.assignment.length; i++) {
    assert.ok(alignment.assignment[i] >= alignment.assignment[i - 1]);
  }
  // The final beat (stranger in the parked car) lands on the final scene.
  assert.equal(alignment.assignment.at(-1), 5);
  assert.ok(alignment.confidence > 0.35, `confidence ${alignment.confidence}`);
});

test("stop point = scene break before the closing beat (plot-aligned)", () => {
  const scenes = segmentScenes(makeCues());
  const beats = splitBeats(SUMMARY);
  const alignment = alignBeatsToScenes(beats, scenes, SUMMARY);
  const stop = chooseStopPoint({ scenes, alignment, duration: DURATION });
  assert.equal(stop.basis, "plot-aligned");
  // Scene 6 starts at 2340, previous scene ends 2300: stop right after 2300.
  assert.ok(stop.stopAtSeconds >= 2300 && stop.stopAtSeconds <= 2320, String(stop.stopAtSeconds));
});

test("unrelatable summary falls back to measured scene break", () => {
  const scenes = segmentScenes(makeCues());
  const beats = splitBeats("Zebra quantum tractor philosophy. Unrelated nonsense entirely.");
  const alignment = alignBeatsToScenes(beats, scenes, "Zebra quantum tractor.");
  const stop = chooseStopPoint({ scenes, alignment, duration: DURATION });
  assert.equal(stop.basis, "scene-break");
  // Largest late dialogue gap is the 40s break before the final scene.
  assert.ok(stop.stopAtSeconds >= 2300 && stop.stopAtSeconds <= 2320);
});

test("closing beat matching an early scene is rejected (back-half sanity)", () => {
  const scenes = segmentScenes(makeCues());
  // Summary whose "ending" describes scene 2 — alignment would point early.
  const earlySummary =
    "Detective Reyes investigates the warehouse robbery downtown. The episode " +
    "ends with Reyes asking about witnesses and missing security footage.";
  const beats = splitBeats(earlySummary);
  const alignment = alignBeatsToScenes(beats, scenes, earlySummary);
  const stop = chooseStopPoint({ scenes, alignment, duration: DURATION });
  assert.equal(stop.basis, "scene-break");
});

test("single-word coincidence in the final beat is not an alignment", () => {
  // Regression: a 1-beat TVMaze synopsis sharing one word ("everyone") with a
  // late scene once produced a confident bogus "plot-aligned" stop.
  const scenes = segmentScenes(makeCues());
  const summary =
    "People deal with consequences. Things develop further. " +
    "More events transpire steadily. Everyone copes with changed circumstances.";
  const beats = splitBeats(summary);
  const alignment = alignBeatsToScenes(beats, scenes, summary);
  const stop = chooseStopPoint({ scenes, alignment, duration: DURATION });
  assert.equal(stop.basis, "scene-break");
});

test("short synopses (under 3 beats) never claim plot alignment", () => {
  const scenes = segmentScenes(makeCues());
  const summary = "A stranger watches the bakery from a parked car, holding a photograph.";
  const alignment = alignBeatsToScenes(splitBeats(summary), scenes, summary);
  const stop = chooseStopPoint({ scenes, alignment, duration: DURATION });
  assert.equal(stop.basis, "scene-break");
});

// ---------- semantic layer (stubbed vectors; live model in embed-live) ----------

// Paraphrased summary sharing NO content words with the dialogue — lexical
// matching is blind here, semantic vectors are not.
const PARAPHRASED =
  "A small-business owner fights to keep her struggling enterprise afloat as " +
  "ingredient costs explode. A police investigator looks into a break-in at " +
  "a storage facility. The owner stumbles onto secret financial records. The " +
  "investigator arrests the culprit and secures proof. Friends gather to " +
  "toast the revival. In the final moments, an unknown observer lingers " +
  "outside in a vehicle.";

// Topic-axis stub vectors: beat i and scene i point the same direction.
function topicVec(axis, dims = 8) {
  const v = new Array(dims).fill(0.1);
  v[axis] = 1;
  return v;
}

test("semantic vectors rescue a zero-overlap paraphrase", () => {
  const scenes = segmentScenes(makeCues());
  const beats = splitBeats(PARAPHRASED);
  assert.equal(beats.length, 6);
  const beatVecs = beats.map((_, i) => topicVec(i));
  const sceneVecs = scenes.map((_, j) => topicVec(j));

  // Lexical-only: no evidence, falls back.
  const lex = alignBeatsToScenes(beats, scenes, PARAPHRASED);
  const lexStop = chooseStopPoint({ scenes, alignment: lex, duration: DURATION });
  assert.equal(lexStop.basis, "scene-break");

  // With vectors: plot-aligned at the break before the final scene.
  const sem = alignBeatsToScenes(beats, scenes, PARAPHRASED, { beatVecs, sceneVecs });
  assert.equal(sem.engine, "semantic+lexical");
  assert.equal(sem.assignment.at(-1), 5);
  assert.ok(sem.evidenceOk);
  const semStop = chooseStopPoint({ scenes, alignment: sem, duration: DURATION });
  assert.equal(semStop.basis, "plot-aligned");
  assert.ok(semStop.stopAtSeconds >= 2300 && semStop.stopAtSeconds <= 2320);
});

test("uninformative vectors (no margin) do not fake evidence", () => {
  const scenes = segmentScenes(makeCues());
  const beats = splitBeats(PARAPHRASED);
  const flat = new Array(8).fill(0.5); // every cosine identical -> margin 0
  const sem = alignBeatsToScenes(beats, scenes, PARAPHRASED, {
    beatVecs: beats.map(() => flat),
    sceneVecs: scenes.map(() => flat),
  });
  assert.equal(sem.evidenceOk, false);
  const stop = chooseStopPoint({ scenes, alignment: sem, duration: DURATION });
  assert.equal(stop.basis, "scene-break");
});

test("mismatched vector lengths are ignored, not crashed on", () => {
  const scenes = segmentScenes(makeCues());
  const beats = splitBeats(PARAPHRASED);
  const sem = alignBeatsToScenes(beats, scenes, PARAPHRASED, {
    beatVecs: [topicVec(0)], // wrong length
    sceneVecs: scenes.map((_, j) => topicVec(j)),
  });
  assert.equal(sem.engine, "lexical");
});

test("no alignment at all still yields a measured stop", () => {
  const scenes = segmentScenes(makeCues());
  const stop = chooseStopPoint({ scenes, alignment: null, duration: DURATION });
  assert.equal(stop.basis, "scene-break");
  assert.ok(stop.candidates.length >= 1);
});
