#!/usr/bin/env bash
#
# A canvas param may CLAIM the jog click, and then Back is the only exit.
#
# MoveMainButton is CC 3 -- the jog click -- and shadow_ui steals it to close
# the fullscreen canvas BEFORE dispatchCanvasMidi runs, so an overlay can never
# see it. That is right for a viewer you look at and leave, and wrong for an
# editor meant to be locked into: the click is its primary gesture.
#
# The opt-in is why this is safe. #154 took Undo/Copy/Delete unconditionally
# whenever the shadow display was up and had to be reverted (#175) because it
# stole them from everyone; claims_ccs was the capability answer to that, and
# this is the same shape. A param declaring nothing must behave exactly as it
# did before, so the pins below are BOTH directions.
set -uo pipefail
cd "$(dirname "$0")/../.."
F=src/shadow/shadow_ui.js
fail=0
bad() { echo "FAIL: $1"; fail=1; }

[ -f "$F" ] || { echo "FAIL: missing $F"; exit 1; }

# 1. The steal is gated, and gated on the param's own declaration.
grep -q 'canvasClaimsClick' "$F" || bad "no canvasClaimsClick gate in shadow_ui.js"
grep -q 'claims_jog_click' "$F" || bad "the flag is not read from the canvas param meta"
grep -qE 'd1 === MoveMainButton && d2 > 0 && !canvasClaimsClick' "$F" \
    || bad "the MoveMainButton close is not gated on the claim"

# 2. BACK IS NEVER CLAIMABLE. A view that can swallow its own only exit is a
#    view the user cannot leave -- the shim drops claims when the display
#    closes, but nothing rescues someone stuck inside a running one.
back_line=$(grep -n 'd1 === MoveBack && d2 > 0' "$F" | head -1 | cut -d: -f1)
if [ -z "$back_line" ]; then
    bad "no MoveBack close in the canvas block"
elif sed -n "${back_line}p" "$F" | grep -q 'canvasClaimsClick'; then
    bad "Back is gated on the claim -- the canvas would have no exit"
fi

# 3. Co-run must NOT honour it: there the canvas is an overlay over a running
#    tool and the click is how you dismiss it.
grep -q 'canvasClaimsClick = !canvasInCorun' "$F" \
    || bad "the claim is honoured in co-run, where the click must stay the dismiss"

# 4. The declaring module and its overlay agree.
M=src/modules/midi_fx/stacks/module.json
if [ -f "$M" ]; then
    python3 - "$M" <<'PY' || fail=1
import json, sys
cp = {e['key']: e for e in json.load(open(sys.argv[1]))['capabilities']['chain_params']}
g = cp.get('grid', {})
if g.get('claims_jog_click') is not True:
    print("FAIL: stacks' grid param does not claim the jog click"); sys.exit(1)
if g.get('show_footer') is not False:
    print("FAIL: grid does not suppress the host footer it draws over"); sys.exit(1)
PY
    grep -q 'JOG_CLICK_CC' src/modules/midi_fx/stacks/canvas.js \
        || bad "canvas.js claims the click but never handles CC 3"
fi

if [ $fail -eq 0 ]; then echo "PASS: $(basename "$0")"; else echo "FAIL: $(basename "$0")"; fi
exit $fail
