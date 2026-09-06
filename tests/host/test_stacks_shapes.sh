#!/usr/bin/env bash
#
# Stacks: the chord-shape table is declared TWICE and must not drift.
#
# SHAPES[] in stacks.c is what the module plays and names; the `shape` enum in
# module.json is what the knob shows. A knob option with no matching row writes
# a shape the module does not have -- and an enum written by NAME simply does
# not match, so the write is dropped and the knob appears to do nothing on one
# specific value. Nothing logs that.
#
# It also pins the FAMILY ORDERING, which is load-bearing rather than tidy:
# `family` moves `shape` to the first row of a family and `shape` then steps
# within it, so a row filed out of order splits its family into two runs and
# the jump silently lands in the wrong one.
set -uo pipefail
cd "$(dirname "$0")/../.."

C=src/modules/midi_fx/stacks/dsp/stacks.c
J=src/modules/midi_fx/stacks/module.json
fail=0
note() { echo "  $1"; }
bad()  { echo "FAIL: $1"; fail=1; }

[ -f "$C" ] || { echo "FAIL: missing $C"; exit 1; }
[ -f "$J" ] || { echo "FAIL: missing $J"; exit 1; }

python3 - "$C" "$J" <<'PY'
import json, re, sys
c = open(sys.argv[1]).read()
j = json.load(open(sys.argv[2]))
bad = []

tbl = c[c.index('static const stk_shape_t SHAPES[] = {'):c.index('#define SHAPE_REST')]
rows = re.findall(r'\{\s*"([^"]+)",\s*"([^"]*)",\s*(FAM_\w+)\s*,\s*(\d+)\s*,\s*\{([^}]*)\}', tbl)
if not rows:
    bad.append("could not parse SHAPES[] out of stacks.c")

opts = [r[0] for r in rows]
fams = [r[2] for r in rows]

# 1. families contiguous and in the declared order
order = ['FAM_5TH', 'FAM_TRIAD', 'FAM_6TH', 'FAM_7TH', 'FAM_9TH', 'FAM_EXT']
runs = [f for i, f in enumerate(fams) if i == 0 or fams[i-1] != f]
if runs != order:
    bad.append(f"SHAPES[] families are not contiguous/in order: {runs}")

# 2. every row's interval count matches its declared n, and fits STK_MAX_TONES
maxt = int(re.search(r'#define STK_MAX_TONES\s+(\d+)', c).group(1))
for name, _suf, _f, n, ivs in rows:
    got = len([x for x in ivs.split(',') if x.strip()])
    # A REST has n=0 and therefore no intervals, but C forbids an empty brace
    # initialiser -- it carries a single placeholder that `n` tells every
    # consumer to ignore. Counting braces instead of reading n would make the
    # only silent chord in the table look malformed.
    if int(n) == 0:
        if got != 1:
            bad.append(f"shape {name}: n=0 must carry exactly one placeholder, has {got}")
    elif got != int(n):
        bad.append(f"shape {name}: declares n={n} but lists {got} intervals")
    if int(n) > maxt:
        bad.append(f"shape {name}: n={n} exceeds STK_MAX_TONES={maxt}")

# 3. no two shapes share an interval set -- a duplicate is unreachable by name
seen = {}
for name, _s, _f, _n, ivs in rows:
    if int(_n) == 0:
        continue          # the rest has no interval set to collide with
    k = tuple(sorted(int(x) for x in ivs.split(',') if x.strip()))
    if k in seen:
        bad.append(f"shape {name} duplicates {seen[k]} ({list(k)})")
    seen[k] = name

cp = {e['key']: e for e in j['capabilities']['chain_params']}

# 4. the knob's options ARE the table, in the table's order
if cp['shape']['options'] != opts:
    bad.append("module.json shape options != SHAPES[] (order or content)")
if cp['shape']['options'][cp['shape']['default']] != 'maj':
    bad.append("shape default is not maj")

# 5. the family knob's options are the C family names
fam_names = [x.strip().strip('"') for x in
             re.search(r'FAMILIES\[\] = \{([^}]*)\}', c).group(1).split(',') if x.strip()]
if cp['family']['options'] != fam_names:
    bad.append(f"module.json family options {cp['family']['options']} != C {fam_names}")

