from bingebreak.planner import build_plan


def _ep(number, risk, runtime=45, season=1):
    return {
        "season": season,
        "number": number,
        "title": f"Episode {number}",
        "runtime": runtime,
        "risk": risk,
        "ending": "clean" if risk <= 35 else ("soft_hook" if risk <= 65 else "cliffhanger"),
        "note": "",
        "flags": [],
    }


def test_empty_input():
    plan = build_plan([])
    assert plan.items == [] and plan.stop_index is None


def test_budget_limits_window():
    eps = [_ep(i, 20) for i in range(1, 6)]
    plan = build_plan(eps, budget_minutes=100)  # 45m each -> 2 fit
    assert len(plan.items) == 2
    assert plan.items[-1].cumulative_minutes == 90


def test_stops_on_latest_clean_ending():
    eps = [_ep(1, 20), _ep(2, 80), _ep(3, 30), _ep(4, 90)]
    plan = build_plan(eps, budget_minutes=180)  # all 4 fit
    assert plan.stop_index == 2  # E3, latest clean
    assert "clean" in plan.rationale


def test_falls_back_to_soft_hook():
    eps = [_ep(1, 80), _ep(2, 50), _ep(3, 90)]
    plan = build_plan(eps, budget_minutes=180)
    assert plan.stop_index == 1


def test_all_cliffhangers_picks_least_severe():
    eps = [_ep(1, 90), _ep(2, 70), _ep(3, 95)]
    plan = build_plan(eps, budget_minutes=180)
    assert plan.stop_index == 1
    assert "cliffhanger" in plan.rationale


def test_max_episodes_cap():
    eps = [_ep(i, 20) for i in range(1, 10)]
    plan = build_plan(eps, max_episodes=3)
    assert len(plan.items) == 3


def test_single_episode_over_budget_still_included():
    eps = [_ep(1, 20, runtime=90)]
    plan = build_plan(eps, budget_minutes=60)
    assert len(plan.items) == 1
    assert plan.overflow


def test_next_episode_reported():
    eps = [_ep(1, 20), _ep(2, 90)]
    plan = build_plan(eps, budget_minutes=45)  # only E1 fits
    assert plan.stop_index == 0
    assert plan.next_episode is not None and plan.next_episode["number"] == 2


def test_no_next_episode_at_series_end():
    eps = [_ep(1, 20)]
    plan = build_plan(eps, budget_minutes=200)
    assert plan.next_episode is None


def test_default_budget_when_nothing_given():
    eps = [_ep(i, 20) for i in range(1, 10)]
    plan = build_plan(eps)  # default 120 min -> 2 x 45m fit
    assert len(plan.items) == 2
