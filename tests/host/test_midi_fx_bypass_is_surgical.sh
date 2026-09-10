#!/bin/bash
#
# Bypassing ONE MIDI FX must silence that module and nothing else.
#
# Two things it must not do, both of which would be invisible until heard:
#
#   1. It must not take the SYNTH with it. Bypass here means PASSTHROUGH --
#      the stage is skipped and the messages carry on to the next stage and
#      to the sound module. If a bypassed stage dropped its messages instead,
#      bypassing a chord generator would silence the whole track, and the
#      user would reasonably conclude the bypass had deactivated the synth.
#
#   2. It must not take the OTHER MIDI FX with it. `midi_fx_bypassed` is
#      indexed per stage and the key carries the index, so `midi_fx2:bypassed`
#      touches stage 2 alone. This is the exact hole that existed once: only
#      "midi_fx1:bypassed" was enumerated, and midi_fx2's fell through to the
#      generic route and was handed to the PLUGIN as one of its own params --
#      so a second MIDI FX could not be bypassed at all, silently.
#
# The panel's half matters too: it writes its OWN component's key, so a module
# sitting in midi_fx2 bypasses midi_fx2 rather than whatever is in slot 1.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHAIN="$ROOT/src/modules/chain/dsp/chain_midi_chain.h"
HOST="$ROOT/src/modules/chain/dsp/chain_host.c"
# The panel-side half of this (a module's own bypass control writing
# <component>:bypassed rather than a slot key) is pinned in the module
# repo that ships one; what is pinned here is the HOST behaviour.
PANEL=""
fail=0

# 1. An inactive stage is SKIPPED, not a reason to drop or stop.
if ! grep -q 'if (!active(ctx, fx)) continue;' "$CHAIN"; then
  echo "FAIL: a bypassed MIDI FX stage is no longer skipped with 'continue'."
  echo "      Anything that drops or breaks here silences the synth downstream."
  fail=1
fi
# `break` on an inactive stage would end the chain and lose the notes.
if grep -q 'if (!active(ctx, fx)) break;' "$CHAIN"; then
  echo "FAIL: an inactive stage BREAKS the walk -- downstream stages and the"
  echo "      synth stop receiving, so bypass would silence the track"
  fail=1
fi

# 2. The flag is written and read PER INDEX, from the key.
for verb in "inst->midi_fx_bypassed\[bidx\] =" "inst->midi_fx_bypassed\[bidx\] ?"; do
  if ! grep -q "$verb" "$HOST"; then
    echo "FAIL: midi_fx bypass is not indexed by the key ($verb missing)"
    fail=1
  fi
done
if grep -qE 'midi_fx_bypassed\[(0|1)\] *=' "$HOST"; then
  echo "FAIL: a hard-coded MIDI FX index is being bypassed; the index must come"
  echo "      from the key, or one module's bypass hits another's"
  fail=1
fi

# 3. The panel bypasses ITSELF, wherever it is loaded.
# (The panel-side assertions moved to the module repo that ships a panel:
#  a component-relative `set("bypassed", ...)` rather than a hard-coded
#  "midi_fx1:bypassed". Nothing in THIS repo ships a web_ui.html to check.)

[ "$fail" -eq 0 ] || exit 1
echo "PASS: bypass skips one stage only -- synth keeps receiving, other MIDI FX untouched"
