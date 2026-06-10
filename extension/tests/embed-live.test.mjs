// Live tests against the local Ollama server + nomic-embed-text.
// Auto-skip when the server isn't running, so the suite stays green anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { embedTexts, embedServerUp } from "../lib/embed.js";
import { segmentScenes } from "../lib/scenes.js";
import {
  splitBeats,
  alignBeatsToScenes,
  chooseStopPoint,
} from "../lib/align.js";
import { makeCues, SUMMARY, DURATION } from "./fixtures.mjs";

const up = await embedServerUp();

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
  const all = await embedTexts([...beats, ...scenes.map((s) => s.text)]);
  const alignment = alignBeatsToScenes(beats, scenes, summary, {
    beatVecs: all.slice(0, beats.length),
    sceneVecs: all.slice(beats.length),
  });
  return { scenes, alignment };
}

test("embedTexts returns one vector per input", { skip: !up }, async () => {
  const vecs = await embedTexts(["hello there", "general kenobi"]);
  assert.equal(vecs.length, 2);
  assert.ok(vecs[0].length >= 256);
  assert.equal(vecs[0].length, vecs[1].length);
});

test(
  "live model rescues the zero-overlap paraphrase (the LLM payoff)",
  { skip: !up },
  async () => {
    const { scenes, alignment } = await alignWithModel(PARAPHRASED);

    // Lexical alone fails on this summary...
    const lex = alignBeatsToScenes(splitBeats(PARAPHRASED), scenes, PARAPHRASED);
    assert.equal(
      chooseStopPoint({ scenes, alignment: lex, duration: DURATION }).basis,
      "scene-break"
    );

    // ...the local model finds the right closing scene.
    assert.equal(alignment.assignment.at(-1), 5);
    assert.ok(alignment.evidenceOk, "semantic evidence should pass");
    const stop = chooseStopPoint({ scenes, alignment, duration: DURATION });
    assert.equal(stop.basis, "plot-aligned");
    assert.ok(stop.stopAtSeconds >= 2300 && stop.stopAtSeconds <= 2320);
  }
);

test(
  "live model still refuses mismatched content",
  { skip: !up },
  async () => {
    const wrong =
      "A submarine crew navigates a trench. The captain defuses a mutiny. " +
      "A storm cripples the engines. They surface near a hostile fleet. " +
      "The episode ends with torpedoes in the water.";
    const { scenes, alignment } = await alignWithModel(wrong);
    const stop = chooseStopPoint({ scenes, alignment, duration: DURATION });
    assert.equal(stop.basis, "scene-break");
  }
);

test(
  "matched original summary stays plot-aligned with the model on",
  { skip: !up },
  async () => {
    const { scenes, alignment } = await alignWithModel(SUMMARY);
    const stop = chooseStopPoint({ scenes, alignment, duration: DURATION });
    assert.equal(stop.basis, "plot-aligned");
    assert.ok(alignment.confidence > 0.5);
  }
);
