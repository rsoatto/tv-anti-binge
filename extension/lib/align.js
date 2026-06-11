// Align plot-summary beats to subtitle scenes, then pick the natural stop.
//
// Idea: the last beat(s) of a plot summary describe the episode's closing
// development — the hook. If we can locate where that final beat STARTS in
// the episode (by matching summary wording against scene dialogue), the
// natural stopping point is the real scene break just before it. No LLM:
// lexical overlap with rare-word and proper-noun weighting, plus a monotonic
// dynamic-programming alignment (plot order == screen order).

import { boundaries } from "./scenes.js";

const STOPWORDS = new Set(
  ("the a an and or but if then else for nor so yet of in on at to from by " +
    "with about as into through during before after above below up down out " +
    "off over under again further once here there when where why how all any " +
    "both each few more most other some such no not only own same than too " +
    "very can will just should now is are was were be been being have has " +
    "had do does did he she it they them his her its their this that these " +
    "those i you we us our your my me him who whom which what while gets get " +
    "got goes go went tells tell told takes take took makes make made").split(" ")
);

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z][a-z']{2,}/g) || []).filter(
    (w) => !STOPWORDS.has(w)
  );
}

function properNouns(originalText) {
  // Words capitalized mid-sentence are almost always names in plot summaries.
  const names = new Set();
  for (const m of originalText.matchAll(/(?<![.!?]\s)(?<!^)\b([A-Z][a-z']{2,})\b/gm)) {
    names.add(m[1].toLowerCase());
  }
  return names;
}

// Split a summary into beats (sentences), merging fragments.
export function splitBeats(summary) {
  const rough = summary
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z"“])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const beats = [];
  for (const s of rough) {
    if (beats.length && s.length < 25) beats[beats.length - 1] += " " + s;
    else beats.push(s);
  }
  return beats.slice(0, 60);
}

// Semantic-similarity contribution (when embedding vectors are available).
// A beat's cosine against a scene is scored relative to that beat's mean
// cosine over all scenes — absolute cosines vary by content, margins don't.
// SEM_SCALE maps margins onto the lexical score scale.
//
// Evidence thresholds, calibrated against the bundled model
// (all-MiniLM-L6-v2 q8, scripts/calibrate-margins.mjs): a single beat can
// match noise (mismatched content measured last-beat margin 0.095!), but the
// MEAN assigned margin across all beats separates cleanly — matched 0.365,
// zero-word-overlap paraphrase 0.186, mismatched content 0.046. Gate on the
// mean, with a modest floor on the final beat (it alone places the stop).
const SEM_SCALE = 30;
export const SEM_MARGIN = 0.08; // final-beat floor
export const SEM_MEAN_MARGIN = 0.1; // whole-alignment requirement

// Monotonic beat->scene alignment. Returns {assignment: [sceneIndex per
// beat], beatScores: [similarity per beat], confidence: 0..1, evidenceOk}
// or null when there is nothing to align. Pass {beatVecs, sceneVecs}
// (parallel embedding arrays, any cosine-comparable vectors) to add
// semantic matching on top of the lexical overlap.
export function alignBeatsToScenes(
  beats,
  scenes,
  summaryText = "",
  { beatVecs = null, sceneVecs = null, cosineFn = defaultCosine } = {}
) {
  if (!beats.length || scenes.length < 2) return null;
  const names = properNouns(summaryText || beats.join(" "));
  const useSemantic =
    Array.isArray(beatVecs) &&
    Array.isArray(sceneVecs) &&
    beatVecs.length === beats.length &&
    sceneVecs.length === scenes.length;

  const sceneTokens = scenes.map((s) => {
    const counts = new Map();
    for (const w of tokenize(s.text)) counts.set(w, (counts.get(w) || 0) + 1);
    return counts;
  });

  // Document frequency over scenes -> weight rare words higher.
  const df = new Map();
  for (const counts of sceneTokens) {
    for (const w of counts.keys()) df.set(w, (df.get(w) || 0) + 1);
  }
  const m = scenes.length;
  const idf = (w) => Math.log((m + 1) / ((df.get(w) || 0) + 1)) + 1;

  const sim = (beat, j) => {
    const counts = sceneTokens[j];
    let score = 0;
    for (const w of new Set(tokenize(beat))) {
      if (!counts.has(w)) continue;
      let weight = idf(w);
      if (names.has(w)) weight *= 2.5;
      score += weight;
    }
    return score / (1 + Math.log(1 + (scenes[j].text.length || 1) / 200));
  };

  const n = beats.length;
  const m2 = scenes.length;

  // Semantic margins per (beat, scene): cosine minus the beat's row mean.
  let semMargin = null;
  if (useSemantic) {
    semMargin = beatVecs.map((bv) => {
      const cosRow = sceneVecs.map((sv) => cosineFn(bv, sv));
      const rowMean = cosRow.reduce((a, b) => a + b, 0) / m2;
      return cosRow.map((c) => c - rowMean);
    });
  }

  const simMatrix = beats.map((b, i) =>
    scenes.map((_, j) => {
      let s = sim(b, j);
      if (semMargin) s += Math.max(0, semMargin[i][j]) * SEM_SCALE;
      return s;
    })
  );

  // DP: best[i][j] = sim(i,j) + max over k<=j of best[i-1][k] (monotone).
  const best = Array.from({ length: n }, () => new Float64Array(m));
  const back = Array.from({ length: n }, () => new Int32Array(m));
  for (let j = 0; j < m; j++) best[0][j] = simMatrix[0][j];
  for (let i = 1; i < n; i++) {
    let runMax = -Infinity;
    let runArg = 0;
    for (let j = 0; j < m; j++) {
      if (best[i - 1][j] > runMax) {
        runMax = best[i - 1][j];
        runArg = j;
      }
      best[i][j] = simMatrix[i][j] + runMax;
      back[i][j] = runArg;
    }
  }

  // Backtrack from the best final cell.
  let j = 0;
  for (let k = 1; k < m; k++) if (best[n - 1][k] > best[n - 1][j]) j = k;
  const assignment = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    assignment[i] = j;
    if (i > 0) j = back[i][j];
  }

  const beatScores = assignment.map((sj, i) => simMatrix[i][sj]);
  const mean = beatScores.reduce((a, b) => a + b, 0) / n;
  // Squash raw lexical scores into 0..1; spread of assignments matters too —
  // if every beat collapsed onto one scene, the alignment learned nothing.
  const spread = new Set(assignment).size / Math.min(n, m);
  const confidence = (mean / (mean + 2)) * Math.min(1, spread * 2);

  // Evidence check for the FINAL beat — it alone determines the stop point,
  // so it must share several distinct informative words with its scene (rare
  // across scenes, or character names). A one-word coincidence is not an
  // alignment.
  const lastScene = sceneTokens[assignment[n - 1]];
  let matched = 0;
  let strong = 0;
  for (const w of new Set(tokenize(beats[n - 1]))) {
    if (!lastScene.has(w)) continue;
    matched += 1;
    if ((df.get(w) || 0) <= Math.max(2, Math.ceil(m / 4)) || names.has(w)) strong += 1;
  }
  const lexicalEvidence = matched >= 3 && strong >= 2;
  // Semantic evidence: the whole alignment must beat per-beat average
  // affinity by the calibrated mean margin, and the final beat (which alone
  // places the stop) must clear its own floor.
  let semanticEvidence = false;
  if (semMargin) {
    const assigned = assignment.map((sj, i) => semMargin[i][sj]);
    const meanAssigned = assigned.reduce((a, b) => a + b, 0) / n;
    semanticEvidence =
      meanAssigned >= SEM_MEAN_MARGIN && assigned[n - 1] >= SEM_MARGIN;
  }
  const evidenceOk = n >= 3 && (lexicalEvidence || semanticEvidence);

  return {
    assignment,
    beatScores,
    confidence,
    evidenceOk,
    engine: useSemantic ? "semantic+lexical" : "lexical",
  };
}

function defaultCosine(a, b) {
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

export const MIN_CONFIDENCE = 0.35;

// Pick the stopping point.
// Returns {stopAtSeconds, basis, confidence, candidates} where basis is
// "plot-aligned" (scene break before the summary's closing beat) or
// "scene-break" (largest real dialogue break late in the episode).
// Candidates list the strongest late boundaries either way.
export function chooseStopPoint({ scenes, alignment, duration }) {
  const allBounds = boundaries(scenes);
  if (!allBounds.length) return null;
  const total = duration || scenes[scenes.length - 1].end;

  const late = allBounds.filter(
    (b) => b.time >= total * 0.5 && b.time <= total - 20
  );
  const candidates = [...(late.length ? late : allBounds)]
    .sort((a, b) => b.gapSeconds - a.gapSeconds)
    .slice(0, 4)
    .sort((a, b) => a.time - b.time);

  if (alignment && alignment.confidence >= MIN_CONFIDENCE && alignment.evidenceOk) {
    const lastBeatScene = alignment.assignment[alignment.assignment.length - 1];
    const bound = allBounds.find((b) => b.sceneIndex === lastBeatScene);
    // Sanity: the closing beat must start in the back half of the episode and
    // at an actual boundary; otherwise fall through to measured scene breaks.
    if (bound && bound.time >= total * 0.5) {
      return {
        stopAtSeconds: bound.time + Math.min(2, bound.gapSeconds / 2),
        basis: "plot-aligned",
        confidence: alignment.confidence,
        candidates,
      };
    }
  }

  if (!late.length) return null;
  const biggest = late.reduce((a, b) => (b.gapSeconds > a.gapSeconds ? b : a));
  return {
    stopAtSeconds: biggest.time + Math.min(2, biggest.gapSeconds / 2),
    basis: "scene-break",
    confidence: alignment ? alignment.confidence : 0,
    candidates,
  };
}
