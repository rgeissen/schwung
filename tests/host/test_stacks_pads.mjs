/*
 * THE BOTTOM PAD ROW IS THE PROGRESSION.
 *
 * Notes 68-99 are four rows of eight, numbered BOTTOM-LEFT to top-right, so
 * 68-75 is the row your hands rest on and chord 1 sits under your left thumb.
 *
 * Three things this pins, and the last is the one that can hurt somebody else:
 *
 *  - a pad SELECTS and PLAYS, and releasing it stops -- the same contract the
 *    jog click has, so holding a pad sustains exactly like holding the jog.
 *  - Left/Right page the row, because a progression runs to sixteen chords and
 *    a row is eight. Paging clamps at both ends.
 *  - `host_pad_block` is a GLOBAL switch: while it is set, no other module can
 *    see the pads. It must be taken in onOpen and RELEASED in onClose, and the
 *    pads handed back DARK -- Move writes a pad LED only when its own value
 *    changes, so one we left lit stays lit on its track until something else
 *    moves it. Same failure the knob rings already document.
 */
import { readFileSync } from "node:fs";

const src = readFileSync(new URL(
    "../../src/modules/midi_fx/stacks/canvas.js", import.meta.url), "utf8");

let padBlock = null, LEDS = [], shown = 1;
const g = {};
new Function("globalThis", "shadow_get_shift_held", "shadow_get_overlay_state",
             "host_pad_block", "move_midi_internal_send", "shadow_restore_knob_leds",
             "shadow_get_display_mode",
             src + "\nglobalThis.__S = S;")(g, () => 1, () => null,
                  (v) => { padBlock = v; }, (m) => LEDS.push(m), () => {},
                  () => shown);
const ov = g.canvas_overlay;

const ch = (n, notes) => `${n},A3,0,8,0,100,0,1,${notes}`;
/* ten chords; #5 is a rest; #2 is sounding; #1 selected */
const PROG = "v12|10|1|1|8|ab5|9|80|1|4|120|0|0|" +
  [ch("Am","57.60.64"), ch("C","48.52.55"), ch("F","53.57.60"), ch("G","55.59.62"),
   ch("REST",""), ch("Am","57.60.64"), ch("C","48.52.55"), ch("F","53.57.60"),
   ch("G","55.59.62"), ch("Am","57.60.64")].join(";");

const writes = [];
const ctx = { width:128, height:64, clear(){}, setPixel(){}, fillRect(){},
  drawRect(){}, drawLine(){}, print(){}, now:()=>0, random:()=>0,
  getParam(k){ return k === "prog" ? PROG : "0"; },
  setParam(k,v){ writes.push(`${k}=${v}`); } };

let bad = 0;
const check = (what, got, want) => {
  const ok = String(got) === String(want);
  console.log(`  ${what.padEnd(34)} ${String(got).padEnd(26)} ${ok ? "ok" : "FAIL want " + want}`);
  if (!ok) bad = 1;
};

ov.onOpen(ctx);
check("pads claimed on open", padBlock, 1);

/* The row must distinguish four states, or you cannot read the progression. */
LEDS = []; ov.tick(ctx);
const NAME = {122:"PLAY", 3:"SEL", 69:"chord", 70:"rest", 0:"-"};
/* The CHORD row only -- notes 68-75. The parameter rows above light too, and
 * collecting all four made this compare a 32-entry string against an 8-entry
 * expectation. */
const row = () => {
  const out = new Array(8).fill(null);
  for (const m of LEDS) if (m[2] >= 68 && m[2] < 76) out[m[2] - 68] = NAME[m[3]] ?? m[3];
  return out.join(" ");
};
/* Mute + arrow is what pages the chord row now; a bare arrow scrolls the
 * parameter rows. */
const chordPage = (dir) => {
  ov.onMidi(ctx, { data:[0xB0, 88, 127] });
  ov.onMidi(ctx, { data:[0xB0, dir > 0 ? 63 : 62, 127] });
  ov.onMidi(ctx, { data:[0xB0, 88, 0] });
};
check("page 0 shows every state", row(), "SEL PLAY chord chord rest chord chord chord");

/* Paging, and clamping at both ends. */
chordPage(1);
LEDS = []; ov.tick(ctx);
check("Mute+RIGHT -> chords 9-16", row(), "chord chord - - - - - -");
LEDS = []; chordPage(1); ov.tick(ctx);
check("clamps (no LED churn)", LEDS.length, 0);
chordPage(-1);                                 /* back to page 0 ... */
ov.tick(ctx);                                  /* ...and FLUSH that change */
LEDS = []; chordPage(-1); ov.tick(ctx);
/* Only now is the row settled, so a clamped LEFT must emit nothing. Measuring
 * without the flush above counted the previous page turn and read as a bug in
 * the clamp -- the test was wrong, not the code. */
