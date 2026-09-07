#!/usr/bin/env python3
"""Write the UI grouping runs into module.json, read from stacks.c.

Two pickers on the panel narrow a long list by a shorter one beside it:
Shape Family narrows Chord Shape (38 shapes), and Genre narrows Progression
(64 presets). Both groupings already exist in C as CONTIGUOUS runs -- SHAPES[]
carries a family per shape, PRESETS[] is ordered by genre "for exactly this" --
and neither boundary is retyped into the panel.

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

Usage:  tools/stacks/gen_ui_runs.py [--check]
        --check exits non-zero on drift instead of writing.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CSRC = ROOT / "src/modules/midi_fx/stacks/dsp/stacks.c"
MJSON = ROOT / "src/modules/midi_fx/stacks/module.json"


def _runs(fams, what):
    """Contiguous (first, count) runs, in table order."""
    order = []
    for f in fams:
        if not order or order[-1] != f:
            order.append(f)
    # Contiguity is a contract, not an accident: a group appearing in two
    # separate runs cannot be expressed as (first, count) and would silently
    # lose its second run. Fail loudly rather than emit a wrong grouping.
    if len(order) != len(set(order)):
        sys.exit("%s groups are not contiguous: %s" % (what, order))
    out = []
    for f in order:
        idx = [i for i, x in enumerate(fams) if x == f]
        out.append({"group": f, "first": idx[0], "count": len(idx)})
    return out


def genres_from_c():
    src = CSRC.read_text()
    start = src.index("PRESETS[] = {")
    blk = src[start:]
    blk = blk[: blk.index("\n};")]
    rows = re.findall(r'\{\s*"([^"]+)"\s*,\s*(GEN_\w+)', blk)
    if not rows:
        sys.exit("no PRESETS rows parsed from stacks.c")
    return _runs([r[1] for r in rows], "PRESETS genre"), [r[0] for r in rows]


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

    return _runs(fams, "SHAPES family"), names


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

    # --- Genre -> Progression, the same shape ----------------------------
    gruns, pnames = genres_from_c()
    gen_param = next(
        (p for p in caps["chain_params"] if p.get("key") == "genre"), None
    )
    prog_param = next(
        (p for p in caps["chain_params"] if p.get("key") == "progression"), None
    )
    if gen_param is None or prog_param is None:
        sys.exit("no `genre` / `progression` param in chain_params")
    glabels = gen_param["options"]
    if len(glabels) != len(gruns):
        sys.exit("genre param has %d options but PRESETS has %d runs"
                 % (len(glabels), len(gruns)))
    if prog_param["options"] != pnames:
        sys.exit("progression options in module.json differ from PRESETS[]")
    gbuilt = [
        {"name": glabels[i], "first": r["first"], "count": r["count"]}
        for i, r in enumerate(gruns)
    ]

    if "--check" in sys.argv:
        stale = 0
        for key, want, what in (("shape_families", built, "shapes"),
                                ("genre_progressions", gbuilt, "presets")):
            if caps.get(key) != want:
                stale += 1
                print("%s in module.json is stale." % key)
                print("  module.json: %s" % json.dumps(caps.get(key)))
                print("  stacks.c   : %s" % json.dumps(want))
        if stale:
            print("Run: tools/stacks/gen_ui_runs.py")
            return 1
        print("up to date: %d families over %d shapes, %d genres over %d presets"
              % (len(built), len(names), len(gbuilt), len(pnames)))
        return 0

    caps["shape_families"] = built
    caps["genre_progressions"] = gbuilt
    MJSON.write_text(json.dumps(mod, indent=2) + "\n")
    print("wrote %d families over %d shapes, %d genres over %d presets"
          % (len(built), len(names), len(gbuilt), len(pnames)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
