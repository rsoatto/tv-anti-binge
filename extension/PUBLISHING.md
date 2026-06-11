# Publishing BingeBreak

## Build the artifact

```sh
bash scripts/package.sh        # -> dist/bingebreak-<version>.zip
```

The script whitelists runtime files only and verifies every manifest
reference is present. Bump `version` in manifest.json before each upload —
the store rejects re-used version numbers.

## Route A — share the zip directly (no store)

Send `dist/bingebreak-<version>.zip`; recipients unzip it and load it via
`chrome://extensions` → Developer mode → Load unpacked. Good for friends and
testing. Caveats: no auto-updates, Chrome shows a "developer mode" reminder,
and recipients must trust you. (Attaching the zip to a GitHub Release is the
tidy way to host it.)

## Route B — Chrome Web Store (the real distribution)

1. Register once at https://chrome.google.com/webstore/devconsole ($5 fee).
2. "New item" → upload the zip.
3. Listing needs: description, at least one 1280×800 screenshot of the popup
   (plus optionally the guard overlay), category (e.g. Workflow & Planning),
   and a privacy policy URL — use
   `https://github.com/rsoatto/tv-anti-binge/blob/main/PRIVACY.md`.
4. Visibility: **Unlisted** (anyone with the link can install — good first
   step) or Public. Review typically takes 1–3 days; host-permission
   extensions sometimes get a closer look.

### Privacy tab — ready-to-paste justifications

- **Single purpose**: Finds the natural stopping point inside the TV episode
  the user is watching and pauses playback there, to prevent binge-watching.
- **storage**: Caches public episode metadata/subtitles and stores the
  user's armed stop point and settings locally.
- **activeTab**: Reads the current tab's title/player state only when the
  user opens the popup, to prefill which show/episode they are watching.
- **scripting**: Re-injects the extension's own content script and reads
  player metadata on the active tab after the user invokes the popup.
- **Host: api.tvmaze.com / en.wikipedia.org**: Fetch public episode lists
  and plot summaries for the show the user typed.
- **Host: api.gestdown.info**: Download public community subtitle files for
  the episode, which are analyzed locally for scene timing.
- **Host: huggingface.co / *.hf.co**: One-time download of the bundled ML
  model's weight file (static data, cached by the browser). No user data is
  sent.
- **Content scripts on streaming sites**: Show a countdown badge and pause
  the player at the user's chosen stop point; read the player's title text
  to identify the episode.
- **Remote code**: None. All executable code ships in the package; the only
  runtime download is the model weights file, which is data, not code.

## After publishing

Store updates: bump the version, rebuild the zip, upload — users update
automatically. To refresh vendored libraries: `npm install`, then
`node scripts/vendorize.mjs`, then re-run the dev harness (`dev-test.html`
served over HTTP) and `npm test` before packaging.
