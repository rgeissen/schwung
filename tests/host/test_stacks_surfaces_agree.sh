#!/bin/bash
#
# THE TWO SURFACES EDIT ONE MODULE, AND EACH MUST BE ABLE TO SEE THE OTHER.
#
# Stacks is driven from two places at once: the takeover on the Move's screen
# (canvas.js) and the Remote UI panel in a browser (web_ui.html).  Everything
# needed to keep them in step is already published -- `sel` says which chord is
# selected and `prog` carries the whole progression including the playhead --
# but for a long time NEITHER SIDE EVER ASKED AGAIN:
#
#   * canvas.js kept its own S.cursor and reconciled it with `sel` exactly once,
#     in onOpen.  Select a chord in the browser and the Move's knobs went on
#     editing the chord it had been looking at -- the worst way to disagree,
#     because both screens looked right.
#
#   * the manager pushed the key that was WRITTEN, and `prog` is DERIVED, so no
#     write ever names it.  Turn the jog on the device and the browser's chord
#     strip, piano roll and playhead sat exactly where they were when the tab
#     was opened, while the ordinary controls beside them updated correctly.
#
# What is pinned here is the shape of the fix on both sides, plus the one piece
# of arithmetic that a reader cannot check by eye: which fields of `prog` may
# make the device spend a dozen reads.  Including a time-varying one (bpm,
# posUnits, playing, running) would make the bank "stale" four times a second
# forever, which is a param-channel flood that looks like a slow device.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MOD="$ROOT/src/modules/midi_fx/stacks"
CANVAS="$MOD/canvas.js"
PANEL="$MOD/web_ui.html"
SHADOW="$ROOT/src/shadow/shadow_ui.js"
MGR="$ROOT/schwung-manager/remote_ui.go"
fail=0
note() { echo "FAIL: $1"; fail=1; }

# --- the device follows the module's selection ---------------------------
grep -q 'S.cursor = parsed.sel - 1' "$CANVAS" \
  || note "canvas.js: refresh() no longer adopts prog.sel -- the cursor is a second copy of the selection again"
grep -q 'onPoll(ctx)' "$CANVAS" \
  || note "canvas.js: no onPoll -- the takeover reads only on its own input"

# --- the host gives a takeover a metronome, and it is an EVENT ------------
grep -q 'const CANVAS_POLL_MS' "$SHADOW" \
  || note "shadow_ui.js: CANVAS_POLL_MS is gone -- the poll is unthrottled"
grep -q 'DRAW_PATH_HOOKS = new Set(\["draw", "tick"\])' "$SHADOW" \
  || note "shadow_ui.js: DRAW_PATH_HOOKS changed -- onPoll must NOT be in it or it loses getParam"
grep -q 'invokeCanvasOverlayHook("onPoll"' "$SHADOW" \
  || note "shadow_ui.js: onPoll is not called through invokeCanvasOverlayHook -- a throw would not disable it"
grep -q 'typeof canvasRuntime.overlay.onPoll !== "function"' "$SHADOW" \
  || note "shadow_ui.js: onPoll is no longer opt-in -- every overlay pays for it"

# --- the panel is told about derived values, not only written ones --------
grep -q 'func (ru \*RemoteUI) pushExtraKeys' "$MGR" \
  || note "remote_ui.go: pushExtraKeys is gone -- a device edit no longer refreshes viz.extra_keys"
grep -q 'pendingExtras\[c.Slot\]' "$MGR" \
  || note "remote_ui.go: the notify drain no longer marks a component's extras stale"
grep -q 'extrasRefreshThrottle' "$MGR" \
  || note "remote_ui.go: the extras push is unthrottled -- a jog spin is a read per detent"
grep -q 'nobody is looking: never touch the param channel' "$MGR" \
  || note "remote_ui.go: the extras push no longer checks for subscribers -- it reads with no panel open"
grep -q 'func (ru \*RemoteUI) extrasHeartbeatLoop' "$MGR" \
  || note "remote_ui.go: no extras heartbeat -- the TRANSPORT writes no param, so playback would never reach the browser"
