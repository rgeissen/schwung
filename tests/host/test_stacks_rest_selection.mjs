/*
 * THE SELECTION BRACKET BELONGS TO THE SLOT, NOT TO THE NOTES.
 *
 * It was drawn inside drawChordBlock, and the rest path reaches that with an
 * early `continue` -- so a selected REST drew no bracket at all. That is the
 * state the module BOOTS in and the state Clear returns to: one rest. So at the
 * one moment the cursor matters most -- an empty buffer, where the only thing
 * you can do is edit the slot you are on -- nothing on screen said which slot
 * that was.
 *
 * Rendered rather than read, because "the code calls drawSelection" and "pixels
 * appear at the slot edges" are different claims and only the second one is
 * the bug.
 */
import { readFileSync } from "node:fs";

const src = readFileSync(new URL(
    "../../src/modules/midi_fx/stacks/canvas.js", import.meta.url), "utf8");

/* A recording context with the fullscreen canvas API -- deliberately WITHOUT
 * textWidth, which the real one does not have either. A stub richer than the
 * host hid exactly this class of bug once already. */
function makeCtx(prog) {
    const px = new Set();
    const mark = (x, y, w, h) => {
        for (let i = 0; i < w; i++) for (let j = 0; j < h; j++)
            px.add(`${Math.round(x + i)},${Math.round(y + j)}`);
    };
    return {
        width: 128, height: 64, px,
        clear() { px.clear(); },
        setPixel(x, y) { mark(x, y, 1, 1); },
        fillRect(x, y, w, h) { mark(x, y, w, h); },
        drawRect(x, y, w, h) { mark(x, y, w, 1); mark(x, y + h - 1, w, 1); },
        drawLine(x0, y0, x1, y1) { mark(Math.min(x0, x1), Math.min(y0, y1),
                                        Math.abs(x1 - x0) + 1, Math.abs(y1 - y0) + 1); },
        print() {}, now: () => 0, random: () => 0,
        getParam(k) { return k === "prog" ? prog : "0"; },
        setParam() {},
    };
}

const g = {};
new Function("globalThis", "shadow_get_shift_held",
             "shadow_get_overlay_state", src)(g, () => 0, () => null);
const ov = g.canvas_overlay;
if (!ov) { console.log("FAIL: canvas_overlay was not defined"); process.exit(1); }

/*
 * MOVING THE CURSOR MUST CHANGE THE PICTURE. That is the only honest test
 * here: `drawRest` already paints a solid column down each edge of its slot,
 * so "is there ink at the left edge" is true whether or not a bracket was
 * drawn -- my first attempt asserted exactly that and passed against the bug.
 * Rendering the same buffer with the cursor on slot 1 and then slot 2 isolates
 * the bracket, because nothing else on the staff depends on the selection.
 *
 * header: v12|count|sel|playing|stepUnits|mask|key|clipUnits|running|
 *              stepBeats|bpm|posUnits|grouping| then name,root,inv,len,off,
 *              vel,mute,rhythmMask,notes
 */
const two = (sel, notesA, notesB) =>
    `v12|2|${sel}|-1|8|ab5|9|32|0|4|120|0|0|` +
    `${notesA ? "Am" : "REST"},A3,0,8,0,100,0,1,${notesA}` + ";" +
    `${notesB ? "Cm" : "REST"},C3,0,8,0,100,0,1,${notesB}`;

const render = (prog) => {
    const ctx = makeCtx(prog);
    ov.onOpen(ctx);
    ctx.clear();
    ov.draw(ctx);
    return ctx.px;
};
const diff = (a, b) => {
    let n = 0;
    for (const p of a) if (!b.has(p)) n++;
    for (const p of b) if (!a.has(p)) n++;
    return n;
};

let bad = 0;
for (const [what, A, B] of [
        ["two RESTS",  "", ""],
        ["two CHORDS", "57.60.64", "48.51.55"]]) {
    const d = diff(render(two(1, A, B)), render(two(2, A, B)));
    const ok = d > 0;
    console.log(`  cursor on slot 1 vs 2, ${what.padEnd(11)} ` +
                `${String(d).padStart(3)} pixels differ  ` +
                (ok ? "ok" : "FAIL: the cursor is invisible here"));
    if (!ok) bad = 1;
}

console.log("\n" + (bad
    ? "FAIL: the cursor is invisible on a slot with no notes"
    : "the selection bracket is drawn on an empty slot as well as a full one"));
process.exit(bad);
