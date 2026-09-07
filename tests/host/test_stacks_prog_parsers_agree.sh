#!/bin/bash
#
# The `prog` wire format is parsed TWICE -- once by the Move's staff
# (canvas.js) and once by the browser panel (web_ui.html) -- and the two
# copies must agree on every string.
#
# WHY THIS TEST EXISTS.  They did not agree, and the disagreement shipped.
# A rest is published with an EMPTY note field ("REST,A3,0,8,0,100,0,1,").
# canvas.js parsed it with parseInt, which gives NaN, and rejected it with a
# Number.isFinite guard -> no notes -> rest. web_ui.html used Number, and
# Number("") is 0, not NaN -- so the 0..127 range test ACCEPTED it and every
# rest arrived carrying a phantom note at MIDI pitch 0. The Move drew rests
# correctly while the browser drew ghost notes at the bottom of the staff,
# from the same bytes.
#
# The module cannot share one parser at runtime: `canvas_script` is a single
# standalone script evaluated in QuickJS, and the panel is an HTML page in a
# browser. So the copies stay, and this test makes them answer for each other
# -- by RUNNING both over a corpus, not by comparing their source text, since
# the two are written in different styles and a textual check would fail on
# formatting while passing on the bug above.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MOD="$ROOT/src/modules/midi_fx/stacks"
command -v node >/dev/null || { echo "SKIP: node not installed"; exit 0; }

node - "$MOD/canvas.js" "$MOD/web_ui.html" <<'NODE'
const fs = require("fs");
const [canvasPath, htmlPath] = process.argv.slice(2);

/* Pull `function parseProg(...) { ... }` out of a source by brace matching. */
function extract(src, what) {
  const at = src.indexOf("function " + what + "(");
  if (at < 0) throw new Error("no function " + what + " found");
  let i = src.indexOf("{", at), depth = 0, end = -1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) { end = j + 1; break; }
  }
  if (end < 0) throw new Error("unbalanced braces in " + what);
  return src.slice(at, end);
}

const canvasSrc = fs.readFileSync(canvasPath, "utf8");
const htmlSrc = fs.readFileSync(htmlPath, "utf8");
const deviceParse = new Function("return (" + extract(canvasSrc, "parseProg") + ")")();
const panelParse = new Function("return (" + extract(htmlSrc, "parseProg") + ")")();

const HEAD = "v12|COUNT|1|-1|8|5ad|9|32|0|4|120|0|0|";
const prog = (chords) => HEAD.replace("COUNT", String(chords.length)) + chords.join(";");

const cases = [
  ["a lone rest (the phantom-note case)", prog(["REST,A3,0,8,0,100,0,1,"])],
  ["four rests",                          prog(Array(4).fill("REST,A4,0,8,0,100,0,1,"))],
  ["a triad",                             prog(["Am,A3,0,8,0,100,0,1,57.60.64"])],
  ["rest then chord",                     prog(["REST,A3,0,8,0,100,0,1,", "C,C4,0,8,0,100,0,1,60.64.67"])],
  ["muted",                               prog(["Am,A3,0,8,0,100,1,1,57.60.64"])],
  ["a rhythm mask",                       prog(["Am,A3,0,16,0,100,0,1249,57.60.64"])],
  ["inversion and offset",                prog(["Am,A3,-2,4,3,88,0,1,57.60.64"])],
  ["a single note",                       prog(["A,A3,0,8,0,100,0,1,57"])],
  ["out-of-range notes dropped",          prog(["X,A3,0,8,0,100,0,1,57.999.-4.60"])],
  ["empty string",                        ""],
  ["wrong version",                       "v11|1|1|-1|8|5ad|9|32|0|4|120|0|0|Am,A3,0,8,0,100,0,1,57"],
  ["truncated header",                    "v12|1|1|"],
];

/* Compare only what both sides claim to answer: the per-chord facts the
   drawers use. A field one parser adds for its own drawing is not drift. */
const project = (p) => p === null ? null : {
  count: p.count, sel: p.sel, stepUnits: p.stepUnits, clipUnits: p.clipUnits,
  key: p.key, mask: p.mask, running: p.running, grouping: p.grouping,
  chords: p.chords.map((c) => ({
    name: c.name, inv: c.inv, len: c.len, off: c.off, vel: c.vel,
    mute: c.mute, mask: c.mask, rest: c.rest, notes: c.notes,
  })),
};

let bad = 0;
for (const [label, s] of cases) {
  const a = JSON.stringify(project(deviceParse(s)));
  const b = JSON.stringify(project(panelParse(s)));
  if (a !== b) {
    bad++;
    console.error("FAIL: parsers disagree on " + label);
    console.error("  canvas.js  : " + a);
    console.error("  web_ui.html: " + b);
  }
}

/* The specific regression, asserted by NAME as well as by agreement: both
   must read an empty note field as no notes, so that neither can be "fixed"
   into agreeing on a phantom note at pitch 0. */
for (const [who, fn] of [["canvas.js", deviceParse], ["web_ui.html", panelParse]]) {
  const p = fn(prog(["REST,A3,0,8,0,100,0,1,"]));
  if (!p || p.chords[0].notes.length !== 0 || p.chords[0].rest !== true) {
    bad++;
    console.error("FAIL: " + who + " read an empty note field as " +
                  JSON.stringify(p && p.chords[0].notes) + " (want [] and rest:true)");
  }
}

if (bad) { console.error(bad + " disagreement(s)"); process.exit(1); }
console.log("PASS: both parseProg implementations agree on " + cases.length +
            " prog strings, and an empty note field is no notes in each");
NODE
