// Offline cliffhanger-risk heuristics. Port of the Python bingebreak.heuristics
// module — keep the two in sync.
//
// Risk scale: 0 (clean, self-contained ending) to 100 (hard cliffhanger).

export const PART_ONE_RE =
  /(\(\s*(1|i)\s*\)|\b(part|pt\.?|chapter)\s*(1|i|one)\b)/i;
export const PART_FINAL_RE =
  /(\(\s*(2|3|4|ii|iii|iv)\s*\)|\b(part|pt\.?)\s*(2|3|4|ii|iii|iv|two|three|four)\b|\bconclusion\b)/i;
export const TBC_RE = /to be continued/i;

const GENRE_BASE = {
  Thriller: 50,
  Horror: 50,
  Mystery: 45,
  Drama: 40,
  "Science-Fiction": 40,
  Action: 40,
  Fantasy: 40,
  Adventure: 35,
  Crime: 30, // often procedural / case-of-the-week
  Comedy: 15,
  Family: 15,
  Animation: 20,
  Anime: 35,
};
const DEFAULT_BASE = 35;

const TENSION_WORDS =
  /\b(cliffhanger|shocking|race against time|vanish(es|ed)?|kidnapp(ed|ing)|betray(al|ed)|ultimatum|closing in)\b/i;

function clamp(value, lo = 5, hi = 95) {
  return Math.max(lo, Math.min(hi, value));
}

export function tier(risk) {
  if (risk <= 35) return "clean";
  if (risk <= 65) return "soft_hook";
  return "cliffhanger";
}

function episodeAfter(episode, episodes) {
  // The episode that airs next (within the season or the next premiere).
  const ordered = [...episodes].sort(
    (a, b) => a.season - b.season || a.number - b.number
  );
  const i = ordered.findIndex(
    (e) => e.season === episode.season && e.number === episode.number
  );
  if (i === -1 || i + 1 >= ordered.length) return null;
  return ordered[i + 1];
}

function titlesLookPaired(titleA, titleB) {
  // True when two consecutive titles share a stem, e.g. "X (1)" / "X (2)".
  const strip = (t) =>
    t
      .replace(PART_ONE_RE, "")
      .replace(PART_FINAL_RE, "")
      .replace(/[\s:\-,]+$/g, "")
      .replace(/^[\s:\-,]+/g, "");
  const stemA = strip(titleA);
  const stemB = strip(titleB);
  return Boolean(stemA) && stemA.toLowerCase() === stemB.toLowerCase();
}

// Score one episode's ending risk from structure alone (no plot knowledge).
// Returns {risk, flags, ending}.
export function scoreEpisode(episode, episodes, genres) {
  const bases = (genres || []).map((g) => GENRE_BASE[g] ?? DEFAULT_BASE);
  let risk = bases.length ? Math.max(...bases) : DEFAULT_BASE;
  const flags = [];

  const seasonEps = episodes.filter((e) => e.season === episode.season);
  const maxNumber = Math.max(...seasonEps.map((e) => e.number));
  const laterSeasons = episodes.some((e) => e.season > episode.season);

  const title = episode.title || "";
  const summary = episode.summary || "";

  if (episode.number === maxNumber) {
    flags.push("season finale");
    // Finales of continuing shows frequently hook into the next season.
    if (laterSeasons) risk += 10;
  } else if (episode.number === maxNumber - 1) {
    flags.push("penultimate — arc climax likely");
    risk += 10;
  }

  const nextEp = episodeAfter(episode, episodes);

  if (TBC_RE.test(summary) || TBC_RE.test(title)) {
    risk = Math.max(risk, 85);
    flags.push("marked 'to be continued'");
  }
  if (
    PART_ONE_RE.test(title) ||
    (nextEp &&
      PART_FINAL_RE.test(nextEp.title || "") &&
      titlesLookPaired(title, nextEp.title || ""))
  ) {
    risk = Math.max(risk, 85);
    flags.push("first half of a multi-part story");
  } else if (PART_FINAL_RE.test(title)) {
    risk -= 15;
    flags.push("multi-part conclusion");
  }

  if (TENSION_WORDS.test(summary)) risk += 10;

  risk = clamp(risk);
  return { risk, flags, ending: tier(risk) };
}
