// Live tests of the real embedding model — the same model/dtype the
// extension bundles, run via the npm package (identical library version).
// First run downloads ~25 MB of weights; auto-skips when that fails
// (e.g. offline CI).
import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentScenes } from "../lib/scenes.js";
import {
  splitBeats,
  alignBeatsToScenes,
  chooseStopPoint,
} from "../lib/align.js";
import { EMBED_MODEL } from "../lib/embed.js";
import { makeCues, SUMMARY, DURATION } from "./fixtures.mjs";

let extractor = null;
try {
  const { pipeline } = await import("@huggingface/transformers");
  extractor = await pipeline("feature-extraction", EMBED_MODEL, { dtype: "q8" });
} catch {
  // model unavailable (offline / no dev deps) -> skip the live tests
}
const up = Boolean(extractor);

async function embed(texts) {
  const out = await extractor(texts, { pooling: "mean", normalize: true });
  return out.tolist();
}

const PARAPHRASED =
  "A small-business owner fights to keep her struggling shop afloat as " +
  "ingredient costs explode. A police investigator looks into a break-in at " +
  "a storage facility with no leads. The owner stumbles onto secret " +
  "financial records concealed in her store. The investigator arrests the " +
  "culprit and secures proof of the scheme. Friends and neighbors gather to " +
  "toast the shop revival. In the final moments, an unknown observer lingers " +
  "outside in a vehicle, studying the shop.";

async function alignWithModel(summary) {
  const scenes = segmentScenes(makeCues());
  const beats = splitBeats(summary);
  const all = await embed([...beats, ...scenes.map((s) => s.text)]);
  const alignment = alignBeatsToScenes(beats, scenes, summary, {
    beatVecs: all.slice(0, beats.length),
    sceneVecs: all.slice(beats.length),
  });
  return { scenes, alignment };
}

test("model rescues the zero-overlap paraphrase", { skip: !up }, async () => {
  const { scenes, alignment } = await alignWithModel(PARAPHRASED);

  // Lexical alone fails on this summary...
  const lex = alignBeatsToScenes(splitBeats(PARAPHRASED), scenes, PARAPHRASED);
  assert.equal(
    chooseStopPoint({ scenes, alignment: lex, duration: DURATION }).basis,
    "scene-break"
  );

  // ...the bundled model finds the right closing scene.
  assert.equal(alignment.assignment.at(-1), 5);
  assert.ok(alignment.evidenceOk, "semantic evidence should pass");
  const stop = chooseStopPoint({ scenes, alignment, duration: DURATION });
  assert.equal(stop.basis, "plot-aligned");
  assert.ok(stop.stopAtSeconds >= 2300 && stop.stopAtSeconds <= 2320);
});

test("model still refuses mismatched content", { skip: !up }, async () => {
  const wrong =
    "A submarine crew navigates a trench. The captain defuses a mutiny. " +
    "A storm cripples the engines. They surface near a hostile fleet. " +
    "The episode ends with torpedoes in the water.";
  const { scenes, alignment } = await alignWithModel(wrong);
  assert.equal(alignment.evidenceOk, false, "mean-margin gate must reject");
  const stop = chooseStopPoint({ scenes, alignment, duration: DURATION });
  assert.equal(stop.basis, "scene-break");
});

test("matched summary stays plot-aligned with the model on", { skip: !up }, async () => {
  const { scenes, alignment } = await alignWithModel(SUMMARY);
  const stop = chooseStopPoint({ scenes, alignment, duration: DURATION });
  assert.equal(stop.basis, "plot-aligned");
  assert.ok(alignment.confidence > 0.5);
});
