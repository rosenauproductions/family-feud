#!/usr/bin/env bash
# Fullscreen projector display with autoplay enabled (sound on boot).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="${FEUD_DISPLAY_URL:-http://localhost:3456/display/}"
BASE="${URL%/display/}"
CHROMIUM="${CHROMIUM:-}"

if [[ -z "$CHROMIUM" ]]; then
  for candidate in chromium-browser chromium google-chrome google-chrome-stable; do
    if command -v "$candidate" >/dev/null 2>&1; then
      CHROMIUM="$candidate"
      break
    fi
  done
fi

if [[ -z "$CHROMIUM" ]]; then
  echo "No Chromium/Chrome binary found. Set CHROMIUM=/path/to/chromium." >&2
  exit 1
fi

echo "Waiting for Family Feud server at ${BASE}..."
for _ in $(seq 1 90); do
  if curl -sf "${BASE}/" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

exec "$CHROMIUM" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --autoplay-policy=no-user-gesture-required \
  "$URL"
