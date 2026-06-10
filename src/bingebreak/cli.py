"""bingebreak command-line interface."""

from __future__ import annotations

import argparse
import sys

from . import cache, classify, heuristics, planner, render, tvmaze

SHOW_CACHE_TTL = 7 * 24 * 3600  # episode lists rarely change week to week


def _fetch_show(query: str, refresh: bool) -> dict:
    key = f"show_{query.lower().strip()}"
    if not refresh:
        cached = cache.get(key, max_age_seconds=SHOW_CACHE_TTL)
        if cached is not None:
            return cached
    show = tvmaze.get_show(query)
    cache.set(key, show)
    return show


def _score_episodes(
    show: dict,
    episodes: list[dict],
    use_llm: bool,
    model: str,
    refresh: bool,
) -> tuple[list[dict], str]:
    """Attach risk/ending/note/flags to each episode. Returns (episodes, source)."""
    seasons = sorted({e["season"] for e in episodes})
    llm_scores: dict[tuple[int, int], dict] = {}
    source = "offline heuristics (structure + genre; no Anthropic credentials used)"

    if use_llm:
        try:
            for season in seasons:
                llm_scores.update(
                    classify.classify_season(show, season, model=model, refresh=refresh)
                )
            source = f"Claude ({model}) + structural heuristics"
        except classify.ClassifierUnavailable as exc:
            llm_scores = {}
            print(
                f"note: Claude classifier unavailable ({exc}); "
                "falling back to offline heuristics.\n",
                file=sys.stderr,
            )

    scored = []
    for ep in episodes:
        h = heuristics.score_episode(ep, show["episodes"], show["genres"])
        llm = llm_scores.get((ep["season"], ep["number"]))
        if llm is not None:
            risk = llm["risk"]
            # Structural facts beat recall: a known two-parter/'to be continued'
            # episode stays high-risk even if the model scored it low.
            if any("multi-part story" in f or "to be continued" in f for f in h["flags"]):
                risk = max(risk, h["risk"])
            ep = {
                **ep,
                "risk": risk,
                "ending": heuristics.tier(risk),
                "note": llm["note"],
                "confidence": llm["confidence"],
                "flags": h["flags"],
            }
        else:
            ep = {**ep, **h, "note": "", "confidence": "low"}
        scored.append(ep)
    return scored, source


def cmd_search(args: argparse.Namespace) -> int:
    shows = tvmaze.search_shows(args.query)
    if not shows:
        print("No shows found.")
        return 1
    for s in shows[:10]:
        genres = ", ".join(s["genres"])
        print(f"{s['name']} ({s['premiered'] or '?'}) — {s['status']} — {genres}")
    return 0


def cmd_analyze(args: argparse.Namespace) -> int:
    show = _fetch_show(args.show, args.refresh)
    episodes = show["episodes"]
    if args.season is not None:
        episodes = [e for e in episodes if e["season"] == args.season]
        if not episodes:
            print(f"No episodes found for season {args.season}.", file=sys.stderr)
            return 1
    scored, source = _score_episodes(
        show, episodes, use_llm=not args.no_llm, model=args.model, refresh=args.refresh
    )
    print(render.render_analysis(show, scored, source))
    return 0


def cmd_plan(args: argparse.Namespace) -> int:
    show = _fetch_show(args.show, args.refresh)
    episodes = [
        e
        for e in show["episodes"]
        if (e["season"], e["number"]) >= (args.season, args.episode)
    ]
    if not episodes:
        print("No episodes at or after that starting point.", file=sys.stderr)
        return 1

    # Score a lookahead window (enough to cover any sane budget) + one extra
    # episode so the "don't start the next one" warning is always informed.
    budget = args.minutes
    if budget is None and args.episodes is None:
        budget = 120
    if args.episodes is not None:
        lookahead = args.episodes + 1
    else:
        lookahead = 1
        total = 0
        for e in episodes:
            total += e["runtime"]
            if total > budget:
                break
            lookahead += 1
        lookahead += 1
    window = episodes[:lookahead]

    scored, source = _score_episodes(
        show, window, use_llm=not args.no_llm, model=args.model, refresh=args.refresh
    )
    plan = planner.build_plan(
        scored, budget_minutes=budget, max_episodes=args.episodes
    )
    print(render.render_plan(show, plan, budget, source))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="bingebreak",
        description=(
            "Find natural stopping points in TV shows so you don't end the "
            "night on a cliffhanger. Episode data from TVMaze; ending "
            "classification by Claude when ANTHROPIC_API_KEY is set, "
            "offline heuristics otherwise."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_search = sub.add_parser("search", help="find a show by name")
    p_search.add_argument("query")
    p_search.set_defaults(func=cmd_search)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("show", help="show name (best TVMaze match is used)")
    common.add_argument(
        "--no-llm", action="store_true", help="skip Claude; heuristics only"
    )
    common.add_argument(
        "--model", default=classify.DEFAULT_MODEL, help="Claude model id"
    )
    common.add_argument(
        "--refresh", action="store_true", help="bypass caches and refetch/rescore"
    )

    p_analyze = sub.add_parser(
        "analyze", parents=[common], help="per-episode ending-risk table"
    )
    p_analyze.add_argument("--season", type=int, help="limit to one season")
    p_analyze.set_defaults(func=cmd_analyze)

    p_plan = sub.add_parser(
        "plan", parents=[common], help="plan tonight's viewing with a safe stop"
    )
    p_plan.add_argument("--season", type=int, default=1, help="starting season")
    p_plan.add_argument("--episode", type=int, default=1, help="starting episode")
    p_plan.add_argument(
        "--minutes", type=int, default=None, help="time budget (default 120)"
    )
    p_plan.add_argument(
        "--episodes", type=int, default=None, help="cap on episode count instead"
    )
    p_plan.set_defaults(func=cmd_plan)

    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except tvmaze.TVMazeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
