"""Offline cliffhanger-risk heuristics.

Used when the Claude classifier is unavailable, and to provide structural
flags (two-parters, finales) that override or supplement LLM scores.

Risk scale: 0 (clean, self-contained ending) to 100 (hard cliffhanger).
"""

from __future__ import annotations

import re

# Title markers for multi-part episodes.
PART_ONE_RE = re.compile(
    r"(\(\s*(1|i)\s*\)|\b(part|pt\.?|chapter)\s*(1|i|one)\b)", re.IGNORECASE
)
PART_FINAL_RE = re.compile(
    r"(\(\s*(2|3|4|ii|iii|iv)\s*\)|\b(part|pt\.?)\s*(2|3|4|ii|iii|iv|two|three|four)\b"
    r"|\bconclusion\b)",
    re.IGNORECASE,
)
TBC_RE = re.compile(r"to be continued", re.IGNORECASE)

# Genre -> base risk that any given episode ends unresolved.
_GENRE_BASE = {
    "Thriller": 50,
    "Horror": 50,
    "Mystery": 45,
    "Drama": 40,
    "Science-Fiction": 40,
    "Action": 40,
    "Fantasy": 40,
    "Adventure": 35,
    "Crime": 30,  # often procedural / case-of-the-week
    "Comedy": 15,
    "Family": 15,
    "Animation": 20,
    "Anime": 35,
}
_DEFAULT_BASE = 35

# Summary phrases that mildly suggest an unresolved ending.
_TENSION_WORDS = re.compile(
    r"\b(cliffhanger|shocking|race against time|vanish(es|ed)?|"
    r"kidnapp(ed|ing)|betray(al|ed)|ultimatum|closing in)\b",
    re.IGNORECASE,
)


def _clamp(value: int, lo: int = 5, hi: int = 95) -> int:
    return max(lo, min(hi, value))


def score_episode(episode: dict, episodes: list[dict], genres: list[str]) -> dict:
    """Score one episode's ending risk from structure alone (no plot knowledge).

    Returns {"risk": int, "flags": [str], "ending": str}.
    """
    base = max((_GENRE_BASE.get(g, _DEFAULT_BASE) for g in genres), default=_DEFAULT_BASE)
    risk = base
    flags: list[str] = []

    season = episode["season"]
    season_eps = [e for e in episodes if e["season"] == season]
    max_number = max(e["number"] for e in season_eps)
    later_seasons = any(e["season"] > season for e in episodes)

    idx_in_season = episode["number"]
    title = episode.get("title", "")
    summary = episode.get("summary", "")

    if idx_in_season == max_number:
        flags.append("season finale")
        # Finales of continuing shows frequently hook into the next season.
        risk += 10 if later_seasons else 0
    elif idx_in_season == max_number - 1:
        flags.append("penultimate — arc climax likely")
        risk += 10

    # The following episode in airing order — may be next season's premiere,
    # which is how cross-season two-parters pair up (e.g. a "Part II" opener).
    next_ep = _episode_after(episode, episodes)

    if TBC_RE.search(summary) or TBC_RE.search(title):
        risk = max(risk, 85)
        flags.append("marked 'to be continued'")
    if PART_ONE_RE.search(title) or (
        next_ep
        and PART_FINAL_RE.search(next_ep.get("title", ""))
        and _titles_look_paired(title, next_ep.get("title", ""))
    ):
        risk = max(risk, 85)
        flags.append("first half of a multi-part story")
    elif PART_FINAL_RE.search(title):
        risk -= 15
        flags.append("multi-part conclusion")

    if _TENSION_WORDS.search(summary):
        risk += 10

    risk = _clamp(risk)
    return {"risk": risk, "flags": flags, "ending": tier(risk)}


def _episode_after(episode: dict, episodes: list[dict]) -> dict | None:
    """The episode that airs next (within the season or the next premiere)."""
    ordered = sorted(episodes, key=lambda e: (e["season"], e["number"]))
    for i, e in enumerate(ordered):
        if e["season"] == episode["season"] and e["number"] == episode["number"]:
            return ordered[i + 1] if i + 1 < len(ordered) else None
    return None


def _titles_look_paired(title_a: str, title_b: str) -> bool:
    """True when two consecutive titles share a stem, e.g. 'X (1)' / 'X (2)'."""
    stem_a = PART_FINAL_RE.sub("", PART_ONE_RE.sub("", title_a)).strip(" :-,")
    stem_b = PART_FINAL_RE.sub("", PART_ONE_RE.sub("", title_b)).strip(" :-,")
    return bool(stem_a) and stem_a.lower() == stem_b.lower()


def tier(risk: int) -> str:
    if risk <= 35:
        return "clean"
    if risk <= 65:
        return "soft_hook"
    return "cliffhanger"
