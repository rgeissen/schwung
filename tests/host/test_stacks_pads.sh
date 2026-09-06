#!/usr/bin/env bash
#
# THE BOTTOM PAD ROW IS THE PROGRESSION.
#
# A pad selects and plays its chord; Left/Right page the row, because a
# progression runs to sixteen chords and a row is eight. `host_pad_block` is a
# GLOBAL switch -- while it is set no other module sees the pads -- so it must
# be taken in onOpen and released in onClose, with the pads handed back DARK.
set -uo pipefail
cd "$(dirname "$0")/../.."
if node tests/host/test_stacks_pads.mjs; then
    echo "PASS: $(basename "$0")  (the pad row is the progression)"
else
    echo "FAIL: the pad row does not behave"; exit 1
fi
