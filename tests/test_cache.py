from bingebreak import cache


def test_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path)
    cache.set("show_test", {"a": [1, 2]})
    assert cache.get("show_test") == {"a": [1, 2]}


def test_missing_returns_none(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path)
    assert cache.get("nope") is None


def test_expiry(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path)
    cache.set("k", 1)
    assert cache.get("k", max_age_seconds=1000) == 1
    assert cache.get("k", max_age_seconds=-1) is None


def test_corrupt_file_returns_none(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path)
    cache.set("k", 1)
    cache._path("k").write_text("{not json")
    assert cache.get("k") is None


def test_key_sanitization(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path)
    cache.set("show_breaking bad: año/1", "v")
    assert cache.get("show_breaking bad: año/1") == "v"
    # no path traversal: everything stays inside the cache dir
    assert all(p.parent == tmp_path for p in tmp_path.iterdir())
