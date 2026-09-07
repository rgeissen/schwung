#!/usr/bin/env python3
"""Write the shape->family runs into module.json, read from stacks.c.

WHY THIS EXISTS.  Shape Family and Chord Shape are two views of ONE table:
SHAPES[] in dsp/stacks.c carries a family per shape, and the families are
contiguous runs (test_stacks_shapes.sh pins that).  The Remote UI wants to
show only the shapes belonging to the selected family -- 38 buttons is a
scrolling list, 4-11 is a row or two -- and to do that it needs the run
boundaries.

The boundaries are NOT retyped into the panel.  A second copy of a table is
exactly what produced the phantom-note bug in this module (two hand-written
parsers for one wire format that disagreed on an edge case), so the runs are
GENERATED here into module.json, which the panel already fetches as a module
asset.  One source, the C table; one generator; one consumer.

Deliberately written OUTSIDE capabilities.chain_params, so gen_chain_params.py
and the C header it produces are untouched and no DSP rebuild is needed to
change how the panel groups a picker.

Usage:  tools/stacks/gen_shape_families.py [--check]
        --check exits non-zero on drift instead of writing.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CSRC = ROOT / "src/modules/midi_fx/stacks/dsp/stacks.c"
MJSON = ROOT / "src/modules/midi_fx/stacks/module.json"


def families_from_c():
    src = CSRC.read_text()
    start = src.index("static const stk_shape_t SHAPES[] = {")
    blk = src[start:]
    blk = blk[: blk.index("\n};")]
    rows = re.findall(r'\{\s*"([^"]+)"\s*,\s*"([^"]*)"\s*,\s*(FAM_\w+)\s*,', blk)
    if not rows:
        sys.exit("no SHAPES rows parsed from stacks.c")

    fams = [r[2] for r in rows]
    names = [r[0] for r in rows]

    # Contiguity is a contract, not an accident: a family that appears in two
    # separate runs cannot be expressed as (first, count) and would silently
    # lose its second run.  Fail loudly rather than emit a wrong grouping.
    order = []
    for f in fams:
        if not order or order[-1] != f:
            order.append(f)
    if len(order) != len(set(order)):
        sys.exit("SHAPES families are not contiguous: %s" % order)

    runs = []
    for f in order:
        idx = [i for i, x in enumerate(fams) if x == f]
        runs.append({"family": f, "first": idx[0], "count": len(idx)})
    return runs, names


def main():
    runs, names = families_from_c()
    mod = json.loads(MJSON.read_text())
    caps = mod["capabilities"]

    # The user-facing family names come from the `family` param, so the two
    # pickers cannot disagree about what a family is called.
    fam_param = next(
        (p for p in caps["chain_params"] if p.get("key") == "family"), None
    )
    if fam_param is None:
        sys.exit("no `family` param in chain_params")
    labels = fam_param["options"]
    if len(labels) != len(runs):
        sys.exit(
            "family param has %d options but SHAPES has %d runs"
            % (len(labels), len(runs))
        )

    shape_param = next(
        (p for p in caps["chain_params"] if p.get("key") == "shape"), None
    )
    if shape_param is None:
        sys.exit("no `shape` param in chain_params")
    if shape_param["options"] != names:
        sys.exit("shape options in module.json differ from SHAPES[] in stacks.c")

    built = [
        {"name": labels[i], "first": r["first"], "count": r["count"]}
        for i, r in enumerate(runs)
    ]

    if "--check" in sys.argv:
        if caps.get("shape_families") != built:
            print("shape_families in module.json is stale.")
            print("  module.json: %s" % json.dumps(caps.get("shape_families")))
            print("  stacks.c   : %s" % json.dumps(built))
            print("Run: tools/stacks/gen_shape_families.py")
            return 1
        print("shape_families up to date (%d families, %d shapes)"
              % (len(built), len(names)))
        return 0

    caps["shape_families"] = built
    MJSON.write_text(json.dumps(mod, indent=2) + "\n")
    print("wrote %d families covering %d shapes" % (len(built), len(names)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