check("LEFT clamps at page 0", LEDS.length, 0);

/* A pad selects AND plays; releasing stops. */
writes.length = 0; ov.onMidi(ctx, { data:[0x90, 70, 120] });
check("pad 3 down", writes.join(", "), "sel=3, play=on");
writes.length = 0; ov.onMidi(ctx, { data:[0x80, 70, 0] });
check("pad 3 up stops it", writes.join(", "), "play=off");

/* A pad past the end of the progression does nothing at all. */
chordPage(1);                                  /* page to 9-16 */
writes.length = 0; ov.onMidi(ctx, { data:[0x90, 73, 120] });   /* chord 14: none */
check("pad past the end is inert", writes.join(", ") || "(nothing)", "(nothing)");

/*
 * THE BOTTOM ROW IS THE CHORDS ON EVERY PAGE, FOREVER.
 *
 * The knob banks page with Shift+Jog and the plan is for Up/Down to page
 * PARAMETER rows above this one. Neither may reach the bottom row: it is the
 * one row you can always trust, so the hand never has to ask which page it is
 * on before touching it. Asserted by cycling every bank and checking a pad
 * still selects the same chord -- the failure this prevents is a future row
 * feature quietly sweeping the chord row into its paging.
 */
{
  /* Back to page 0 first: the case above left the row on chords 9-16, where
   * pad 3 is chord 11. Carrying that state in made this read as a failure of
   * the bank independence it is actually testing. */
  chordPage(-1); chordPage(-1);
  let sameEverywhere = true;
  for (let i = 0; i < 8; i++) {
    ov.onMidi(ctx, { data:[0xB0, 14, 1] });          /* Shift+Jog: next bank */
    writes.length = 0;
    ov.onMidi(ctx, { data:[0x90, 70, 120] });        /* pad 3 */
    ov.onMidi(ctx, { data:[0x80, 70, 0] });
    if (!writes.includes("sel=3")) sameEverywhere = false;
  }
  check("pad 3 selects chord 3 on every bank", sameEverywhere, true);
}

/*
 * ROWS 2-4 EDIT THE SELECTED CHORD, one parameter per row.
 *
 * The degree row lights only the degrees the SCALE HAS -- pentatonic has five,
 * blues six -- because the module simply finds no such degree and leaves the
 * root alone, so lighting seven would offer two pads that do nothing. A dark
 * pad must also refuse the press, or the row lies about what is reachable.
 */
{
  const PENT = "v12|4|1|-1|8|299|9|32|0|4|120|0|0|" +
    [ch("Am","57.60.64"), ch("C","48.52.55"),
     ch("F","53.57.60"), ch("G","55.59.62")].join(";");
  const pctx = { ...ctx, getParam(k) {
      return k === "prog" ? PENT
           : k === "degree" ? "III" : k === "len" ? "8"
           : k === "family" ? "triad" : "0"; } };
  ov.onOpen(pctx); LEDS = []; ov.tick(pctx);
  const lit = [];
  for (const m of LEDS) if (m[2] >= 76 && m[2] < 84) lit[m[2] - 76] = m[3] !== 0;
  check("pentatonic lights 5 degrees",
        lit.filter(Boolean).length, 5);

  writes.length = 0; ov.onMidi(pctx, { data:[0x90, 76 + 4, 120] });
  check("degree pad writes the value", writes.join(","), "degree=V");
  writes.length = 0; ov.onMidi(pctx, { data:[0x90, 76 + 6, 120] });
  check("a dark degree pad is inert", writes.join(",") || "(nothing)", "(nothing)");
  writes.length = 0; ov.onMidi(pctx, { data:[0x90, 84 + 2, 120] });
  check("length row writes len", writes.join(","), "len=8");
  writes.length = 0; ov.onMidi(pctx, { data:[0x90, 92 + 3, 120] });
  check("quality row writes family", writes.join(","), "family=7th");

  /* Mute + arrow moves the CHORDS; a bare arrow moves the rows. */
  ov.onOpen(ctx);
  ov.onMidi(ctx, { data:[0xB0, 88, 127] });         /* Mute down */
  ov.onMidi(ctx, { data:[0xB0, 63, 127] });         /* Mute + Right */
  ov.onMidi(ctx, { data:[0xB0, 88, 0] });
  writes.length = 0; ov.onMidi(ctx, { data:[0x90, 68, 120] });
  check("Mute+Right paged the chord row", writes.join(",").includes("sel=9"), true);
  ov.onMidi(ctx, { data:[0x80, 68, 0] });
}