grep -q 'go ru.extrasHeartbeatLoop(ctx)' "$MGR" \
  || note "remote_ui.go: the extras heartbeat is never started"
grep -q 'if ru.extrasBusy\[k\] {' "$MGR" \
  || note "remote_ui.go: no in-flight guard -- two overlapping pushes answer out of order and the playhead jumps backwards"
grep -q 'Send only what MOVED' "$MGR" \
  || note "remote_ui.go: the heartbeat no longer diffs -- an idle panel gets 2 messages a second"

# --- the panel does not treat any publish as an answer to its own write ---
grep -q 'prog.sel === selPending' "$PANEL" \
  || note "web_ui.html: selPending is cleared by any publish again -- a click flickers back to the old chord"
grep -q 'SEL_ACK_MS' "$PANEL" \
  || note "web_ui.html: no deadline on selPending -- a lost write latches the highlight on a lie"

# --- one transport, and STOP means stop -----------------------------------
#
# The module sounds for three reasons -- its own `preview` loop, a momentary
# `play` hold, and Move's transport while Run is on -- and the panel's button
# knew only about the first.  So it drew a sweeping playhead beside a button
# that said "play", and its Stop wrote `preview` off, which was not what was
# making the sound.  Worse, a `play` hold whose RELEASE never arrives (a
# pointer lost, a page closed mid-press, a claimed CC whose release the shim
# withheld) latches the transport open for the session, and nothing on either
# screen could stop it.
grep -q 'function isSounding()' "$PANEL" \
  || note "web_ui.html: the transport button no longer reports prog.running -- it will contradict the playhead beside it"
grep -q 'set("play", "off");' "$PANEL" \
  || note "web_ui.html: Stop no longer clears a latched audition -- a missed release plays forever"
grep -q 'ctx.setParam("play", "off")' "$CANVAS" \
  || note "canvas.js: onClose no longer releases the hold -- a takeover dismissed mid-press leaves the module playing"

# --- and the signature that decides a dozen reads, RUN rather than read ---
node - "$CANVAS" <<'JS' || fail=1
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8");
const m = src.match(/function bankSig\(p\) \{[\s\S]*?\n\}/);
if (!m) { console.log("FAIL: canvas.js: bankSig is gone"); process.exit(1); }
const bankSig = new Function("return (" + m[0] + ")")();

const chord = { name: "Am7", rootName: "A3", inv: 0, len: 8, off: 0,
                vel: 100, mute: false, mask: 0x1 };
const base = { sel: 1, count: 4, grouping: 0, key: 9, mask: 0x5ad,
               stepUnits: 8, clipUnits: 32,
               bpm: 120, posUnits: 0, playing: -1, running: 0,
               chords: [chord, chord, chord, chord] };
const sig = bankSig(base);
let bad = 0;
const same = (label, patch) => {
    if (bankSig(Object.assign({}, base, patch)) !== sig) {
        console.log("FAIL: bankSig moves on " + label +
                    " -- the bank would be re-read on every publish");
        bad = 1;
    }
};
const differs = (label, patch) => {
    if (bankSig(Object.assign({}, base, patch)) === sig) {
        console.log("FAIL: bankSig ignores " + label +
                    " -- the knob row would show another chord's values");
        bad = 1;
    }
};
/* Time passing is not a change to what the knobs show. */
same("bpm", { bpm: 140 });
same("posUnits", { posUnits: 17 });
same("playing", { playing: 2 });
same("running", { running: 1 });
/* Anything the knob row is actually made of is. */
differs("sel", { sel: 3 });
differs("count", { count: 5 });
differs("grouping", { grouping: 4 });
differs("key", { key: 0 });
differs("scale mask", { mask: 0xfff });
differs("clip length", { clipUnits: 64 });
differs("the selected chord's shape",
        { chords: [Object.assign({}, chord, { name: "Amaj7" }), chord, chord, chord] });
differs("the selected chord's inversion",
        { chords: [Object.assign({}, chord, { inv: 2 }), chord, chord, chord] });
differs("the selected chord's rhythm",
        { chords: [Object.assign({}, chord, { mask: 0x55 }), chord, chord, chord] });
