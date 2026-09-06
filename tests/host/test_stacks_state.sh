#!/usr/bin/env bash
#
# A PRESET MUST RESTORE WHAT IT SAVED.
#
# `state` is the opaque blob the platform's My Presets pages and the per-slot
# autosave both round-trip. It used to write root.shape.inv.len.off and nothing
# else, so saving silently discarded Spread, Strum, per-chord Velocity and
# Gate, Mute, Rhythm, Transpose, and every global but four -- including Key and
# Scale. A preset that restores a different sound than it saved is worse than
# no preset, because you only find out after the original is gone.
#
# Builds the module and compares a full snapshot against the snapshot of a
# fresh instance restored from it. Byte-identical or it fails.
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
if ! cc -O1 -I src -o "$OUT/state" tests/host/test_stacks_state.c -lpthread -lm 2>"$OUT/err"; then
    echo "FAIL: test_stacks_state.c did not build"; sed -n '1,12p' "$OUT/err"; exit 1
fi
if "$OUT/state" > "$OUT/log" 2>&1; then
    echo "PASS: $(basename "$0")  (state round-trips the whole instrument)"
else
    echo "FAIL: a preset would not restore what it saved"; cat "$OUT/log"; exit 1
fi
