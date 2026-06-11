import { test } from "node:test";
import assert from "node:assert/strict";
import { cosine } from "../lib/embed.js";

test("cosine basics", () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1, 0], [-1, 0]), -1);
  assert.equal(cosine([0, 0], [1, 1]), 0); // zero vector guarded
});

// embedTexts itself lives in embed-engine.js (service-worker only — it
// imports the bundled transformers.js web build, which node can't load).
// Its behavior is covered by tests/embed-live.test.mjs via the npm package
// (same library version, same model, same dtype) and by the engine-injection
// test in tests/background.test.mjs.
