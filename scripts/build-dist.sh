#!/usr/bin/env bash
# Build a GitHub-Pages-ready dist/ folder from the JobPilot web app.
# Used by humans (bash scripts/build-dist.sh) and by .github/workflows/deploy-pages.yml
set -euo pipefail
cd "$(dirname "$0")/.."

DIST="${1:-dist}"
rm -rf "$DIST"
mkdir -p "$DIST"

cp index.html "$DIST/"
cp -r css js "$DIST/"
touch "$DIST/.nojekyll"   # skip Jekyll processing — faster, serves every file as-is

# sanity: every asset referenced by index.html must exist in dist/
missing=0
while IFS= read -r f; do
  if [ ! -f "$DIST/$f" ]; then
    echo "MISSING in dist/: $f" >&2
    missing=1
  fi
done < <(grep -oE '(js|css)/[A-Za-z0-9./_-]+' index.html | sort -u)
if [ "$missing" -ne 0 ]; then exit 1; fi

FILES=$(find "$DIST" -type f | wc -l)
echo "✅ $DIST/ built ($FILES files)"
echo "   Deploy target: https://<user>.github.io/<repo>/  (relative paths, works from any subpath)"
