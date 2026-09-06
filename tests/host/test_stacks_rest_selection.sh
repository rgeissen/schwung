#!/usr/bin/env bash
#
# THE CURSOR MUST BE VISIBLE ON AN EMPTY SLOT.
#
# The selection bracket was drawn inside drawChordBlock, and the rest path
# reaches that with an early `continue` -- so a selected REST drew no bracket.
# That is the state the module BOOTS in and the state Clear returns to: one
# rest. At the one moment the cursor matters most, it was invisible.
#
# The .mjs half RENDERS the staff into a recording context and moves the
# cursor between two slots, because nothing else on the staff depends on the
# selection. An earlier version asserted "there is ink at the slot's left edge"
# and PASSED against the bug -- drawRest paints a solid column there anyway.
set -uo pipefail
cd "$(dirname "$0")/../.."
if node tests/host/test_stacks_rest_selection.mjs; then
    echo "PASS: $(basename "$0")  (the cursor shows on an empty slot)"
else
    echo "FAIL: the selection bracket is missing on a slot with no notes"; exit 1
fi
