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
   - **semantic similarity from a bundled on-device embedding model**
     (`all-MiniLM-L6-v2` quantized, run by transformers.js inside the
     service worker — [embed-engine.js](embed-engine.js)). This bridges the
     paraphrase gap (summaries say "discovers the ledger", dialogue never
     does). The WASM runtime ships in `vendor/`; the ~25 MB weights download
     once from the Hugging Face Hub and cache in the browser. Nothing is
     uploaded, no servers, no accounts, no API tokens.
4. If the alignment lacks evidence (short synopsis, weak match), the tool
   says so and falls back to the strongest *measured* scene break late in
   the episode — never an invented "N minutes before the end". Evidence
   thresholds are calibrated from measurements, not guessed
   ([scripts/calibrate-margins.mjs](scripts/calibrate-margins.mjs)): mean
   assigned margin across beats measures 0.365 for a matched summary, 0.186
   for a zero-word-overlap paraphrase, 0.046 for mismatched content — gated
   at 0.10, with a 0.08 floor on the stop-placing final beat.

## Use

Click the icon — the show *and* season/episode prefill from the active tab
(the content script reads the player UI on Netflix/Prime/etc., falling back
to tab-title parsing; [lib/detect.js](lib/detect.js)). Hit "Find tonight's
stop point": a progress bar tracks the stages (episode lookup → subtitle
download → plot fetch → local model → alignment), streamed from the service
worker over a long-lived port. If every automatic caption source fails, an
inline panel offers a subtitle-file picker — canceling it simply returns to
idle. Then "Arm the guard" and go back to watching.

## The on-device model

No setup. The first "Find tonight's stop point" downloads the quantized
model weights (~25 MB) from the Hugging Face Hub — progress is shown in the
popup — and the browser caches them; afterwards it runs instantly and
offline. If the first run happens offline, the result is computed
lexical-only and labeled as such in the footer; the next online run picks
the model up. MV3 notes: the service worker uses the `transformers.web`
build (standard builds use dynamic `import()`, which service workers
forbid), single-threaded WASM (workers can't spawn workers), and
`wasm-unsafe-eval` CSP for WASM compilation.

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

Network requests go only to `api.tvmaze.com` / `en.wikipedia.org` (episode
metadata), `api.gestdown.info` (subtitle download), and `huggingface.co`
(one-time model weights download). Captions are analyzed on-device and never
uploaded. Lookups cache in `chrome.storage.local`.

## Tests

```sh
npm test   # node --test: parsers, scene segmentation, alignment + evidence
           # gates, guard state machine, service-worker pipeline (stubbed chrome.*)
```

The episode-level views (night plan / season overview) use the structural
heuristics shared with the Python CLI in the parent directory
([lib/heuristics.js](lib/heuristics.js), [lib/planner.js](lib/planner.js)) —
keep those ports in sync.
