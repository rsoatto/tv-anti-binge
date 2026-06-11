#!/bin/bash
# Build a distributable extension zip: runtime files only.
# Usage: bash scripts/package.sh   ->  dist/bingebreak-<version>.zip
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
OUT="dist/bingebreak-${VERSION}.zip"
mkdir -p dist
rm -f "$OUT"

# Whitelist — everything the manifest references, nothing else.
zip -qr "$OUT" \
  manifest.json \
  sw.js \
  background.js \
  embed-engine.js \
  content.js \
  lib \
  popup \
  options \
  vendor \
  icons \
  -x "*.DS_Store"

# Sanity: every file path mentioned in the manifest must exist in the zip.
python3 - "$OUT" <<'EOF'
import json, re, sys, zipfile
names = set(zipfile.ZipFile(sys.argv[1]).namelist())
manifest = json.load(open("manifest.json"))
refs = re.findall(r'"([\w/.-]+\.(?:js|html|png|json|wasm))"', json.dumps(manifest))
missing = [r for r in refs if r not in names]
if missing:
    sys.exit(f"manifest references missing from zip: {missing}")
print(f"ok: {sys.argv[1]} ({len(names)} files), all manifest references present")
EOF

du -h "$OUT"
