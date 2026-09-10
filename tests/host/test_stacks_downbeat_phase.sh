#!/usr/bin/env bash
#
# The chords must land ON Move's grid, not one clock before it. See the C file
# for the measurement and src/host/transport_grid.h for the war story this
# shares with the metronome and quantized recall.
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
if ! cc -O1 -I src -o "$OUT/phase" tests/host/test_stacks_downbeat_phase.c -lpthread -lm 2>"$OUT/err"; then
    echo "FAIL: test_stacks_downbeat_phase.c did not build"; sed -n '1,12p' "$OUT/err"; exit 1
fi
if "$OUT/phase" > "$OUT/log" 2>&1; then
    echo "PASS: $(basename "$0")  (chords land on the downbeat)"
else
    echo "FAIL: the chords are off Move's grid"; cat "$OUT/log"; exit 1
fi
