#!/bin/bash
#
# Playback, the stamp and the wire must all ask ONE function how loud a note is.
#
# WHY.  humanised_velocity() answers a DEVIATION around the GLOBAL velocity; it
# knows nothing about the chord's own Chord Vel offset. Playback added that back
# by hand (`base_vel + (humanised - velocity)`) and the stamp did not -- it
# wrote humanised_velocity() straight into the clip. So a chord set to -63
# played quiet and stamped at full level, contradicting the one thing Stamp
# promises: that the clip is the take Preview played. Nothing caught it because
# nothing compared the two sites, and the symptom only appears later, in a clip
# heard without the module.
#
# The fix was note_velocity(), used by all three. This test pins that shape:
# humanised_velocity may have exactly ONE caller, and it must be note_velocity.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$ROOT/src/modules/midi_fx/stacks/dsp/stacks.c"
[ -f "$SRC" ] || { echo "FAIL: $SRC not found"; exit 1; }

fail=0

# Calls, not the definition: the definition line starts with `static int`.
calls=$(grep -n "humanised_velocity(st" "$SRC" | grep -v "^[0-9]*:static " || true)
n=$(printf '%s' "$calls" | grep -c . || true)
if [ "$n" -ne 1 ]; then
  echo "FAIL: humanised_velocity() has $n callers, want exactly 1 (note_velocity)."
  echo "      A second caller is how the stamp and playback drifted apart:"
  printf '%s\n' "$calls" | sed 's/^/        /'
  fail=1
else
  # And that one caller must be inside note_velocity().
  line=${calls%%:*}
  ctx=$(sed -n "$((line-4)),${line}p" "$SRC")
  if ! printf '%s' "$ctx" | grep -q "note_velocity"; then
    echo "FAIL: the sole humanised_velocity() call is not inside note_velocity()"
    fail=1
  fi
fi

# The three consumers must go through the shared helper.
for site in \
  "note_velocity(st, &st->prog.ch\[k\], k, i)" \
  "note_velocity(st, c, step, i)" \
  "note_velocity(st, c, k, i)"
do
  if ! grep -q "$site" "$SRC"; then
    echo "FAIL: expected a call site missing: $site"
    fail=1
  fi
done

# note_velocity must fold in the chord's own offset -- that omission WAS the bug.
if ! grep -A 3 "^static int note_velocity" "$SRC" | grep -q "st->velocity + c->vel"; then
  echo "FAIL: note_velocity() does not add the chord's Chord Vel offset"
  fail=1
fi

[ "$fail" -eq 0 ] || exit 1
echo "PASS: playback, stamp and wire all take note velocity from note_velocity()"
