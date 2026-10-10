#!/usr/bin/env bash
# Join rendered parts, mux audio, encode a Twitter-ready MP4, commit and push.
set -euo pipefail
PARTS="$1"; ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PARTS"
printf "file '%s'\n" p0.mp4 p1.mp4 p2.mp4 > list.txt
ffmpeg -y -loglevel error -f concat -safe 0 -i list.txt -c copy joined.mp4
mkdir -p "$ROOT/output"
ffmpeg -y -loglevel error -i joined.mp4 -i "$ROOT/audio/mix.wav" \
  -c:v libx264 -preset slow -crf 19 -profile:v high -level 4.2 -pix_fmt yuv420p -r 30 -g 60 -movflags +faststart \
  -c:a aac -b:a 192k -ar 48000 -shortest "$ROOT/output/startale-bond-jpysc-16x9.mp4"
ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$ROOT/output/startale-bond-jpysc-16x9.mp4"
cd "$ROOT/.."
git add motion/output/startale-bond-jpysc-16x9.mp4 motion/tools/finalize.sh
git commit -qm "Add rendered Startale Bond × JPYSC video (1920x1080, 30fps, voiceover)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RAe6vhsggQ2ZB3r4w5WKQ3"
for i in 1 2 3 4; do git push -u origin ccr-8e509b13-1pscao && break || sleep $((2**i)); done
echo FINALIZED
