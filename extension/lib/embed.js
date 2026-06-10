// Local embedding provider (Ollama, http://localhost:11434).
//
// Used to bridge the paraphrase gap in beat<->scene alignment: plot summaries
// say "Marta discovers the ledger" while the dialogue never uses those words.
// Everything runs on-device; nothing is uploaded.

export const OLLAMA_URL = "http://localhost:11434";
export const EMBED_MODEL = "nomic-embed-text";
const MAX_CHARS = 1500; // embed inputs truncated; plenty for a beat or scene

export class EmbedUnavailable extends Error {}

// True when an Ollama server answers quickly.
export async function embedServerUp({ fetchFn = fetch, url = OLLAMA_URL } = {}) {
  try {
    const resp = await fetchFn(`${url}/api/version`, {
      signal: AbortSignal.timeout(800),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// Embed a list of texts in one batch call. Returns an array of vectors.
export async function embedTexts(
  texts,
  { fetchFn = fetch, url = OLLAMA_URL, model = EMBED_MODEL } = {}
) {
  const input = texts.map((t) => (t || " ").slice(0, MAX_CHARS));
  let resp;
  try {
    resp = await fetchFn(`${url}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    throw new EmbedUnavailable(`local model server unreachable (${err.message})`);
  }
  if (resp.status === 403) {
    throw new EmbedUnavailable(
      "Ollama rejected the extension's origin — restart it with " +
        'OLLAMA_ORIGINS="chrome-extension://*" ollama serve'
    );
  }
  if (resp.status === 404) {
    throw new EmbedUnavailable(
      `model "${model}" not installed — run: ollama pull ${model}`
    );
  }
  if (!resp.ok) {
    throw new EmbedUnavailable(`embed request failed: HTTP ${resp.status}`);
  }
  const body = await resp.json();
  const embeddings = body?.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== input.length) {
    throw new EmbedUnavailable("embed response malformed");
  }
  return embeddings;
}

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
