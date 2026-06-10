"""Terminal output formatting (spoiler-free)."""

from __future__ import annotations

import sys

from .planner import CLEAN_MAX, SOFT_MAX, Plan

_GREEN, _YELLOW, _RED, _BOLD, _DIM, _RESET = (
    "\033[32m", "\033[33m", "\033[31m", "\033[1m", "\033[2m", "\033[0m",
)


def _color() -> bool:
    return sys.stdout.isatty()


def _paint(text: str, code: str) -> str:
    return f"{code}{text}{_RESET}" if _color() else text


def tier_label(risk: int) -> str:
    if risk <= CLEAN_MAX:
        return _paint("clean break", _GREEN)
    if risk <= SOFT_MAX:
        return _paint("mild hook  ", _YELLOW)
    return _paint("cliffhanger", _RED)


def _code(ep: dict) -> str:
    return f"S{ep['season']:02d}E{ep['number']:02d}"


def _note(ep: dict) -> str:
    parts = []
    if ep.get("note"):
        parts.append(ep["note"])
    if ep.get("flags"):
        parts.append("; ".join(ep["flags"]))
    return " — ".join(parts)


def render_analysis(show: dict, episodes: list[dict], source: str) -> str:
    lines = [
        _paint(f"{show['name']} — ending-risk analysis", _BOLD),
        _paint(f"scores from: {source}", _DIM),
        "",
    ]
    current_season = None
    for ep in episodes:
        if ep["season"] != current_season:
            current_season = ep["season"]
            lines.append(_paint(f"Season {current_season}", _BOLD))
        note = _note(ep)
        lines.append(
            f"  {_code(ep)}  {tier_label(ep['risk'])}  risk {ep['risk']:>3}"
            f"  {ep['runtime']:>3}m  {ep['title']}"
            + (f"\n        {_paint(note, _DIM)}" if note else "")
        )
    return "\n".join(lines)


def render_plan(
    show: dict,
    plan: Plan,
    budget_minutes: int | None,
    source: str,
) -> str:
    if not plan.items:
        return "No episodes found from that starting point."

    first = plan.items[0].episode
    header = f"{show['name']} — tonight's plan, starting at {_code(first)}"
    if budget_minutes is not None:
        header += f" ({budget_minutes} min budget)"
    lines = [_paint(header, _BOLD), _paint(f"scores from: {source}", _DIM), ""]

    for i, item in enumerate(plan.items):
        ep = item.episode
        marker = "→ STOP" if i == plan.stop_index else "      "
        included = plan.stop_index is not None and i <= plan.stop_index
        row = (
            f" {marker}  {_code(ep)}  {tier_label(ep['risk'])}"
            f"  {ep['runtime']:>3}m (total {item.cumulative_minutes}m)  {ep['title']}"
        )
        lines.append(row if included else _paint(row, _DIM))
        note = _note(ep)
        if note and included:
            lines.append(f"          {_paint(note, _DIM)}")

    lines.append("")
    stop_item = plan.items[plan.stop_index]
    lines.append(
        f"Stop after {_code(stop_item.episode)} — {plan.rationale}."
        f" Tonight: {plan.stop_index + 1} episode(s),"
        f" {stop_item.cumulative_minutes} minutes."
    )
    if plan.overflow:
        lines.append(
            _paint("note: a single episode exceeds your budget.", _YELLOW)
        )

    nxt = plan.next_episode
    if nxt is not None and "risk" in nxt:
        if nxt["risk"] > SOFT_MAX:
            lines.append(
                _paint(
                    f"Do NOT start {_code(nxt)} 'just to see' — it ends on a "
                    "cliffhanger and you will not stop there.",
                    _RED,
                )
            )
        elif nxt["risk"] <= CLEAN_MAX:
            lines.append(
                f"Have {nxt['runtime']} more minutes? {_code(nxt)} is also a "
                "clean stopping point."
            )
    return "\n".join(lines)
