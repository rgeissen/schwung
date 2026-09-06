#!/usr/bin/env python3
"""EVERY TRIGGER ON A BANK MUST FIRE FROM THE ENCODER.

Clear, Read Clip, Stamp Clip and both Randomizers were all dead to the knob.
The relative "~N" path walks enums by NAME, and it simply had no branch for
write-access params -- so a turn fell through and nothing happened. The click
cannot stand in for it either: in the grid the click plays a chord.

The page documented the intended behaviour ("triggers fire on a turn") the
whole time it was broken, which is why only one of the five was ever noticed.

This checks an agreement between THREE places, because a trigger that is in
two of them and not the third is exactly the silent failure above:

  module.json  access: "write"     -- the contract
  stacks.c     is_trigger_key()    -- fires it
  canvas.js    TRIGGERS            -- latches it to one fire per gesture
"""
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
mj = json.loads((ROOT / "src/modules/midi_fx/stacks/module.json").read_text())
c = (ROOT / "src/modules/midi_fx/stacks/dsp/stacks.c").read_text()
js = (ROOT / "src/modules/midi_fx/stacks/canvas.js").read_text()

want = {e["key"] for e in mj["capabilities"]["chain_params"]
        if e.get("access") == "write"}

m = re.search(r"is_trigger_key\(const char \*k\)\s*\{.*?\};", c, re.S)
if not m:
    sys.exit("FAIL: is_trigger_key() not found in stacks.c")
have_c = set(re.findall(r'"(\w+)"', m.group(0)))

m = re.search(r"const TRIGGERS = \{(.*?)\};", js, re.S)
if not m:
    sys.exit("FAIL: TRIGGERS not found in canvas.js")
have_js = set(re.findall(r"(\w+)\s*:\s*1", m.group(1)))

bad = []
for name, have in (("is_trigger_key()", have_c), ("canvas TRIGGERS", have_js)):
    if want - have:
        bad.append(f"  {name} is missing {sorted(want - have)}"
                   f"  -- turning those knobs would do nothing")
    if have - want:
        bad.append(f"  {name} lists non-triggers {sorted(have - want)}")

if bad:
    print("FAIL: the trigger lists disagree")
    print("\n".join(bad))
    sys.exit(1)
print(f"  {len(want)} triggers fire from the encoder; contract, DSP and canvas agree")