/* A chord that is NOT selected owns none of those values. */
same("an unselected chord",
     { chords: [chord, Object.assign({}, chord, { inv: -3 }), chord, chord] });
process.exit(bad);
JS

# --- and the takeover DRIVEN, because a source pin cannot price a read -------
#
# The overlay is loaded into a sandbox and polled with a real `prog` off the
# device.  Two things are being priced and one is being proved:
#
#   * an idle poll costs ONE read, and only a change to what the knob row shows
#     buys the dozen-read bank refresh -- a poll that spent them on every tick
#     would be a param-channel flood that presents as a slow device;
#   * a poll must never WRITE, or two surfaces fight over the selection;
#   * and after the browser moves the selection, THE JOG MUST EDIT THE CHORD
#     THE BROWSER IS SHOWING.  That is the whole feature, and it is invisible
#     to any amount of grepping: with a private cursor the turn writes sel=2
#     while the browser sits on chord 3.
node - "$CANVAS" <<'JS' || fail=1
const fs = require("fs"), vm = require("vm");
const src = fs.readFileSync(process.argv[2], "utf8");
const P = (sel) => "v13|4|" + sel + "|-1|8|5ad|9|32|0|4|120|0|0|"
  + "Amaj7,A3,0,8,0,100,0,1,57:100.61:100.64:100.68:100;"
  + "Dmaj7,D3,0,8,0,100,0,1,50:100.54:100.57:100.61:100;"
  + "Emaj7,E3,0,8,0,100,0,1,52:100.56:100.59:100.63:100;"
  + "Amaj7,A3,0,8,0,100,0,1,57:100.61:100.64:100.68:100";

let now = 1000, prog = P(1), reads = [], writes = [];
const ctx = {
    width: 128, height: 64, state: {},
    clear(){}, setPixel(){}, drawRect(){}, fillRect(){}, drawLine(){}, print(){},
    now(){ return now; }, random(){ return 0.5; },
    getValue(){ return ""; }, setValue(){ return true; },
    getParam(k){ reads.push(k); return k === "prog" ? prog : "0"; },
    setParam(k, v){ writes.push(k + "=" + v); return true; },
    sourcePath(){ return ""; },
};
const sandbox = { console, Date, Math, JSON, parseInt, parseFloat, Number,
                  isFinite, isNaN, String, Array, Object, Set, Map, performance };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "canvas.js" });
const ov = sandbox.canvas_overlay;
let bad = 0;
const check = (cond, msg) => { if (!cond) { console.log("FAIL: " + msg); bad = 1; } };
check(ov && typeof ov.onPoll === "function", "canvas.js: no onPoll on the overlay");
if (!ov || !ov.onPoll) process.exit(1);

ov.onOpen(ctx);

reads = []; ov.onPoll(ctx);
check(reads.length === 1 && reads[0] === "prog",
      "an idle poll cost " + reads.length + " reads, not one -- it should read `prog` and stop");

/* Only the playhead moving is not a change to what the knobs show. */
prog = P(1).replace("|4|120|0|0|", "|4|120|17|0|"); now += 600;
reads = []; ov.onPoll(ctx);
check(reads.length === 1,
      "a moving playhead bought " + reads.length + " reads -- the bank is being re-read on every publish");

/* The browser selects chord 3. */
prog = P(3); now += 600;
reads = []; ov.onPoll(ctx);
check(reads.length > 1, "the selection moved and the bank was not re-read -- the knob row shows another chord's values");

reads = [];
try { ov.draw(ctx); } catch (e) { check(false, "draw threw after a poll: " + e.message); }
check(reads.length === 0, "draw read " + reads.length + " params -- nothing may read on the draw path");

check(writes.length === 0, "polling wrote " + writes.join(",") + " -- a poll must never write");

/* THE POINT OF ALL OF IT: the jog now edits the chord the browser is showing. */
writes = [];
ov.onMidi(ctx, { source: 0, data: [0xB0, 14, 1] });   /* one detent clockwise */
const sel = writes.filter((w) => w.startsWith("sel="));
check(sel.length === 1 && sel[0] === "sel=4",
      "after the browser selected chord 3, a jog detent wrote " + (sel[0] || "nothing") +
      " -- expected sel=4, so the two surfaces are editing different chords");
