// TVMaze API client (free, no API key, CORS-open).

const API_BASE = "https://api.tvmaze.com";
const DEFAULT_RUNTIME = 45;

export class TVMazeError extends Error {}

export function stripHtml(text) {
  if (!text) return "";
  const noTags = text.replace(/<[^>]+>/g, "");
  // Minimal entity handling for TVMaze summaries (no DOM in service workers).
  return noTags
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

async function get(path, params) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  let resp;
  try {
    resp = await fetch(url);
  } catch (err) {
    throw new TVMazeError(`TVMaze request failed: ${err.message}`);
  }
  if (resp.status === 404) throw new TVMazeError("No show found matching that name.");
  if (!resp.ok) throw new TVMazeError(`TVMaze error: HTTP ${resp.status}`);
  return resp.json();
}

export async function searchShows(query) {
  const results = await get("/search/shows", { q: query });
  return results.map(({ show }) => ({
    id: show.id,
    name: show.name,
    premiered: (show.premiered || "").slice(0, 4),
    status: show.status,
    genres: show.genres || [],
  }));
}

export function normalizeShow(data) {
  const fallbackRuntime = data.averageRuntime || DEFAULT_RUNTIME;
  const rawEps = data._embedded?.episodes || [];
  const episodes = rawEps
    .filter((e) => e.season != null && e.number != null)
    .map((e) => ({
      id: e.id,
      season: e.season,
      number: e.number,
      title: e.name || `Episode ${e.number}`,
      runtime: e.runtime || fallbackRuntime,
      airdate: e.airdate || "",
      summary: stripHtml(e.summary),
      type: e.type || "regular",
    }))
    .sort((a, b) => a.season - b.season || a.number - b.number);
  return {
    id: data.id,
    name: data.name,
    premiered: (data.premiered || "").slice(0, 4),
    status: data.status,
    genres: data.genres || [],
    episodes,
  };
}

// Best-matching show with normalized, ordered episode list.
export async function getShow(query) {
  const data = await get("/singlesearch/shows", { q: query, embed: "episodes" });
  return normalizeShow(data);
}