# 6. SHAPE_SINGLE really is the single-note fallback the import uses
if opts[int(re.search(r'#define SHAPE_SINGLE\s+(\d+)', c).group(1))] != 'note':
    bad.append("SHAPE_SINGLE does not point at the \"note\" row")
if opts[int(re.search(r'#define SHAPE_REST\s+(\d+)', c).group(1))] != 'rest':
    bad.append("SHAPE_REST does not point at the \"rest\" row")

# 7. root's knobs are all real params, and the CANVAS bank still fits.
#
# The cap here used to be a flat 8 and that conflated two surfaces. `grid` and
# `sel` are canvas plumbing -- the page itself and the jog -- and the bank
# generator filters both out, so MAIN shows six cells of eight and LOOKS like
# it has two spare. It does, on the canvas. On the knob-grid page they are two
# of the eight, so a ninth key splits Main across two pages.
#
# What must never break is the CANVAS bank, which is the primary surface and
# is hard-limited to eight cells. So that is what is pinned, and pagination of
# the knob page is allowed rather than silently prevented by a number nobody
# could trace back to a reason.
knobs = j['ui_hierarchy']['levels']['root']['knobs']
canvas_cells = [k for k in knobs if k not in ('grid', 'sel')]
if len(canvas_cells) > 8:
    bad.append(f"root fills {len(canvas_cells)} canvas cells; a bank holds 8")
for k in knobs:
    if k not in cp:
        bad.append(f"knob {k} is on no chain_params entry")

# 8. the custom widget's kind and extra_keys, which are what get `prog` read at
#    all: an unregistered kind falls through to a built-in dial and the staff
#    never sees a chord.
# 8b. Humanise is SEEDED, and its two axes are independent -- a shared seed
#     would make Randomize Time disturb a velocity pattern already settled on.
for k in ('hum_vel', 'hum_time', 'roll_vel', 'roll_time'):
    if k not in cp:
        bad.append(f"missing humanise param {k}")
for k in ('roll_vel', 'roll_time'):
    if cp.get(k, {}).get('access') != 'write':
        bad.append(f"{k} is not access:write, so a click would latch it on")
if 'seed_vel' not in c or 'seed_time' not in c:
    bad.append("humanise does not carry two independent seeds")
# Strip comments first: this file EXPLAINS why it is not rand(), and a
# substring search over prose fails on the explanation of its own rule.
code = re.sub(r'/\*.*?\*/', '', c, flags=re.S)
code = re.sub(r'//[^\n]*', '', code)
if re.search(r'\b(rand|random|srand|drand48)\s*\(', code):
    bad.append("humanise calls rand() -- it must be a hash, so Stamp writes what was previewed")

viz = cp['sel'].get('viz', {})
if viz.get('kind') != 'custom:stkstaff':
    bad.append("sel declares no custom:stkstaff viz kind")
if viz.get('extra_keys') != ['prog']:
    bad.append("sel's viz does not carry extra_keys ['prog']")
canvas = open('src/modules/midi_fx/stacks/canvas.js').read()
if 'custom:stkstaff' not in canvas:
    bad.append("canvas.js registers no custom:stkstaff widget")
if 'draw(ctx)' not in canvas and 'draw(' not in canvas:
    bad.append("canvas.js exposes no fullscreen draw")
if 'onMidi' not in canvas:
    bad.append("canvas.js exposes no onMidi -- the takeover would have no jog")
# The peek is why there is no as_page page: an as_page is a knob page, so the
# jog pages away from it and an enum turn covers it with the host's peek panel.
if 'as_page' in json.dumps(cp):
    bad.append("an as_page param is back -- the jog cannot select chords there")

# 9. the takeover is a DIVE-IN canvas param, and it is the first cell on Main
grid = cp.get('grid', {})
if grid.get('type') != 'canvas' or grid.get('as_page') is not None:
    bad.append("grid is not a plain type:canvas dive-in param")
if knobs and knobs[0] != 'grid':
    bad.append(f"grid is not the first cell on Main (got {knobs[0]}) -- the takeover should be one click away")
if not j['capabilities'].get('claims_edit_ccs'):
    bad.append("claims_edit_ccs missing -- Delete would reach Move and delete a CLIP")

for b in bad:
    print("FAIL: " + b)
