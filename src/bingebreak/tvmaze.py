"""TVMaze API client (free, no API key required)."""

from __future__ import annotations

import html
import re

import requests

API_BASE = "https://api.tvmaze.com"
DEFAULT_RUNTIME = 45  # minutes, when TVMaze has no runtime for an episode

_TAG_RE = re.compile(r"<[^>]+>")


class TVMazeError(RuntimeError):
    """Raised when TVMaze lookup fails."""


def strip_html(text: str | None) -> str:
    if not text:
        return ""
    return html.unescape(_TAG_RE.sub("", text)).strip()


def _get(path: str, params: dict | None = None) -> dict | list:
    try:
        resp = requests.get(f"{API_BASE}{path}", params=params, timeout=15)
    except requests.RequestException as exc:
        raise TVMazeError(f"TVMaze request failed: {exc}") from exc
    if resp.status_code == 404:
        raise TVMazeError("No show found matching that name.")
    resp.raise_for_status()
    return resp.json()


def search_shows(query: str) -> list[dict]:
    """Return candidate shows for a query, best match first."""
    results = _get("/search/shows", {"q": query})
    shows = []
    for item in results:
        show = item.get("show", {})
        shows.append(
            {
                "id": show.get("id"),
                "name": show.get("name"),
                "premiered": (show.get("premiered") or "")[:4],
                "status": show.get("status"),
                "genres": show.get("genres") or [],
            }
        )
    return shows


def _normalize_episode(raw: dict, fallback_runtime: int) -> dict:
    return {
        "id": raw.get("id"),
        "season": raw.get("season"),
        "number": raw.get("number"),
        "title": raw.get("name") or f"Episode {raw.get('number')}",
        "runtime": raw.get("runtime") or fallback_runtime,
        "airdate": raw.get("airdate") or "",
        "summary": strip_html(raw.get("summary")),
        "type": raw.get("type") or "regular",
    }


def get_show(query: str) -> dict:
    """Fetch the best-matching show with its full episode list, normalized.

    Returns {"id", "name", "premiered", "status", "genres", "episodes": [...]}
    where episodes are ordered by (season, number) and specials without an
    episode number are dropped.
    """
    data = _get("/singlesearch/shows", {"q": query, "embed": "episodes"})
    fallback_runtime = data.get("averageRuntime") or DEFAULT_RUNTIME
    raw_eps = data.get("_embedded", {}).get("episodes", [])
    episodes = [
        _normalize_episode(e, fallback_runtime)
        for e in raw_eps
        if e.get("season") is not None and e.get("number") is not None
    ]
    episodes.sort(key=lambda e: (e["season"], e["number"]))
    return {
        "id": data.get("id"),
        "name": data.get("name"),
        "premiered": (data.get("premiered") or "")[:4],
        "status": data.get("status"),
        "genres": data.get("genres") or [],
        "episodes": episodes,
    }
