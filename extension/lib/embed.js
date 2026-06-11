// Embedding helpers (node-safe — no browser/vendor imports here).
//
// The actual model runs in-extension via transformers.js: see
// ../embed-engine.js (service-worker only). This split keeps the math and
// constants testable in node while the engine stays a browser concern.

export const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
export const MAX_CHARS = 1500; // embed inputs truncated; plenty for a beat or scene

export class EmbedUnavailable extends Error {}

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}
