#!/usr/bin/env python3
"""A SHIFT-HELD PRESS NEVER REACHES A CLAIMED CC.

Shift+<button> is the HOST's vocabulary -- Shift+Copy snapshots all four slots
and Master FX, Shift+Delete puts it back -- so the shim withholds a shift-held
press from a claimed CC entirely:

    "Shift+<button> is the host's own vocabulary ... A press with Shift held is
     never claimed: the module gets the BARE buttons only."   schwung_shim.c

Stacks claims Copy (60), Delete (119) and Undo (56) via claims_edit_ccs. So a
`shiftHeld()` branch inside one of those handlers is UNREACHABLE CODE THAT
READS AS A WORKING FEATURE -- which is exactly what shipped: Shift+Copy for
Double Length and Shift+Undo for Redo were both documented and both dead, while
Mute+Copy and Mute+Undo worked by accident because `S.shift` tracks Mute.

The JOG is not affected: its claim is a different mechanism and does deliver
shift-held clicks, so Shift+Jog and Shift+Click stay as they are.

This asserts that no edit-CC handler consults shiftHeld().
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
js = (ROOT / "src/modules/midi_fx/stacks/canvas.js").read_text()

# The CC constants the module claims via claims_edit_ccs.
EDIT = {"COPY_CC": 60, "DELETE_CC": 119, "UNDO_CC": 56}

bad = []
for name in EDIT:
    # Each handler runs from `if (d1 === NAME` to the closing `return;`
    m = re.search(r"if \(d1 === " + name + r"\b.*?\n\s*return;", js, re.S)
    if not m:
        continue                      # no handler for this CC is fine
    body = m.group(0)
    if "shiftHeld()" in body:
        bad.append(f"  {name} (CC {EDIT[name]}) consults shiftHeld() -- "
                   f"the shim never delivers that press, so the branch is dead")

if bad:
    print("FAIL: an edit-CC gesture depends on Shift")
    print("\n".join(bad))
    print("  Use Mute (S.shift), which IS forwarded to the module.")
    sys.exit(1)
print("  no edit-CC gesture depends on Shift (the shim withholds those presses)")
