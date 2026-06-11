// Rebuild vendor/ from node_modules — reproducible, no bundler.
//
// Why patching is needed: transformers' `.web` build (the only build with no
// dynamic import() — MV3 service workers forbid it) leaves two BARE imports
// ("onnxruntime-web/webgpu", "onnxruntime-common") for a bundler to resolve.
// Service workers can't resolve bare specifiers, so we rewrite them to the
// vendored ORT bundle. ort.bundle.min.mjs embeds its WASM glue; its single
// dynamic import() is a fallback that only runs if wasmPaths points at an
// external loader — we pass the wasm binary directly instead, so it never
// executes.
//
// Usage: node scripts/vendorize.mjs   (then verify: npm test + load in Chrome)

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nm = join(root, "node_modules");
const vendor = join(root, "vendor");

rmSync(vendor, { recursive: true, force: true });
mkdirSync(vendor);

// 1. ORT: ESM bundle with embedded WASM glue + the matching wasm binary.
copyFileSync(
  join(nm, "onnxruntime-web/dist/ort.bundle.min.mjs"),
  join(vendor, "ort.bundle.min.mjs")
);
copyFileSync(
  join(nm, "onnxruntime-web/dist/ort-wasm-simd-threaded.wasm"),
  join(vendor, "ort-wasm-simd-threaded.wasm")
);

// 2. transformers.web with bare ORT specifiers rewritten to the vendored file.
let bundle = readFileSync(
  join(nm, "@huggingface/transformers/dist/transformers.web.min.js"),
  "utf8"
);
const before = bundle.length;
bundle = bundle
  .replaceAll('from"onnxruntime-web/webgpu"', 'from"./ort.bundle.min.mjs"')
  .replaceAll('from"onnxruntime-common"', 'from"./ort.bundle.min.mjs"');
if (bundle === readFileSync(join(nm, "@huggingface/transformers/dist/transformers.web.min.js"), "utf8")) {
  throw new Error("no specifiers rewritten — transformers dist layout changed?");
}
writeFileSync(join(vendor, "transformers.web.min.js"), bundle);

// 3. Safety checks: nothing bare left, no static import that won't resolve.
for (const f of ["transformers.web.min.js", "ort.bundle.min.mjs"]) {
  const src = readFileSync(join(vendor, f), "utf8");
  const bare = src.match(/from"[a-z@][^".\/][^"]*"/g);
  if (bare) throw new Error(`${f}: unresolved bare imports remain: ${bare.join(", ")}`);
}
console.log(`vendor/ rebuilt (patched ${before} -> ${bundle.length} bytes)`);
