#!/usr/bin/env python3
"""EVERY GESTURE THE OVERLAY HANDLES MUST BE ON THE PAGE.

Two failures this prevents, and the second is the worse one:

  * a gesture that exists and is undocumented -- nobody finds it. Turning CLR
    was dead for weeks partly because the page said triggers fire on a turn and
    nobody checked which ones.
  * a gesture that is documented and does NOT exist. Shift+Copy was on the page
    as "double the length" while the shim ate the press: the documentation was
    the only evidence the feature worked, and it was wrong.

So the doc table and the canvas handlers are compared. The mapping is explicit
rather than inferred, because a handler's CC does not name its gesture -- one
CC carries three of them on Copy.
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
js = (ROOT / "src/modules/midi_fx/stacks/canvas.js").read_text()
gen = (ROOT / "tools/stacks/gen_matrix.py").read_text()

# Which CC constants the canvas handles, and the doc rows each must produce.
EXPECT = {
    "JOG_TURN_CC":  ["Jog", "Shift + Jog", "Mute + Jog"],
    "JOG_CLICK_CC": ["Jog click (hold)", "Shift + Jog click", "Mute + Jog click"],
    # Mute+click MUTES; it is not a second Shift. The three rows above are one
    # CC carrying three gestures, which is why this mapping is written out
    # rather than inferred from the handler.
    "COPY_CC":      ["Copy", "Copy (hold)", "Mute + Copy"],
    "UNDO_CC":      ["Undo", "Mute + Undo"],
    "DELETE_CC":    ["Delete"],

}

block = re.search(r"GESTURES = \[(.*?)\n\]", gen, re.S)
if not block:
    sys.exit("FAIL: GESTURES table not found in gen_matrix.py")
documented = set(re.findall(r'^\s*\("([^"]+)"', block.group(1), re.M))

bad = []
for cc, rows in EXPECT.items():
    handled = f"d1 === {cc}" in js
    for row in rows:
        if handled and row not in documented:
            bad.append(f"  {cc} is handled but '{row}' is not on the page")
        if not handled and row in documented:
            bad.append(f"  '{row}' is on the page but {cc} is not handled")

# The pad row and the arrows are not `d1 === X_CC` handlers, so they are
# checked by the constants they use. A gesture with no row is one nobody finds.
if "PAD_ROW1" in js and "Pad, bottom row" not in documented:
    bad.append("  the pad row is handled but has no row on the page")
if "ARROW_LEFT" in js and "Left / Right" not in documented:
    bad.append("  the arrows are handled but have no row on the page")

# A handler nobody listed at all.
for cc in re.findall(r"d1 === ([A-Z_]+_CC)", js):
    if cc not in EXPECT and cc != "MUTE_CC":
        bad.append(f"  {cc} is handled but this check does not know it")

if bad:
    print("FAIL: the gesture table and the overlay disagree")
    print("\n".join(sorted(set(bad))))
    sys.exit(1)
print(f"  {len(documented)} gestures documented; every CC handler is covered")
