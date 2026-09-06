/*
 * A KNOB MUST ASK THE CONTRACT WHAT IT IS HOLDING, NOT PARSE THE VALUE.
 *
 * The overlay decided "number or enum" by running parseInt over whatever the
 * module reported. SIX CHORD SHAPES ARE NAMED WITH DIGITS -- 5, 6, 69, 9, 11
 * and 13 -- so:
 *
 *   on "69" (the 6/9 chord)   a detent wrote "70", not a shape, refused: the
 *                             knob went DEAD. Reported from the device as
 *                             "the shape shows 69 and then it hangs".
 *   on "5"  (the power chord) a detent wrote "6", which IS a shape eight
 *                             positions away: the walk teleported, silently.
 *
 * THIS DRIVES THE REAL HANDLER. A first version pulled PARAM_RANGES out and
 * applied its own copy of the rule -- which passed against the broken code,
 * because it was testing the data rather than the decision. Turning a knob and
 * looking at what gets WRITTEN is the only version that can fail.
 */
import { readFileSync } from "node:fs";

const src = readFileSync(new URL(
    "../../src/modules/midi_fx/stacks/canvas.js", import.meta.url), "utf8");
const g = {};
new Function("globalThis", "shadow_get_shift_held", "shadow_get_overlay_state",
             src)(g, () => 0, () => null);
const ov = g.canvas_overlay;

const PROG = "v12|1|1|-1|8|ab5|9|32|0|4|120|0|0|Am,A3,0,8,0,100,0,1,57.60.64";

/* Turn the knob that carries `key` and report what the module is told. */
function turn(key, reports) {
    const writes = [];
    const ctx = {
        width: 128, height: 64,
        clear() {}, setPixel() {}, fillRect() {}, drawRect() {}, drawLine() {},
        print() {}, now: () => 0, random: () => 0,
        getParam(k) { return k === "prog" ? PROG : (reports[k] ?? "0"); },
        setParam(k, v) { writes.push([k, v]); },
    };
    ov.onOpen(ctx);
    writes.length = 0;

    /* Find the slot this key occupies on the bank the overlay opened on. */
    const bank = g.BANKS ? null : null;   /* not exported; locate via a sweep */
    for (let slot = 0; slot < 8; slot++) {
        writes.length = 0;
        ov.onMidi(ctx, { data: [0xB0, 71 + slot, 1] });   /* one detent up */
        const hit = writes.find((w) => w[0] === key);
        if (hit) return hit[1];
    }
    return null;
}

let bad = 0;
const cases = [
    ["shape", "69",  "~1", "the 6/9 chord -- must step, not become 70"],
    ["shape", "5",   "~1", "the power chord -- must step, not become 6"],
    ["shape", "maj", "~1", "an ordinary shape name"],
    ["len",   "8",   "9",  "a real number must still do arithmetic"],
    ["inv",   "0",   "1",  "a real number, negative range"],
];
for (const [key, reported, want, why] of cases) {
    const got = turn(key, { [key]: reported });
    const ok = got === want;
    console.log(`  ${key.padEnd(6)} reads ${JSON.stringify(reported).padEnd(6)}` +
                ` -> writes ${JSON.stringify(got).padEnd(6)} want ${JSON.stringify(want).padEnd(6)}` +
                ` ${ok ? "ok" : "FAIL"}  ${why}`);
    if (!ok) bad = 1;
}

console.log("\n" + (bad
    ? "FAIL: a knob misreads its own parameter type"
    : "knobs step enums and add to numbers, whatever the value looks like"));
process.exit(bad);
