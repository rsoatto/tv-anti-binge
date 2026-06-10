from bingebreak.heuristics import score_episode, tier


def _ep(season, number, title="Episode", summary=""):
    return {
        "season": season,
        "number": number,
        "title": title,
        "summary": summary,
        "runtime": 45,
    }


def _season(n_eps, season=1, titles=None):
    return [
        _ep(season, i + 1, (titles or {}).get(i + 1, f"Episode {i + 1}"))
        for i in range(n_eps)
    ]


def test_tier_boundaries():
    assert tier(35) == "clean"
    assert tier(36) == "soft_hook"
    assert tier(65) == "soft_hook"
    assert tier(66) == "cliffhanger"


def test_part_one_is_high_risk():
    eps = _season(10, titles={5: "The Heist (Part 1)", 6: "The Heist (Part 2)"})
    result = score_episode(eps[4], eps, ["Comedy"])
    assert result["risk"] >= 85
    assert any("multi-part" in f for f in result["flags"])


def test_part_two_is_treated_as_resolution():
    eps = _season(10, titles={5: "The Heist (Part 1)", 6: "The Heist (Part 2)"})
    part1 = score_episode(eps[4], eps, ["Drama"])
    part2 = score_episode(eps[5], eps, ["Drama"])
    assert part2["risk"] < part1["risk"]
    assert any("conclusion" in f for f in part2["flags"])


def test_to_be_continued_in_summary():
    eps = _season(10)
    eps[2]["summary"] = "A quiet day at the office. To be continued..."
    result = score_episode(eps[2], eps, ["Comedy"])
    assert result["risk"] >= 85


def test_finale_of_continuing_show_flagged_and_riskier():
    eps = _season(10, season=1) + _season(10, season=2)
    mid = score_episode(eps[4], eps, ["Drama"])
    finale = score_episode(eps[9], eps, ["Drama"])
    assert "season finale" in finale["flags"]
    assert finale["risk"] > mid["risk"]


def test_final_season_finale_not_inflated():
    eps = _season(10, season=1)
    finale = score_episode(eps[9], eps, ["Drama"])
    mid = score_episode(eps[4], eps, ["Drama"])
    assert "season finale" in finale["flags"]
    assert finale["risk"] == mid["risk"]


def test_comedy_lower_base_than_thriller():
    eps = _season(10)
    comedy = score_episode(eps[2], eps, ["Comedy"])
    thriller = score_episode(eps[2], eps, ["Thriller"])
    assert comedy["risk"] < thriller["risk"]


def test_cross_season_two_parter():
    # e.g. TNG: S3 finale "The Best of Both Worlds" -> S4E01 "..., Part II"
    eps = _season(26, season=3) + _season(26, season=4)
    eps[25]["title"] = "The Best of Both Worlds"
    eps[26]["title"] = "The Best of Both Worlds, Part II"
    finale = score_episode(eps[25], eps, ["Science-Fiction"])
    assert finale["risk"] >= 85
    assert any("multi-part" in f for f in finale["flags"])


def test_plain_finale_title_not_marked_as_conclusion():
    eps = _season(10, titles={10: "Finale"})
    result = score_episode(eps[9], eps, ["Comedy"])
    assert not any("conclusion" in f for f in result["flags"])


def test_risk_clamped():
    eps = _season(3, titles={2: "Doom (Part 1)"})
    eps[1]["summary"] = "Kidnapped! Betrayal! Cliffhanger! To be continued."
    result = score_episode(eps[1], eps, ["Thriller"])
    assert 5 <= result["risk"] <= 95
