#!/usr/bin/env bash
#
# INVERSION IS ONE LADDER THROUGH ZERO.
#
# Up rotates the lowest voice an octave up; down rotates the HIGHEST voice an
# octave down, so each detent moves exactly one voice and a sweep of -3..+3
# walks steadily. It used to do |inv| UPWARD rotations and then drop the whole
# chord an octave -- so the two halves MIRRORED instead of continuing, and
# inv=-3 came out byte-identical to inv=0: a wasted position in the middle of a
# seven-step control.
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
if ! cc -O1 -I src -o "$OUT/inv" tests/host/test_stacks_inversion.c -lpthread -lm 2>"$OUT/err"; then
    echo "FAIL: test_stacks_inversion.c did not build"; sed -n '1,12p' "$OUT/err"; exit 1
fi
if "$OUT/inv" > "$OUT/log" 2>&1; then
    echo "PASS: $(basename "$0")  (inversion is one continuous ladder)"
else
    echo "FAIL: the inversion sequence is wrong"; cat "$OUT/log"; exit 1
fi
