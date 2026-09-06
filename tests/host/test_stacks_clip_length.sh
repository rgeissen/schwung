#!/usr/bin/env bash
#
# THE CLIP IS THE LOOP LENGTH -- for what plays, what is drawn, and what is
# stamped.
#
# Two bugs that hid each other: browsing a progression did not grow the clip
# (a 12-bar blues loaded into a 4-bar clip lost two thirds of itself, silently,
# with the chords still on screen), and the sequencer looped at the PROGRESSION
# length while the playhead looped at the CLIP length -- so they agreed only
# when the bars happened to be a multiple of the phrase.
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
if ! cc -O1 -I src -o "$OUT/clip" tests/host/test_stacks_clip_length.c -lpthread -lm 2>"$OUT/err"; then
    echo "FAIL: test_stacks_clip_length.c did not build"; sed -n '1,12p' "$OUT/err"; exit 1
fi
if "$OUT/clip" > "$OUT/log" 2>&1; then
    echo "PASS: $(basename "$0")  (the clip is the one loop length)"
else
    echo "FAIL: the clip length is not respected"; cat "$OUT/log"; exit 1
fi
