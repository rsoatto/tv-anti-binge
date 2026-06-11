// Calibrate SEM_MARGIN for the bundled embedding model.
// Runs the same model/dtype the extension ships (via the npm package, which
// shares weights and code with the bundled dist) against the test fixture:
//   - matched summary (shares vocabulary)        -> margin should be high
//   - paraphrased summary (zero shared words)    -> margin should clear gate
//   - mismatched content (different story)       -> margin should fail gate
// Usage: node scripts/calibrate-margins.mjs

import { pipeline } from "@huggingface/transformers";
import { segmentScenes } from "../lib/scenes.js";
import { splitBeats, alignBeatsToScenes } from "../lib/align.js";
import { cosine } from "../lib/embed.js";
import { makeCues, SUMMARY } from "../tests/fixtures.mjs";

const MODEL = "Xenova/all-MiniLM-L6-v2";
const extractor = await pipeline("feature-extraction", MODEL, { dtype: "q8" });

async function embed(texts) {
  const out = await extractor(texts, { pooling: "mean", normalize: true });
  return out.tolist();
}

const scenes = segmentScenes(makeCues());

const PARAPHRASED =
  "A small-business owner fights to keep her struggling shop afloat as " +
  "ingredient costs explode. A police investigator looks into a break-in at " +
  "a storage facility with no leads. The owner stumbles onto secret " +
  "financial records concealed in her store. The investigator arrests the " +
  "culprit and secures proof of the scheme. Friends and neighbors gather to " +
  "toast the shop revival. In the final moments, an unknown observer lingers " +
  "outside in a vehicle, studying the shop.";

const MISMATCHED =
  "A submarine crew navigates a trench. The captain defuses a mutiny. " +
  "A storm cripples the engines. They surface near a hostile fleet. " +
  "The episode ends with torpedoes in the water.";

async function measure(label, summary) {
  const beats = splitBeats(summary);
  const all = await embed([...beats, ...scenes.map((s) => s.text)]);
  const beatVecs = all.slice(0, beats.length);
  const sceneVecs = all.slice(beats.length);
  const a = alignBeatsToScenes(beats, scenes, summary, { beatVecs, sceneVecs });
  const lastVec = beatVecs.at(-1);
  const cosRow = sceneVecs.map((sv) => cosine(lastVec, sv));
  const rowMean = cosRow.reduce((x, y) => x + y, 0) / cosRow.length;
  const margin = cosRow[a.assignment.at(-1)] - rowMean;
  console.log(
    label.padEnd(24),
    "lastBeat->scene",
    a.assignment.at(-1),
    "| margin",
    margin.toFixed(3),
    "| conf",
    a.confidence.toFixed(2),
    "| evidenceOk",
    a.evidenceOk
  );
}

console.log(`model: ${MODEL} (q8)`);
await measure("matched summary", SUMMARY);
await measure("paraphrased (no words)", PARAPHRASED);
await measure("mismatched content", MISMATCHED);