print(f"  {len(rows)} chord shapes, {len(runs)} families, {len(knobs)} knobs")
sys.exit(1 if bad else 0)
PY
rc=$?
[ $rc -eq 0 ] || fail=1

# 9b. chain_params must be SERVED FROM get_param, not merely declared in
#     module.json. The shadow UI queries the component for it
#     (shadow_ui.js: "Chain params are typically in module.json, but we query
#     via get_param"), so declaring it only in module.json yields the knobs
#     from ui_hierarchy and silently drops the `as_page` canvas param and every
#     `viz` -- a knob page where the picture should be, with nothing logged.
if ! grep -q 'strcmp(key, "chain_params")' "$C"; then
    bad "stacks.c does not serve chain_params from get_param"
fi
if ! python3 tools/stacks/gen_chain_params.py --check; then
    bad "CHAIN_PARAMS_JSON is stale -- run: python3 tools/stacks/gen_chain_params.py"
fi
note "chain_params served from get_param and in sync with module.json"

# 9c. A MODULE MUST NEVER PUT A COLON IN A setParam KEY.
#     The canvas runtime builds the full param key with
#       if (key.includes(":")) return key;
#     so a key that already contains one is assumed fully qualified and is sent
#     WITHOUT the component prefix -- it addresses nobody, silently, because a
#     write to an unknown key is not an error anywhere in the chain. That is
#     how every enum in the takeover came to be dead while looking correct.
#     Relative steps go in the VALUE ("~N") for exactly this reason.
CANVAS=src/modules/midi_fx/stacks/canvas.js
if grep -q 'setParam(key + ":' "$CANVAS"; then
    bad "canvas.js builds a setParam key containing ':' -- it loses the component prefix"
fi
grep -q 'setParam(key, "~"' "$CANVAS" || bad "canvas.js does not send relative enum steps as ~N"
grep -q "val\[0\] == '~'" "$C" || bad "stacks.c does not accept a ~N relative write"
note "relative enum writes travel in the value, not the key"

# 9d. SHIFT IS READ, NOT LISTENED FOR. CC 49 is not in the shim's forward list
#     (14, 3, 51, 40-43, 71-78, 88, plus claimed), so a `d1 === 49` branch in an
#     overlay is unreachable code that looks implemented -- which is precisely
#     how Shift+Jog came to silently do nothing twice.
# Comments stripped first: this file EXPLAINS why CC 49 is not listened for,
# and a substring search over prose fails on the explanation of its own rule --
# the same way the rand() check did.
if python3 -c "
import re,sys
src=open('$CANVAS').read()
code=re.sub(r'/\*.*?\*/','',src,flags=re.S)
code=re.sub(r'//[^\n]*','',code)
sys.exit(0 if re.search(r'd1 === (SHIFT_CC|49)\b', code) else 1)
"; then
    bad "canvas.js waits for CC 49, which the shim never forwards"
fi
grep -q 'shadow_get_shift_held' "$CANVAS" \
    || bad "canvas.js does not read Shift from the shim binding"
note "Shift comes from shadow_get_shift_held(), not from a CC"

# 9f. AN UNBOUND KNOB MUST BE DARK. Colour 0 is reserved for "nothing is bound
#     here" (param_pages/knob_leds.mjs), and the takeover has to drive the rings
#     itself: diving in calls exitParamPages, which hands them BACK to Move
#     rather than clearing them, so an overlay that writes nothing inherits
#     Move's track colours -- lit, sometimes red, over knobs that do nothing.
grep -q 'key ? ledColor' "$CANVAS" \
    || bad "canvas.js does not force colour 0 for an unbound knob slot"
grep -q 'shadow_restore_knob_leds' "$CANVAS" \
    || bad "canvas.js does not give the rings back on close"
grep -q 'PARAM_RANGES' "$CANVAS" \
    || bad "canvas.js has no generated ranges, so LED intensity cannot be right"
note "knob rings: unbound is dark, ranges generated, rings restored on exit"

