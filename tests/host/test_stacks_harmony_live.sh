#!/usr/bin/env bash
#
# KEY, OCTAVE DEFAULT AND SCALE ARE LIVE.
#
# They live on MAIN and transform whatever is in the buffer -- a library
# progression, a clip read, or chords built by hand. They used to be load-time
# only: roots were baked absolute and nothing re-derived them, so turning Key
# re-snapped SOME chords and left others, producing a progression in neither
# key with no error reported anywhere.
#
# The C half pins four properties, including the convergence one: setting the
# harmony before browsing and after browsing must reach the same notes.
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
if ! cc -O1 -I src -o "$OUT/harm" tests/host/test_stacks_harmony_live.c -lpthread -lm 2>"$OUT/err"; then
    echo "FAIL: test_stacks_harmony_live.c did not build"; sed -n '1,12p' "$OUT/err"; exit 1
fi
if "$OUT/harm" > "$OUT/log" 2>&1; then
    echo "PASS: $(basename "$0")  (Key/Oct/Scale transform the buffer)"
else
    echo "FAIL: harmony controls are not live"; cat "$OUT/log"; exit 1
fi