process.exit(bad);
JS

# --- the staff names its chords, and never names them WRONG ---------------
#
# Rendered into a framebuffer, because both rules are about pixels: a block too
# narrow for "C#" must be left unnamed rather than printed as "C" (a different
# chord, with nothing to say it was cut), and the 6px band must not be taken
# out of a ~54px staff when nothing can go in it.
node - "$CANVAS" <<'JS' || fail=1
const fs = require("fs"), vm = require("vm");
const src = fs.readFileSync(process.argv[2], "utf8");
const W = 128, H = 64;
function render(chords) {
    const fb = new Uint8Array(W * H);
    const px = (x, y, v) => { x = Math.round(x); y = Math.round(y);
        if (x >= 0 && y >= 0 && x < W && y < H) fb[y * W + x] = v ? 1 : 0; };
    const prog = "v13|" + chords.length + "|1|-1|8|5ad|9|32|0|4|98|0|0|"
        + chords.map(([c, len]) => c + ",A3,0," + len + ",0,100,0,1,57:100.61:100.64:100.68:100").join(";");
    const ctx = { width: W, height: H, state: {}, clear(){ fb.fill(0); }, setPixel: px,
        fillRect(x,y,w,h,v){ for (let j=0;j<h;j++) for (let i=0;i<w;i++) px(x+i,y+j,v); },
        drawRect(x,y,w,h,v){ for(let i=0;i<w;i++){px(x+i,y,v);px(x+i,y+h-1,v);}
                             for(let j=0;j<h;j++){px(x,y+j,v);px(x+w-1,y+j,v);} },
        drawLine(){}, print(){}, now(){ return 5000; }, random(){ return 0.5; },
        getValue(){ return ""; }, setValue(){ return true; },
        getParam(k){ return k === "prog" ? prog : "0"; }, setParam(){ return true; },
        sourcePath(){ return ""; } };
    const sandbox = { console, Date, Math, JSON, parseInt, parseFloat, Number, isFinite,
                      isNaN, String, Array, Object, Set, Map, performance, Uint8Array };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: "canvas.js" });
    const ov = sandbox.canvas_overlay;
    ov.onOpen(ctx); ctx.clear(); ov.draw(ctx);
    /* Ink in the name band at the FOOT of the staff, by column. */
    return (x0, x1) => {
        let ink = 0;
        for (let y = 58; y < 64; y++) for (let x = x0; x < x1; x++) ink += fb[y * W + x];
        return ink;
    };
}
let bad = 0;

/* Four wide chords: every one of them says its name. */
const wide = render([["Amaj7", 8], ["Dmin7", 8], ["Emaj7", 8], ["Amin7", 8]]);
if (wide(0, W) < 40) {
    console.log("FAIL: four wide chords drew " + wide(0, W) +
                " pixels of name -- the staff has stopped naming them");
    bad = 1;
}

/*
 * TWO BLOCKS OF THE SAME WIDTH, one of which must refuse. At 8px a block holds
 * ONE glyph: enough for "A", not for "C#" -- and one glyph of "C#M7" is "C",
 * a chord that is not in the progression, printed with nothing to say it was
 * cut. Slots: 14 units of A, then 2 of C#m7 (x 56..64), then 2 of Am7
 * (x 64..72), then 14 of D. clipU is 32 and the staff is 128 wide, so a unit
 * is 4px.
 */
const mixed = render([["Amaj7", 14], ["C#m7", 2], ["Am7", 2], ["Dmin7", 14]]);
if (mixed(56, 64) !== 0) {
    console.log("FAIL: a block too narrow for C# still drew " + mixed(56, 64) +
                " pixels -- it can only be naming a chord that is not there");
    bad = 1;
}
if (mixed(64, 72) === 0) {
    console.log("FAIL: an 8px block whose root DOES fit was left unnamed -- " +
                "the guard is refusing more than the root");
    bad = 1;
}
process.exit(bad);
JS

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "PASS: both surfaces follow one selection, and each is told when the other moves it"
