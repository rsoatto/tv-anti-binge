import pytest

from bingebreak import tvmaze


def test_strip_html():
    assert tvmaze.strip_html("<p>Walt &amp; Jesse cook.</p>") == "Walt & Jesse cook."
    assert tvmaze.strip_html(None) == ""
    assert tvmaze.strip_html("") == ""


SAMPLE = {
    "id": 169,
    "name": "Breaking Bad",
    "premiered": "2008-01-20",
    "status": "Ended",
    "genres": ["Drama", "Crime", "Thriller"],
    "averageRuntime": 60,
    "_embedded": {
        "episodes": [
            {
                "id": 2,
                "season": 1,
                "number": 2,
                "name": "Cat's in the Bag...",
                "runtime": 48,
                "airdate": "2008-01-27",
                "summary": "<p>Cleanup time.</p>",
                "type": "regular",
            },
            {
                "id": 1,
                "season": 1,
                "number": 1,
                "name": "Pilot",
                "runtime": None,
                "airdate": "2008-01-20",
                "summary": None,
                "type": "regular",
            },
            {
                "id": 99,
                "season": 1,
                "number": None,  # unnumbered special: dropped
                "name": "Special",
                "runtime": 30,
                "airdate": "",
                "summary": "",
                "type": "insignificant_special",
            },
        ]
    },
}


def test_get_show_normalizes(monkeypatch):
    monkeypatch.setattr(tvmaze, "_get", lambda path, params=None: SAMPLE)
    show = tvmaze.get_show("breaking bad")
    assert show["name"] == "Breaking Bad"
    assert show["premiered"] == "2008"
    eps = show["episodes"]
    assert [e["number"] for e in eps] == [1, 2]  # sorted, special dropped
    assert eps[0]["runtime"] == 60  # None -> averageRuntime fallback
    assert eps[1]["summary"] == "Cleanup time."


def test_not_found(monkeypatch):
    class FakeResp:
        status_code = 404

    monkeypatch.setattr(
        tvmaze.requests, "get", lambda *a, **k: FakeResp()
    )
    with pytest.raises(tvmaze.TVMazeError):
        tvmaze.get_show("zzzz no such show zzzz")
