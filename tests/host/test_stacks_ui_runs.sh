#!/bin/bash
#
# module.json's UI grouping runs must match the tables in dsp/stacks.c.
#
# The Remote UI narrows Chord Shape by Shape Family and Progression by Genre,
# which needs the run boundaries of SHAPES[] and PRESETS[]. They are GENERATED from the C table into module.json
# (tools/stacks/gen_ui_runs.py) rather than retyped into the panel,
# because a second copy of a table is what produced the phantom-note bug in
# this module. This test fails when a shape is added, moved between families,
# or reordered in stacks.c without regenerating -- which would otherwise show
# the WRONG shapes under a family, silently and plausibly.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
command -v python3 >/dev/null || { echo "SKIP: python3 not installed"; exit 0; }
if ! python3 "$ROOT/tools/stacks/gen_ui_runs.py" --check; then
  echo "FAIL: module.json UI runs are out of step with stacks.c"
  exit 1
fi
echo "PASS: module.json UI runs match SHAPES[] and PRESETS[] in stacks.c"
