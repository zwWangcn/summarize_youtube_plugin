#!/usr/bin/env bash
# Render Chrome Web Store images with Windows Chrome (headless) from WSL.
# Prereq: `npx vite --config scripts/store-shots/vite.config.ts` running on :5199.
# Usage: scripts/store-shots/render.sh [lang ...]   (default: all languages)
set -euo pipefail
cd "$(dirname "$0")/../.."
CHROME="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
RAW="scripts/store-shots/out"
DEST="assets/store-listing/v2"
mkdir -p "$RAW"
WINRAW=$(wslpath -w "$PWD/$RAW")
LANGS=("${@:-zh-CN zh-TW en ja ko}")
SHOTS=(01:poster 02:summary 03:bilingual 04:chat 05:transcript)

shoot() { # name url width height
  (cd /mnt/c && timeout 90 "$CHROME" --headless=new --user-data-dir='C:\chrome-shot-profile' \
    --hide-scrollbars --force-device-scale-factor=1 --window-size="$3,$4" \
    --virtual-time-budget=20000 --screenshot="$WINRAW\\$1.png" "$2" >/dev/null 2>&1)
}

for lang in ${LANGS[@]}; do
  for entry in "${SHOTS[@]}"; do
    n=${entry%%:*}; shot=${entry#*:}
    shoot "$lang-$n-$shot" "http://127.0.0.1:5199/?shot=$shot&lang=$lang" 1280 800
    echo "rendered $lang $n-$shot"
  done
done
shoot "promo-small-440x280" "http://127.0.0.1:5199/?shot=tile&lang=en" 440 280
shoot "promo-marquee-1400x560" "http://127.0.0.1:5199/?shot=marquee&lang=en" 1400 560

# Flatten to 24-bit RGB PNG (store rejects alpha) and file into DEST/<lang>/.
node --input-type=module -e '
import sharp from "sharp"; import fs from "node:fs"; import path from "node:path";
const [raw, dest] = process.argv.slice(1);
for (const f of fs.readdirSync(raw).filter((x) => x.endsWith(".png"))) {
  const m = f.match(/^(zh-CN|zh-TW|en|ja|ko)-(.+)$/);
  const out = m ? path.join(dest, m[1], m[2]) : path.join(dest, f);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp(path.join(raw, f)).flatten({ background: "#000" }).removeAlpha().png({ compressionLevel: 9 }).toFile(out);
  const meta = await sharp(out).metadata();
  console.log(out, meta.width + "x" + meta.height, "channels=" + meta.channels);
}' "$RAW" "$DEST"
