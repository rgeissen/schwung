#!/usr/bin/env bash
#
# A KNOB ASKS THE CONTRACT, IT DOES NOT PARSE THE VALUE.
#
# The overlay decided "number or enum" by running parseInt over whatever the
# module reported -- and six chord shapes are NAMED with digits (5, 6, 69, 9,
# 11, 13). On the 6/9 chord a detent wrote "70", which is not a shape, so the
# module refused it and the knob went dead: "the shape shows 69 and then it
# hangs". On the power chord "5" a detent wrote "6", which IS a shape eight
# positions away, so the walk teleported silently.
#
# A value can be ambiguous; the declaration cannot.
set -uo pipefail
cd "$(dirname "$0")/../.."
if node tests/host/test_stacks_knob_type.mjs; then
    echo "PASS: $(basename "$0")  (knobs classify from the contract)"
else
    echo "FAIL: a knob misreads its own parameter type"; exit 1
fi
