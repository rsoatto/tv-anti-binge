# BingeBreak — Chrome extension

Finds the natural stopping point **inside** a TV episode — the real scene
break right before the closing hook — and pauses the player there. Runs
entirely on your machine: **no accounts, no API keys, no LLM calls, no
tokens**. Spoiler-free: only timestamps ever reach the UI, never plot text.

## How the stop point is found

1. **Timestamps** come from the episode's own captions, tried in order:
   the player's text tracks (when the site exposes them), an automatic
   download of community subtitles (Addic7ed via the keyless Gestdown API,
   [lib/subfetch.js](lib/subfetch.js), cached 30 days), and only as a last
   resort a subtitle file you pick — offered inline, never a surprise
   dialog. Long dialogue silences mark the episode's real scene breaks
   ([lib/subtitles.js](lib/subtitles.js), [lib/scenes.js](lib/scenes.js)).
   Community subs can be offset a few seconds from streaming cuts; scene
   analysis tolerates this and the guard sanity-checks duration (±4 min).
2. **Known plot summaries** come from the episode's Wikipedia article (Plot
   section) when one exists, else the TVMaze synopsis
   ([lib/wiki.js](lib/wiki.js)).
3. The summary's beats are **aligned to the scenes** — plot order matches
   screen order, so a monotonic dynamic-programming alignment locates where
   the summary's *closing* beat begins on screen
   ([lib/align.js](lib/align.js)). The stop point is the measured scene break
   just before it. Matching combines:
   - lexical overlap with rare-word/proper-noun weighting, and
   - **semantic similarity from a small local embedding model**
     (`nomic-embed-text` via [Ollama](https://ollama.com),
     [lib/embed.js](lib/embed.js)) — this bridges the paraphrase gap
     (summaries say "discovers the ledger", dialogue never does). Fully
     on-device; nothing is uploaded, no API tokens of any kind.
4. If the alignment lacks evidence (short synopsis, weak match), the tool
   says so and falls back to the strongest *measured* scene break late in
   the episode — never an invented "N minutes before the end". Evidence
   thresholds are calibrated from measurements, not guessed: on the test
   fixture, a fully-paraphrased matching summary scores a semantic margin of
   ~0.13–0.24 and mismatched content ~0.02; the gate sits at 0.07
   (`SEM_MARGIN`, see tests/embed-live.test.mjs).

## Use

Click the icon — the show *and* season/episode prefill from the active tab
(the content script reads the player UI on Netflix/Prime/etc., falling back
to tab-title parsing; [lib/detect.js](lib/detect.js)). Hit "Find tonight's
stop point": a progress bar tracks the stages (episode lookup → subtitle
download → plot fetch → local model → alignment), streamed from the service
worker over a long-lived port. If every automatic caption source fails, an
inline panel offers a subtitle-file picker — canceling it simply returns to
idle. Then "Arm the guard" and go back to watching.

## Local model (optional but recommended)

Without Ollama running, alignment is lexical-only and works; with it,
paraphrased summaries align correctly. Setup (once):

```sh
# Ollama.app is installed at ~/Applications (menu-bar app, starts at login)
open ~/Applications/Ollama.app
ollama pull nomic-embed-text   # 274 MB, runs in milliseconds on Apple Silicon
```

The extension rewrites its Origin header for `localhost:11434` via a
declarativeNetRequest rule ([dnr_rules.json](dnr_rules.json)), so no
`OLLAMA_ORIGINS` configuration is needed. The popup footer shows which
matching engine was used for each result.

## The guard

"Arm the guard" in the popup stores the stop point; the content script
([content.js](content.js)) then watches playback on the streaming tab:

- countdown badge as the stop approaches;
- at the stop point: pause + overlay — **Done for tonight · +5 minutes ·
  Finish the episode**;
- choosing "finish" re-arms a final pause just before the credits, so
  autoplay never starts the next episode for you
  ([lib/guard.js](lib/guard.js)).

## Install (unpacked)

`chrome://extensions` → Developer mode → **Load unpacked** → this
`extension/` folder. No build step — plain ES modules.

## Privacy

Network requests go only to `api.tvmaze.com` and `en.wikipedia.org` (episode
metadata) and your own machine (`localhost:11434` for the local embedding
model). Captions are analyzed locally and never uploaded. Lookups cache in
`chrome.storage.local`.

## Tests

```sh
npm test   # node --test: parsers, scene segmentation, alignment + evidence
           # gates, guard state machine, service-worker pipeline (stubbed chrome.*)
```

The episode-level views (night plan / season overview) use the structural
heuristics shared with the Python CLI in the parent directory
([lib/heuristics.js](lib/heuristics.js), [lib/planner.js](lib/planner.js)) —
keep those ports in sync.
