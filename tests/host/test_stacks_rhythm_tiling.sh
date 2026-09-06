#!/usr/bin/env bash
#
# "HOLD" MEANS ONCE; EVERY OTHER RHYTHM IS A BAR AND TILES.
#
# A mask covers one BAR and repeats across the chord -- a clave over a two-bar
# chord is two claves. `hold` is the degenerate mask (one hit at position 0)
# and tiling it re-articulated the chord every bar: a two-bar chord PLAYED and
# DREW as two one-bar chords. Reachable only once `len` became an absolute
# duration, because before that a chord and the rhythm shared one unit by
# construction.
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
if ! cc -O1 -I src -o "$OUT/rt" tests/host/test_stacks_rhythm_tiling.c -lpthread -lm 2>"$OUT/err"; then
    echo "FAIL: test_stacks_rhythm_tiling.c did not build"; sed -n '1,12p' "$OUT/err"; exit 1
fi
if "$OUT/rt" > "$OUT/log" 2>&1; then
    echo "PASS: $(basename "$0")  (hold strikes once; figures tile per bar)"
else
    echo "FAIL: a held chord re-articulates"; cat "$OUT/log"; exit 1
fi
