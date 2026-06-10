"""Tiny JSON file cache under ~/.cache/bingebreak."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

CACHE_DIR = Path.home() / ".cache" / "bingebreak"

_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _path(key: str) -> Path:
    return CACHE_DIR / f"{_SAFE_RE.sub('_', key)}.json"


def get(key: str, max_age_seconds: float | None = None):
    """Return the cached value, or None if missing/expired/corrupt."""
    path = _path(key)
    if not path.exists():
        return None
    try:
        wrapper = json.loads(path.read_text())
        if max_age_seconds is not None:
            if time.time() - wrapper["stored_at"] > max_age_seconds:
                return None
        return wrapper["value"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return None


def set(key: str, value) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _path(key).write_text(json.dumps({"stored_at": time.time(), "value": value}))


def clear(key: str) -> None:
    _path(key).unlink(missing_ok=True)
