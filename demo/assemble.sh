#!/usr/bin/env bash
# Assemble the captured frames into the submission video.
#
# The frames are real screenshots of the running app, captured at 10 fps while
# it was being driven. Playing them back at 10 fps restores real-time motion.
set -euo pipefail
cd "$(dirname "$0")/.."

FPS=10
FRAMES=demo/frames
OUT=demo/astromesh-round2.mp4

n=$(ls "$FRAMES" | wc -l)
echo "  ${n} frames  →  $(python3 -c "print(f'{${n}/${FPS}:.0f}s')") of video"

ffmpeg -y -loglevel error \
  -framerate "$FPS" -i "$FRAMES/f%05d.png" \
  -c:v libx264 -pix_fmt yuv420p -crf 20 \
  -movflags +faststart \
  -vf "scale=1600:900:flags=lanczos,format=yuv420p" \
  "$OUT"

echo "  → $OUT  ($(du -h "$OUT" | cut -f1))"