/*
 * EVERY PAGE MOVEMENT SAYS WHAT IT DID.
 *
 * The arrows and pads are silent hardware, and the LEDs alone cannot answer
 * it: eight lit pads look the same whether they are degrees or rhythms. So a
 * movement that changes what a control MEANS puts a line on the staff -- and
 * it names the ROWS, not just the page, because the page name does not tell
 * you which pad does what.
 */
{
  const S = g.__S;
  ov.onOpen(ctx);
  /*
   * ONE HUE PER ROW, BY POSITION, AND THE CHORD ROW KEEPS ITS OWN.
   *
   * Three rows in the same orange were unreadable -- eight lit pads look the
   * same whether they are degrees or lengths. The hue says WHERE you are and
   * the message says WHAT is there. The bottom row is excluded on purpose: it
   * never changes meaning, so it must never change colour.
   */
  {
    LEDS = []; ov.tick(ctx);
    const hue = {};
    for (const m of LEDS) if (m[3]) (hue[Math.floor((m[2] - 68) / 8)] ||= new Set()).add(m[3]);
    const distinct = new Set();
    for (let r = 1; r <= 3; r++) for (const c of (hue[r] || [])) distinct.add(c);
    check("rows 2-4 use different hues", distinct.size >= 3, true);
    const chordHues = [...(hue[0] || [])];
    const paramHues = [...distinct];
    check("the chord row shares none of them",
          chordHues.every((c) => !paramHues.includes(c)), true);
  }

  ov.onMidi(ctx, { data:[0xB0, 55, 127] });                 /* Up: WRITE -> VOICE */
  check("Up names the page AND its rows",
        /^VOICE: INV COL OCT$/.test(S.toast), true);
  ov.onMidi(ctx, { data:[0xB0, 55, 127] });                 /* -> FEEL */
  ov.onMidi(ctx, { data:[0xB0, 55, 127] });                 /* clamped */
  check("a press that changed nothing says so",
        /SET$/.test(S.toast), true);
  ov.onMidi(ctx, { data:[0xB0, 63, 127] });                 /* scroll 24 rhythms */
  check("a scroll says where in the list", /OF 24$/.test(S.toast), true);
  ov.onMidi(ctx, { data:[0xB0, 54, 127] });
  ov.onMidi(ctx, { data:[0xB0, 54, 127] });                 /* back to WRITE */
  ov.onMidi(ctx, { data:[0xB0, 88, 127] });
  ov.onMidi(ctx, { data:[0xB0, 63, 127] });                 /* Mute+Right */
  ov.onMidi(ctx, { data:[0xB0, 88, 0] });
  check("Mute+Right names the chord range", /^CHORDS \d+-\d+$/.test(S.toast), true);

  /* And it fades: a message is an answer, not a state to keep reading. */
  const t0 = S.toastAt;
  check("the message is timestamped", typeof t0 === "number" && t0 >= 0, true);
}

/*
 * OWNERSHIP IS CONTINUOUS. The host releases pad_block whenever nothing on
 * screen wants the pads; taking it once in onOpen therefore is not enough --
 * dismiss the shadow UI and come back and the flag has been cleared while
 * onOpen does not run again. The overlay re-asserts every visible frame.
 */
padBlock = 0;                       /* as if the host had released it */
ov.tick(ctx);
check("re-asserted while visible", padBlock, 1);
padBlock = 0; shown = 0;            /* dismissed: must NOT fight the release */
ov.tick(ctx);
check("not re-asserted while hidden", padBlock, 0);
shown = 1;

/* And the pads go back, dark, before the block is released. */
LEDS = []; ov.onClose();
check("pads released on close", padBlock, 0);
/*
 * THE OVERLAY MUST NOT BLANK THEM ON THE WAY OUT.
 *
 * Blanking and releasing hands Move a grid it will not repaint -- it writes a
 * pad LED only when its OWN value changes -- so the pads respond and stay
 * invisible, which reads as "the pads are dead". Restoring Move's colours is
 * the HOST's job (test_pad_block_released), because it is the only place that
 * runs on every exit path; the overlay just releases.
 */
check("close writes no pad LEDs at all", LEDS.length, 0);

console.log("\n" + (bad
  ? "FAIL: the pad row does not behave"
  : "the pad row is the progression, pages with the arrows, and is given back"));
process.exit(bad);
