# bingebreak

Stop binge-watching at the *right* episode. `bingebreak` looks up a show's
episodes, rates how each one **ends** (clean break / mild hook / cliffhanger),
and tells you where to stop tonight so you don't get sucked into "just one
more". All output is **spoiler-free** — it describes the *shape* of an ending,
never the plot.

Two front-ends:

- **Chrome extension** (`extension/`, Manifest V3) — the main tool: finds the
  natural stopping point *inside* the episode you're watching (plot summaries
  aligned to caption timestamps; no API keys, no LLM) and pauses the player
  there. See the [extension README](extension/README.md).
- **CLI** (`src/bingebreak/`, Python) — episode-level planning, documented
  below.

## How it works

1. **Episode data** comes from the free [TVMaze API](https://www.tvmaze.com/api)
   (no key needed).
2. **Ending classification**:
   - With Anthropic credentials (`ANTHROPIC_API_KEY`), Claude
     (`claude-opus-4-8` by default) rates each episode's final minutes from
     its knowledge of the show, with a per-episode confidence level.
   - Without credentials (or with `--no-llm`), an offline heuristic engine
     scores risk from structure: genre, season finales, two-parters,
     "to be continued" markers.
   - Structural facts always win: a known Part-1-of-2 episode stays
     high-risk even if the model scores it low.
3. **The planner** fits episodes into your time budget and stops you on the
   latest low-risk ending — and warns you when the *next* episode is a trap.

Results are cached under `~/.cache/bingebreak/` (show data 7 days, Claude
ratings 30 days); use `--refresh` to bypass.

## Install

```sh
cd tv-anti-binge
uv venv && uv pip install -e ".[dev]"
source .venv/bin/activate
```

## Usage

```sh
# Find the exact show
bingebreak search "the office"

# Per-episode ending-risk table for a season
bingebreak analyze "Breaking Bad" --season 2

# Tonight's plan: start at S02E03, 2-hour budget
bingebreak plan "Breaking Bad" --season 2 --episode 3 --minutes 120

# Cap by episode count instead of time
bingebreak plan "Severance" --season 1 --episode 4 --episodes 3

# Force offline mode / force re-rating
bingebreak analyze "Dark" --season 1 --no-llm
bingebreak plan "Dark" --season 1 --refresh
```

Example output:

```
Breaking Bad — tonight's plan, starting at S02E03 (120 min budget)
scores from: Claude (claude-opus-4-8) + structural heuristics

 → STOP  S02E03  clean break   60m (total 60m)   Bit by a Dead Bee
          immediate crisis settles; quiet closing scene
         S02E04  mild hook     60m (total 120m)  Down

Stop after S02E03 — clean ending — a natural place to stop. Tonight: 1 episode(s), 60 minutes.
```

## Spoiler policy

Claude is instructed to never name characters, deaths, reveals, or plot
events — notes describe only the ending's shape ("ends mid-crisis, flows
straight into the next episode"). When unsure, it errs toward *higher* risk:
a false "cliffhanger" costs nothing; a false "clean" ruins your night.

## Development

```sh
pytest          # offline test suite (TVMaze and Claude are never called)
```
