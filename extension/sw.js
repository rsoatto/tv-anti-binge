// Service worker entry point: wires the embedding engine (browser-only,
// imports the bundled transformers.js) into the handler module (node-safe,
// covered by tests). Keep background.js importable without the vendor
// bundle — node can't load it and the tests rely on that split.

import { setEmbedEngine } from "./background.js";
import { embedTexts } from "./embed-engine.js";

setEmbedEngine(embedTexts);
