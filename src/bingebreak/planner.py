"""Pick where to stop tonight: fit episodes to a time budget, end on a clean ending."""

from __future__ import annotations

from dataclasses import dataclass, field

CLEAN_MAX = 35
SOFT_MAX = 65


@dataclass
class PlanItem:
    episode: dict          # normalized episode incl. "risk", "ending", "note", "flags"
    cumulative_minutes: int


@dataclass
class Plan:
    items: list[PlanItem] = field(default_factory=list)   # episodes within budget
    stop_index: int | None = None                          # index into items
    rationale: str = ""
    next_episode: dict | None = None                       # first ep after the stop
    overflow: bool = False                                 # single ep exceeded budget


def build_plan(
    episodes: list[dict],
    budget_minutes: int | None = None,
    max_episodes: int | None = None,
) -> Plan:
    """Choose a stopping point among `episodes` (ordered, scored).

    Window = episodes that fit the budget/count; stop = the latest episode in
    the window with a clean ending, else the latest soft hook, else the
    lowest-risk episode with a warning.
    """
    plan = Plan()
    if not episodes:
        return plan
    if budget_minutes is None and max_episodes is None:
        budget_minutes = 120

    cumulative = 0
    for ep in episodes:
        if max_episodes is not None and len(plan.items) >= max_episodes:
            break
        if (
            budget_minutes is not None
            and plan.items
            and cumulative + ep["runtime"] > budget_minutes
        ):
            break
        cumulative += ep["runtime"]
        plan.items.append(PlanItem(episode=ep, cumulative_minutes=cumulative))

    # Always allow at least the first episode, even over budget.
    if budget_minutes is not None and plan.items:
        plan.overflow = plan.items[0].cumulative_minutes > budget_minutes

    risks = [item.episode["risk"] for item in plan.items]

    stop = _latest_at_or_below(risks, CLEAN_MAX)
    if stop is not None:
        plan.rationale = "clean ending — a natural place to stop"
    else:
        stop = _latest_at_or_below(risks, SOFT_MAX)
        if stop is not None:
            plan.rationale = (
                "no clean ending fits tonight; this is the gentlest hook in range"
            )
        else:
            stop = min(range(len(risks)), key=risks.__getitem__)
            plan.rationale = (
                "every ending in range is a cliffhanger — this is the least "
                "severe; consider stopping a night early or pushing through "
                "the arc another night"
            )
    plan.stop_index = stop

    stop_ep = plan.items[stop].episode
    plan.next_episode = _episode_after(episodes, stop_ep)
    return plan


def _latest_at_or_below(risks: list[int], threshold: int) -> int | None:
    for i in range(len(risks) - 1, -1, -1):
        if risks[i] <= threshold:
            return i
    return None


def _episode_after(episodes: list[dict], ep: dict) -> dict | None:
    for i, candidate in enumerate(episodes):
        if (
            candidate["season"] == ep["season"]
            and candidate["number"] == ep["number"]
        ):
            return episodes[i + 1] if i + 1 < len(episodes) else None
    return None
