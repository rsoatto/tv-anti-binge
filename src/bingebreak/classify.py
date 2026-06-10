"""Claude-powered episode-ending classification.

Sends one request per season and asks Claude to rate how each episode *ends*
(resolved vs. cliffhanger) using its knowledge of the show, returning
spoiler-free JSON via structured outputs. Falls back cleanly when no
Anthropic credentials are available — callers catch ClassifierUnavailable
and use the offline heuristics instead.
"""

from __future__ import annotations

import json

from . import cache
from .heuristics import tier

DEFAULT_MODEL = "claude-opus-4-8"

# 30 days — episode endings don't change; re-run with --refresh to re-classify.
LLM_CACHE_TTL = 30 * 24 * 3600


class ClassifierUnavailable(RuntimeError):
    """Raised when the Claude classifier can't run (no SDK/credentials/etc.)."""


_SCHEMA = {
    "type": "object",
    "properties": {
        "episodes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "season": {"type": "integer"},
                    "number": {"type": "integer"},
                    "ending": {
                        "type": "string",
                        "enum": ["clean", "soft_hook", "cliffhanger"],
                    },
                    "risk": {"type": "integer"},
                    "confidence": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                    },
                    "note": {"type": "string"},
                },
                "required": [
                    "season",
                    "number",
                    "ending",
                    "risk",
                    "confidence",
                    "note",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["episodes"],
    "additionalProperties": False,
}

_SYSTEM = """\
You rate how individual TV episodes END, to help viewers avoid stopping a \
night of watching on a cliffhanger.

For each episode you are given, rate the final minutes of the episode:
- ending: "clean" (story threads of the episode resolve; comfortable place to \
stop), "soft_hook" (mostly resolved but a clear tease or open thread for the \
next episode), or "cliffhanger" (ends mid-crisis, on a shock, or with the \
fate of a character unresolved).
- risk: 0-100, where 0 = perfectly self-contained and 100 = brutal cliffhanger.
- confidence: "high" if you concretely remember how this episode ends, \
"medium" if you remember the show's structure but not this exact ending, \
"low" if you are estimating from the synopsis and the show's general style.

Rules:
1. Use your own knowledge of the show first; the provided synopses describe \
the episode body, not necessarily its ending.
2. NOTES MUST BE SPOILER-FREE. Never name characters, deaths, reveals, twists, \
or plot events. Describe only the SHAPE of the ending, e.g. "ends mid-crisis, \
flows straight into the next episode" or "case wraps up; quiet closing scene". \
Maximum ~12 words.
3. When unsure, lean toward higher risk — a false "cliffhanger" wastes \
nothing, but a false "clean" ruins someone's night.
4. Return exactly one entry per episode listed, with the same season/number.
"""


def _build_user_message(show: dict, season: int, episodes: list[dict]) -> str:
    lines = [
        f"Show: {show['name']} ({show.get('premiered', '?')})",
        f"Genres: {', '.join(show.get('genres', [])) or 'unknown'}",
        f"Season {season} episodes to rate:",
        "",
    ]
    for ep in episodes:
        lines.append(f"S{ep['season']:02d}E{ep['number']:02d} — {ep['title']}")
        if ep.get("summary"):
            lines.append(f"  synopsis: {ep['summary']}")
    return "\n".join(lines)


def classify_season(
    show: dict,
    season: int,
    model: str = DEFAULT_MODEL,
    refresh: bool = False,
) -> dict[tuple[int, int], dict]:
    """Classify all episodes of one season.

    Returns {(season, number): {"risk", "ending", "confidence", "note"}}.
    Raises ClassifierUnavailable when Claude can't be reached.
    """
    episodes = [e for e in show["episodes"] if e["season"] == season]
    if not episodes:
        return {}

    cache_key = f"llm_{show['id']}_s{season}_{model}"
    if not refresh:
        cached = cache.get(cache_key, max_age_seconds=LLM_CACHE_TTL)
        if cached is not None:
            return {(e["season"], e["number"]): e for e in cached}

    try:
        import anthropic
    except ImportError as exc:
        raise ClassifierUnavailable("anthropic SDK not installed") from exc

    try:
        client = anthropic.Anthropic()
        response = client.messages.create(
            model=model,
            max_tokens=16000,
            thinking={"type": "adaptive"},
            system=_SYSTEM,
            messages=[
                {
                    "role": "user",
                    "content": _build_user_message(show, season, episodes),
                }
            ],
            output_config={"format": {"type": "json_schema", "schema": _SCHEMA}},
        )
    except anthropic.APIError as exc:
        raise ClassifierUnavailable(f"Claude API error: {exc}") from exc
    except Exception as exc:  # missing credentials raise at client/call time
        raise ClassifierUnavailable(str(exc)) from exc

    text = "".join(b.text for b in response.content if b.type == "text")
    try:
        rated = json.loads(text)["episodes"]
    except (json.JSONDecodeError, KeyError) as exc:
        raise ClassifierUnavailable(f"unparseable classifier output: {exc}") from exc

    results: dict[tuple[int, int], dict] = {}
    for entry in rated:
        risk = max(0, min(100, int(entry["risk"])))
        results[(entry["season"], entry["number"])] = {
            "risk": risk,
            # trust the numeric risk for tiering so the two never disagree
            "ending": tier(risk),
            "confidence": entry["confidence"],
            "note": entry["note"],
        }

    # Only accept a complete rating set; partial coverage falls back entirely.
    missing = [
        e for e in episodes if (e["season"], e["number"]) not in results
    ]
    if missing:
        raise ClassifierUnavailable(
            f"classifier skipped {len(missing)} episode(s)"
        )

    cache.set(
        cache_key,
        [
            {"season": s, "number": n, **v}
            for (s, n), v in sorted(results.items())
        ],
    )
    return results
