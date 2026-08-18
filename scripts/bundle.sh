#!/usr/bin/env bash
# Builds the extension and wraps it in a zip somebody can actually install.
#
# Chrome's "Load unpacked" wants a folder, not a zip, so this ships the folder
# inside the zip along with the four steps, rather than the bare dist contents
# the way a Web Store upload would.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(node -p "require('$root/apps/extension/package.json').version")"
out="$root/abode-extension.zip"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

echo "building v$version..."
pnpm --filter @abode/extension build >/dev/null

cp -R "$root/apps/extension/dist" "$stage/abode"

cat > "$stage/Install Abode.txt" <<TXT
Abode $version

1. Unzip this somewhere you will not delete by accident.
2. Open chrome://extensions
3. Turn on "Developer mode", top right.
4. Click "Load unpacked" and pick the "abode" folder from this zip.

Then open something to watch, click the Abode icon in the toolbar, and press
"Start watching together". Send whoever you are watching with the link it gives
you. They open it and they are in the room.

Play, pause and seek with the site's own player. Everybody follows.

TXT

( cd "$stage" && zip -qr "$out" . )
echo "wrote $out ($(du -h "$out" | cut -f1))"
