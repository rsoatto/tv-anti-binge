import { test } from "node:test";
import assert from "node:assert/strict";
import { embedTexts, cosine, EmbedUnavailable } from "../lib/embed.js";

test("cosine basics", () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1, 0], [-1, 0]), -1);
  assert.equal(cosine([0, 0], [1, 1]), 0); // zero vector guarded
});

test("403 maps to an actionable OLLAMA_ORIGINS message", async () => {
  const fetchFn = async () => ({ status: 403, ok: false });
  await assert.rejects(
    () => embedTexts(["x"], { fetchFn }),
    (err) => err instanceof EmbedUnavailable && /OLLAMA_ORIGINS/.test(err.message)
  );
});

test("404 maps to a pull-the-model message", async () => {
  const fetchFn = async () => ({ status: 404, ok: false });
  await assert.rejects(
    () => embedTexts(["x"], { fetchFn }),
    (err) => err instanceof EmbedUnavailable && /ollama pull/.test(err.message)
  );
});

test("connection failure maps to EmbedUnavailable", async () => {
  const fetchFn = async () => {
    throw new Error("ECONNREFUSED");
  };
  await assert.rejects(
    () => embedTexts(["x"], { fetchFn }),
    (err) => err instanceof EmbedUnavailable && /unreachable/.test(err.message)
  );
});

test("malformed response rejected", async () => {
  const fetchFn = async () => ({
    status: 200,
    ok: true,
    json: async () => ({ embeddings: [[1, 2]] }), // 1 vector for 2 inputs
  });
  await assert.rejects(
    () => embedTexts(["a", "b"], { fetchFn }),
    (err) => err instanceof EmbedUnavailable && /malformed/.test(err.message)
  );
});
