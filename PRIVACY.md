# BingeBreak privacy policy

BingeBreak finds natural stopping points inside TV episodes. It is designed
to process everything on your device.

## What the extension processes

- **Episode captions** (from the player's text tracks, a downloaded community
  subtitle file, or a file you choose) are analyzed entirely on your device
  to find scene breaks. They are never uploaded anywhere.
- **The show/episode you look up** is sent as a search query to public,
  keyless metadata services: TVMaze (episode lists), Wikipedia (plot
  summaries), and Gestdown/Addic7ed (subtitle files).
- **Plot-to-scene matching** runs on your device using a bundled machine-
  learning model. The model weights are downloaded once from the Hugging Face
  Hub (a static file download) and cached by your browser. No text you
  process is ever sent to Hugging Face or anyone else.
- **On Netflix watch pages**, the extension asks Netflix's own metadata API
  (using your existing Netflix session, from the page itself) which episode
  is playing, solely to prefill the popup.

## What the extension stores

Settings, lookup caches, and the armed stop point are stored locally in
`chrome.storage.local`. Nothing is synced or transmitted.

## What the extension does NOT do

- No accounts, no sign-in, no API keys.
- No analytics, telemetry, or tracking of any kind.
- No sale or transfer of data to anyone. There is no server to send it to.
- No reading of browsing history; the extension only acts on the active tab
  when you open its popup, and on the streaming sites listed in its manifest.

## Contact

Open an issue at https://github.com/rsoatto/tv-anti-binge.
