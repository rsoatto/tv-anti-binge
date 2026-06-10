// Wikipedia plot fetching (keyless, CORS-enabled MediaWiki API).
//
// Major shows have per-episode articles with a detailed "Plot" section —
// the richest "known plot summary" source. Falls back to nothing (caller
// then uses the TVMaze synopsis alone).

const API = "https://en.wikipedia.org/w/api.php";

async function api(params, fetchFn) {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ format: "json", origin: "*", ...params })) {
    url.searchParams.set(k, v);
  }
  const resp = await fetchFn(url);
  if (!resp.ok) throw new Error(`Wikipedia HTTP ${resp.status}`);
  return resp.json();
}

// Extract the Plot/Synopsis section from a plain-text article extract.
export function extractPlotSection(extract) {
  if (!extract) return null;
  // Note: $(?![\s\S]) = true end of string — a bare $ with the m flag would
  // match every line end and truncate the section to its first paragraph.
  const m = extract.match(
    /^==+\s*(Plot|Plot summary|Synopsis|Summary)\s*==+\s*\n([\s\S]*?)(?=\n==[^=]|$(?![\s\S]))/m
  );
  if (!m) return null;
  // Drop sub-headings inside the section.
  const body = m[2].replace(/^===+.*$/gm, " ").replace(/\s+/g, " ").trim();
  return body.length >= 200 ? body : null;
}

// Pick the search result that looks like THIS episode's own article.
export function pickEpisodeArticle(results, episodeTitle, showName) {
  const epLower = episodeTitle.toLowerCase();
  const showLower = showName.toLowerCase();
  for (const r of results) {
    const t = r.title.toLowerCase();
    if (t.includes(epLower) && (t.includes(showLower) || t === epLower)) return r;
  }
  return null;
}

// Returns {text, source: "wikipedia", title} or null.
export async function fetchEpisodePlot(showName, episodeTitle, fetchFn = fetch) {
  const search = await api(
    {
      action: "query",
      list: "search",
      srsearch: `"${episodeTitle}" ${showName} episode`,
      srlimit: "5",
    },
    fetchFn
  );
  const hit = pickEpisodeArticle(
    search?.query?.search || [],
    episodeTitle,
    showName
  );
  if (!hit) return null;

  const page = await api(
    {
      action: "query",
      prop: "extracts",
      explaintext: "1",
      redirects: "1",
      pageids: String(hit.pageid),
    },
    fetchFn
  );
  const pages = page?.query?.pages || {};
  const extract = Object.values(pages)[0]?.extract;
  const plot = extractPlotSection(extract);
  return plot ? { text: plot, source: "wikipedia", title: hit.title } : null;
}
