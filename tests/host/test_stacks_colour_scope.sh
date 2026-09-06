#!/usr/bin/env bash
#
# COLOUR IS SCOPED TO TWO OF THE THREE LIBRARIES.
#
# Stacks browses progressions from three places: Genre, Common and Uncommon.
# The genre entries are VOICED -- a jazz ii-V-I is m7-dom7-maj7 because that is
# what makes it jazz -- so a global "make everything ninths" would quietly turn
# the library into something else. Common and Uncommon are plain triads with no
# style of their own, which is what Colour is for.
#
# The C half asserts the DIFFERENCE between the two, because "Colour works" and
# "Colour does nothing" are each satisfiable by a build that is broken the other
# way.
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
if ! cc -O1 -I src -o "$OUT/colour" tests/host/test_stacks_colour_scope.c -lpthread -lm 2>"$OUT/err"; then
    echo "FAIL: test_stacks_colour_scope.c did not build"; sed -n '1,12p' "$OUT/err"; exit 1
fi
if "$OUT/colour" > "$OUT/log" 2>&1; then
    echo "PASS: $(basename "$0")  (Colour reshapes Common/Uncommon, not Genre)"
else
    echo "FAIL: Colour is not scoped to the right libraries"; cat "$OUT/log"; exit 1
fi
