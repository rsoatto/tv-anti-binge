// In-extension embedding engine (service-worker only).
//
// Uses the bundled transformers.js web build (vendor/transformers.web.min.js
// — the `.web` variant statically includes the ONNX runtime loader; MV3
// service workers forbid dynamic import(), which the standard build uses).
// Model weights (~25 MB quantized) are fetched from the Hugging Face Hub on
// first use and cached by the browser; the WASM runtime is bundled. No
// servers, no accounts, no API keys; texts never leave the machine.

import { pipeline, env } from "./vendor/transformers.web.min.js";
import { EMBED_MODEL, MAX_CHARS, EmbedUnavailable } from "./lib/embed.js";

env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("vendor/");
env.backends.onnx.wasm.numThreads = 1; // SW cannot spawn the runtime's workers
env.allowLocalModels = false;

let extractorPromise = null;

function getExtractor(onProgress) {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", EMBED_MODEL, {
      dtype: "q8",
      progress_callback: (info) => {
        if (info.status === "progress" && info.progress != null) {
          onProgress?.(
            `Downloading matching model (first run): ${Math.round(info.progress)}%`
          );
        }
      },
    });
    // A failed download must not poison future attempts.
    extractorPromise.catch(() => {
      extractorPromise = null;
    });
  }
  return extractorPromise;
}

// Embed a list of texts. Returns an array of vectors (number[][]).
export async function embedTexts(texts, { onProgress } = {}) {
  const input = texts.map((t) => (t || " ").slice(0, MAX_CHARS));
  let extractor;
  try {
    extractor = await getExtractor(onProgress);
  } catch (err) {
    throw new EmbedUnavailable(
      `embedding model unavailable (${err.message || err})`
    );
  }
  try {
    const out = await extractor(input, { pooling: "mean", normalize: true });
    return out.tolist();
  } catch (err) {
    throw new EmbedUnavailable(`embedding failed (${err.message || err})`);
  }
}
