// Pick where to stop tonight. Port of the Python bingebreak.planner module.

export const CLEAN_MAX = 35;
export const SOFT_MAX = 65;

function latestAtOrBelow(risks, threshold) {
  for (let i = risks.length - 1; i >= 0; i--) {
    if (risks[i] <= threshold) return i;
  }
  return null;
}

function episodeAfter(episodes, ep) {
  const i = episodes.findIndex(
    (e) => e.season === ep.season && e.number === ep.number
  );
  if (i === -1 || i + 1 >= episodes.length) return null;
  return episodes[i + 1];
}

// episodes: ordered, scored (each has .risk, .runtime). Returns
// {items: [{episode, cumulativeMinutes}], stopIndex, rationale,
//  nextEpisode, overflow}.
export function buildPlan(episodes, { budgetMinutes = null, maxEpisodes = null } = {}) {
  const plan = {
    items: [],
    stopIndex: null,
    rationale: "",
    nextEpisode: null,
    overflow: false,
  };
  if (!episodes.length) return plan;
  if (budgetMinutes == null && maxEpisodes == null) budgetMinutes = 120;

  let cumulative = 0;
  for (const ep of episodes) {
    if (maxEpisodes != null && plan.items.length >= maxEpisodes) break;
    if (
      budgetMinutes != null &&
      plan.items.length &&
      cumulative + ep.runtime > budgetMinutes
    )
      break;
    cumulative += ep.runtime;
    plan.items.push({ episode: ep, cumulativeMinutes: cumulative });
  }

  // Always allow at least the first episode, even over budget.
  if (budgetMinutes != null && plan.items.length) {
    plan.overflow = plan.items[0].cumulativeMinutes > budgetMinutes;
  }

  const risks = plan.items.map((item) => item.episode.risk);

  let stop = latestAtOrBelow(risks, CLEAN_MAX);
  if (stop != null) {
    plan.rationale = "clean ending — a natural place to stop";
  } else {
    stop = latestAtOrBelow(risks, SOFT_MAX);
    if (stop != null) {
      plan.rationale =
        "no clean ending fits tonight; this is the gentlest hook in range";
    } else {
      stop = risks.indexOf(Math.min(...risks));
      plan.rationale =
        "every ending in range is a cliffhanger — this is the least severe; " +
        "consider stopping a night early or pushing through the arc another night";
    }
  }
  plan.stopIndex = stop;
  plan.nextEpisode = episodeAfter(episodes, plan.items[stop].episode);
  return plan;
}
