#!/usr/bin/env bash
#
# UNDO / REDO, ON MOVE'S OWN UNDO BUTTON.
#
# Undo stores whole progressions rather than a log of edits: a 16-chord buffer
# is under a kilobyte, so the STATE is cheaper than the description and cannot
# drift the way an edit log with forty inverses would.
#
# Two failures this pins, both found by running it: an edit that is not
# captured at all (the capture happens on EVERY write, not on a hand-kept list
# of mutating keys), and an undo that restores the chords but not the clip
# length, because `bars` lives outside the progression struct.
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
if ! cc -O1 -I src -o "$OUT/undo" tests/host/test_stacks_undo.c -lpthread -lm 2>"$OUT/err"; then
    echo "FAIL: test_stacks_undo.c did not build"; sed -n '1,12p' "$OUT/err"; exit 1
fi
if "$OUT/undo" > "$OUT/log" 2>&1; then
    echo "PASS: $(basename "$0")  (undo restores the progression and the clip)"
else
    echo "FAIL: undo does not restore what was changed"; cat "$OUT/log"; exit 1
fi