# 9e. THE BANKS ARE THE LEVELS. Two surfaces onto one module only pay for
#     themselves while what you learn on either transfers; two layouts for the
#     same parameters is two things to learn. Compared here rather than asked
#     for in a comment, because a comment is what let them drift the first time.
python3 - <<'PYEOF' || fail=1
import json, re, sys
mj = json.load(open('src/modules/midi_fx/stacks/module.json'))
lv = mj['ui_hierarchy']['levels']
src = open('src/modules/midi_fx/stacks/canvas.js').read()
blk = src[src.index('const BANKS = ['):src.index('];', src.index('const BANKS = ['))]
banks = {}
for m in re.finditer(r'\{\s*name:\s*"(\w+)",\s*keys:\s*\[(.*?)\]\s*\}', blk, re.S):
    keys = re.findall(r'\["([a-z_]+)","[^"]*","[^"]*"\]|\[null,"",""\]', m.group(2))
    banks[m.group(1)] = [k for k in keys if k]
pairs = [("MAIN","root"),("START","start"),("CHORD","chord"),("VOICE","voice"),("FEEL","feel"),("CLIP","clip")]
bad = []
if list(banks) != [b for b,_ in pairs]:
    bad.append(f"bank order {list(banks)} != {[b for b,_ in pairs]}")
for bank, level in pairs:
    want = [k for k in lv[level]['knobs'] if k not in ("grid", "sel")]
    got = banks.get(bank, [])
    if got != want:
        bad.append(f"{bank} bank {got} != {level} level {want}")
for b in bad: print("FAIL: " + b)
sys.exit(1 if bad else 0)
PYEOF
note "the five banks mirror the five levels, key for key"

# 10. No file I/O on the realtime path. Reading Song.abl from set_param is the
#     granny bug: it stalls the param channel from the SPI callback.
for fn in stk_set_param stk_get_param stk_process_midi stk_tick; do
    body=$(awk "/^static .*${fn}\\(/,/^}/" "$C")
    if echo "$body" | grep -qE '\b(fopen|fread|fwrite|opendir|malloc|calloc|free|pthread_create)\b'; then
        bad "$fn does file I/O, allocates or spawns a thread -- it IS the SPI callback"
    fi
done
note "no file I/O or allocation in the four realtime entry points"

# 11. The worker must not inherit the callback's FIFO 70.
if ! grep -q 'PTHREAD_EXPLICIT_SCHED' "$C" || ! grep -q 'SCHED_OTHER' "$C"; then
    bad "worker thread does not explicitly request SCHED_OTHER"
fi
note "worker thread is explicitly SCHED_OTHER"

if [ $fail -eq 0 ]; then # ---------------------------------------------------------------------------
# EVERY note path resolves through chord_notes_g WITH the grouping.
#
# Voice Grouping is applied inside chord_notes_g, which is what makes STAMP
# respect it: the stamp builder, the sequencer and the staff all resolve notes
# through that one function, so a clip cannot be written that you never heard.
# The failure this guards is a FOURTH call site added later that forgets the
# argument -- it would compile, play correctly, and silently stamp the ungrouped
# chords. Assert the call shape rather than trusting the convention.
SRC=src/modules/midi_fx/stacks/dsp/stacks.c
CALLS=$(grep -c 'chord_notes_g(' "$SRC")
# 1 prototype + 1 definition + 3 call sites
if [ "$CALLS" -ne 5 ]; then
    echo "FAIL: expected 5 mentions of chord_notes_g (proto, def, 3 call sites), found $CALLS"
    grep -n 'chord_notes_g(' "$SRC"
    exit 1
fi
if grep -n 'chord_notes_g(' "$SRC" | grep -v 'static int chord_notes_g' \
       | grep -qv 'st->grouping'; then
    # the call spans lines, so check the argument appears within each call
    for ln in $(grep -n 'chord_notes_g(' "$SRC" | grep -v 'static int' | cut -d: -f1); do
        if ! sed -n "${ln},$((ln+4))p" "$SRC" | grep -q 'st->grouping'; then
            echo "FAIL: chord_notes_g at line $ln does not pass st->grouping"
            echo "      a note path that skips grouping stamps what you never heard"
            sed -n "${ln},$((ln+4))p" "$SRC"
            exit 1
        fi
    done
fi
echo "  every note path (stamp, sequencer, staff) carries the voice grouping"
python3 tools/stacks/check_triggers.py || exit 1
python3 tools/stacks/check_edit_cc_modifier.py || exit 1
python3 tools/stacks/check_gestures.py || exit 1
echo "PASS: $(basename "$0")"; else echo "FAIL: $(basename "$0")"; fi
exit $fail
