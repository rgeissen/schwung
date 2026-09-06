/*
 * stacks/canvas.js -- the note grid.
 *
 * ONE FILE, TWO SCALES. `draw` owns the FULL SCREEN takeover you dive into
 * from the Grid cell; `drawCell` draws the same progression shrunk into the
 * Chord knob's box on the ordinary knob page.
 *
 * There is deliberately NO `drawPage` / as_page here any more. An as_page page
 * is a knob page carrying a drawer, which means two things it cannot escape:
 * the JOG pages away from it, so it can never be a chord cursor; and turning an
 * enum knob on it raises the host's full-screen enum peek, which clears the
 * screen and covers the very grid the page exists to show. The takeover has
 * neither problem -- param pages do not run in VIEWS.CANVAS at all.
 *
 * THE RULES THIS FILE LIVES UNDER (docs/PARAM_PAGES.md)
 *
 *   The frame is not the screen. (0,0) is the band's top-left; there is no
 *   accessor that reaches absolute space, and every size below is derived from
 *   ctx.width / ctx.height rather than written down.
 *
 *   No reads. Values arrive as an argument. `prog` is ONE viz extra_key
 *   carrying the whole progression -- names, lengths, offsets, the scale mask
 *   and the resolved pitches -- because a read is ~2.8 ms against a 1.68 ms
 *   page render, so one read per chord would cost more than the entire screen.
 *
 *   A read that did not answer must NEVER become a picture. `prog` absent,
 *   empty or malformed draws the empty band; it does not draw a plausible
 *   progression that nothing is playing.
 *
 *   One strike. A throw retires this drawer for the session and the host draws
 *   an ordinary knob page, so nothing here may assume its input is well formed.
 */

/* ===================================================================== *
 * THE GRID IS THE SCALE
 *
 * Pitch maps to a SCALE DEGREE, not to a semitone and not to a staff line.
 * Every horizontal line is one note of the selected scale, so a chord tone
 * lands ON a line and the scale selector is visible in the picture rather than
 * only in a knob. Change Major to Dorian and the grid itself changes.
 *
 * The alternative, a classical five-line staff, cannot express this: it is
 * diatonic in C, so Eb and E share a line and a minor scale would draw
 * identically to a major one. On 128x64 that is a picture that lies.
 *
 * A note outside the scale (a chord's own third, mostly) has no line of its
 * own. It sits at the degree below and is marked, which is what an accidental
 * is for -- and is why `inScale` is carried rather than inferred at draw time.
 * ===================================================================== */

/* Degree table for one mask, built once per distinct scale.
 * degree[midi] = how many scale notes lie at or below it, so the spacing
 * between adjacent scale notes is always exactly one step whatever the
 * scale's interval pattern is. */
/* A step IS eight eighths; `len` and `off` are counted in them, and `len`
 * runs to 16 so a chord can ring on into the next step. */
const EIGHTHS_PER_STEP = 8;

function buildDegrees(mask, key) {
    const inScale = new Uint8Array(128);
    const degree = new Int16Array(128);
    let d = -1;
    for (let n = 0; n < 128; n++) {
        const pc = (((n - key) % 12) + 12) % 12;
        const on = (mask & (1 << pc)) !== 0;
        if (on) d++;
        inScale[n] = on ? 1 : 0;
        /* An out-of-scale note shares the degree of the scale note below it,
         * so it draws between lines rather than on top of its neighbour. */
        degree[n] = d < 0 ? 0 : d;
    }
    return { inScale, degree, mask, key };
}

let degreeCache = null;
function degreesFor(mask, key) {
    if (degreeCache && degreeCache.mask === mask && degreeCache.key === key)
        return degreeCache;
    degreeCache = buildDegrees(mask, key);
    return degreeCache;
}

/*
 * v4|count|sel|playing|rate|maskHex|key|NAME,ROOT,inv,len,off,n.n.n;...
 *
 * Returns null for anything not fully understood -- an absent read, a
 * truncated string, a version this build predates. Null draws nothing.
 */
/*
* v9|count|sel|playing|stepUnits|maskHex|key|clipUnits|running|
 *    NAME,ROOT,inv,len,off,vel,mute,n.n.n; ...
 *
 * Returns null for anything not fully understood -- an absent read, a
 * truncated string, a version this build predates. Null draws nothing, which
 * is the honest picture of "we do not know yet".
 */
function parseProg(s) {
    if (typeof s !== "string" || s.length === 0) return null;
    const head = s.split("|");
    if (head.length < 14 || head[0] !== "v12") return null;
    const sel = parseInt(head[2], 10);
    const playing = parseInt(head[3], 10);
    const mask = parseInt(head[5], 16);
    const key = parseInt(head[6], 10);
    const stepUnits = parseInt(head[4], 10) || 8;
    const clipUnits = parseInt(head[7], 10);
    const running = head[8] === "1";
    const stepBeats = parseInt(head[9], 10) || 4;
    const bpm = parseInt(head[10], 10) || 0;
    const posUnits = parseInt(head[11], 10) || 0;
    const grouping = parseInt(head[12], 10) || 0;
    if (!Number.isFinite(mask) || mask <= 0) return null;

    const chords = [];
    for (const part of head.slice(13).join("|").split(";")) {
        if (!part) continue;
        const f = part.split(",");
        if (f.length < 9) continue;
        const notes = f[8].split(".").map((t) => parseInt(t, 10))
                          .filter((v) => Number.isFinite(v) && v >= 0 && v <= 127);
        /*
         * Every field defaulted, NEVER left undefined. `i${undefined}` prints
         * the literal "iundefined" -- eleven characters that ran straight
         * through the columns beside it, so one missing field corrupted a
         * whole row rather than one cell.
         */
        chords.push({
            name: f[0] || "",
            rootName: f[1] || "",
            inv: parseInt(f[2], 10) || 0,
            len: parseInt(f[3], 10) || 1,
            off: parseInt(f[4], 10) || 0,
            vel: parseInt(f[5], 10) || 100,
            mute: f[6] === "1",
            /* The rhythm as its MASK, not its name: the grid draws the hits,
             * and a name would mean a second copy of the pattern table here. */
            mask: parseInt(f[7], 16) || 1,
            /* A REST is a chord with no notes, and it is drawn rather than
             * skipped: silence you wrote must not look like a gap where
             * nothing has been placed. */
            rest: notes.length === 0,
            notes,
        });
    }
    if (chords.length === 0) return null;
    return {
        count: chords.length,
        grouping,
        sel: Number.isFinite(sel) ? sel : 1,
        playing: Number.isFinite(playing) ? playing : -1,
        clipUnits: Number.isFinite(clipUnits) ? clipUnits : 0,
        stepUnits,
        running,
        stepBeats, bpm, posUnits,
        mask, key: Number.isFinite(key) ? key : 0,
        chords,
    };
}

/* ------------------------------------------------------------ the scaling --
 *
 * THE GRID SCALES TO WHAT IS ACTUALLY THERE, and it is measured across EVERY
 * note of EVERY chord -- one grid for the whole progression, never one per
 * chord. Triads span about an octave; add a 9th, or drop one chord's root two
 * octaves, and the same band has to hold two and a half. Nothing here is a
 * fixed pitch range: move a root and the whole grid reflows to fit it.
 *
 * Two regimes, and the second is why a note can never fall off the grid:
 *
 *   STEPPED     the span fits at >= 2px per degree, so every scale note gets
 *               its own line and equal spacing.
 *   COMPRESSED  it does not fit, so degrees map linearly onto the pixels there
 *               are and only the tonic lines are drawn. Spacing stops being
 *               uniform, but every note is visible and correctly ordered --
 *               which beats a grid that silently clips its own top chord.
 */
function computeScale(prog, top, bottom) {
    const D = degreesFor(prog.mask, prog.key);
    let lo = Infinity, hi = -Infinity;
    for (const c of prog.chords) {
        if (c.rest) continue;      /* a rest has no pitch and must not scale the grid */
        for (const n of c.notes) {
            if (n < lo) lo = n;
            if (n > hi) hi = n;
        }
    }
    if (!Number.isFinite(lo)) return null;

    const loDeg = D.degree[lo], hiDeg = D.degree[hi];
    const span = Math.max(1, hiDeg - loDeg);
    const h = Math.max(4, bottom - top);
    const stepPx = Math.floor(h / (span + 1));

    if (stepPx >= 2) {
        const used = span * stepPx;
        const base = bottom - Math.floor((h - used) / 2);
        return {
            D, loDeg, hiDeg, stepPx, stepped: true,
            y: (n) => base - (D.degree[n] - loDeg) * stepPx,
        };
    }
    return {
        D, loDeg, hiDeg, stepPx: 1, stepped: false,
        y: (n) => bottom - Math.round(((D.degree[n] - loDeg) / span) * (h - 1)),
    };
}

/*
 * The lines. Every scale degree in range gets one, DOTTED, so a two-octave
 * grid at 2px spacing still reads as separate lines rather than as a solid
 * block of ink. The TONIC is solid, which is what keeps the octave legible
 * once the dots are dense -- and is the one thing the key selector changes
 * about the picture.
 */
function drawGrid(ctx, sc, prog, x0, x1, top, bottom) {
    const D = sc.D;

    /*
     * LANES ARE A RULER DOWN THE LEFT EDGE, NOT A FULL-WIDTH GRID.
     *
     * They used to be dotted right across the screen, one row per scale note.
     * On hardware that is fifteen dotted rows carrying as much ink as the music
     * does: the notes stop being figure and become another texture in the
     * field, and the picture reads as noise. Judged from a screenshot of the
     * real device, which is the only place the density is visible -- at ASCII
     * scale in a test it looks fine.
     *
     * So: every scale note gets a 2px TICK at the left margin, which is enough
     * to count lanes and to see the scale change when you change it, and only
     * the TONIC is drawn across, dotted, because that is the one line you read
     * position against. Everything else is the music.
     */
    for (let n = 0; n < 128; n++) {
        if (!D.inScale[n]) continue;
        const deg = D.degree[n];
        if (deg < sc.loDeg || deg > sc.hiDeg) continue;
        const y = sc.y(n);
        if (y < top || y > bottom) continue;
        const tonic = ((n - prog.key) % 12 + 12) % 12 === 0;
        if (tonic) {
            for (let x = x0; x < x1; x += 4) ctx.fillRect(x, y, 1, 1, 1);
        } else if (sc.stepped) {
            ctx.fillRect(x0, y, 2, 1, 1);
        }
    }
}

/* ===================================================================== *
 * THE TAKEOVER
 *
 * `grid` is a plain type:"canvas" param, so clicking it opens VIEWS.CANVAS --
 * a real full-screen view: the host clears the screen and `draw` owns all
 * 128x64, and dispatchCanvasMidi hands this overlay RAW MIDI, so the jog, the
 * jog click and the eight encoders are ours. Menu and Back exit.
 *
 * IT CANNOT BE THE as_page PAGE, and that is the whole reason this exists
 * separately. An as_page page is a knob page carrying a drawer, so the JOG
 * PAGES there -- it belongs to the page rotation and can never be a chord
 * cursor. The jog is only ours inside VIEWS.CANVAS.
 *
 * READS: `draw` and `tick` are handed a context with getParam and setParam
 * REMOVED (DRAW_PATH_HOOKS), which enforces the no-reads-on-the-draw-path rule
 * by construction. So the whole progression is pulled in `onOpen` and again
 * after each edit in `onMidi` -- both events, not frames -- and `draw` renders
 * from that cache. One read gets everything, because `prog` carries it all.
 * ===================================================================== */

const KNOB_CC_FIRST = 71;          /* CC 71..78 are the eight encoders */
const JOG_TURN_CC = 14;
/*
 * MUTE, NOT SHIFT, is the bank modifier -- and that is forced, not preferred.
 *
 * The shim only forwards a fixed set of CCs to the UI (14 jog, 3 click, 51
 * back, 40-43 tracks, 71-78 knobs, 88 mute, plus whatever the module has
 * CLAIMED). CC 49 is NOT among them outside overtake mode, so Shift never
 * arrives here at all and a Shift+jog gesture could never fire -- it looked
 * implemented and was unreachable.
 *
 * Mute is forwarded, and it is already this surface's modifier idiom:
 * Mute+JogClick bypasses a module, Mute+Track mutes a slot. Mute+Jog reads as
 * one of the family rather than as an invention.
 */
const MUTE_CC = 88;
const JOG_CLICK_CC = 3;            /* ours: module.json declares claims_jog_click */
/*
 * COPY and DELETE, claimed via capabilities.claims_edit_ccs: Copy duplicates
 * the selected chord, Delete removes it. Those buttons already mean exactly
 * that everywhere else on Move, so they need no explaining -- and the claim is
 * what keeps them from also copying or DELETING a Move clip behind the grid.
 *
 * The JOG CLICK is ours too, because the grid param declares
 * `claims_jog_click`. Without that the host steals CC 3 to close the canvas
 * before an overlay ever sees it, which is right for a viewer and wrong for an
 * editor you are meant to stay inside. With it, BACK is the only way out.
 */
const COPY_CC = 60;    /* duplicates the whole progression */
const DELETE_CC = 119;
const UNDO_CC = 56;    /* Undo, and Shift+Undo for redo */

/*
 * The write-access parameters -- things you DO. They have no range to walk, so
 * a turn means "fire" whichever way it goes, and it must fire ONCE however
 * long the turn lasts. Mirrors is_trigger_key() in the DSP.
 */
const TRIGGERS = {
    read: 1, stamp: 1, clear: 1, duplicate: 1, insert: 1, remove: 1,
    play: 1, roll_vel: 1, roll_time: 1, undo: 1, redo: 1, stretch: 1,
    compress: 1, degree: 1,
};
const TRIGGER_LATCH_MS = 450;

/*
 * LONG PRESS RESOLVES ON RELEASE, and that is forced rather than chosen.
 *
 * `tick` is a DRAW_PATH_HOOK, so the runtime hands it a context with
 * getParam/setParam removed -- it can SEE the threshold pass and draw that,
 * but it cannot act. `onMidi` is where setParam lives, and the next thing
 * onMidi hears is the release. So both the short and the long action fire when
 * the button comes up.
 *
 * The compensation is real: because tick can draw, the screen says what the
 * release will do while you are still holding, which beats firing blind at the
 * threshold with no way to change your mind.
 */
const LONG_PRESS_MS = 500;

/*
 * SAY WHAT A PAGE BUTTON DID.
 *
 * The arrows and the pads are silent hardware: nothing about pressing Up tells
 * you which set of rows you landed on, and the LEDs alone cannot -- eight lit
 * pads look the same whether they are degrees or rhythms. So every movement
 * that changes what a control MEANS puts a line on the staff: what moved, and
 * where it now is.
 *
 * Transient, because it is an answer to something you just did rather than a
 * state you need to keep reading, and centred over the staff so it cannot be
 * missed. It is not modal -- it never takes a press to dismiss.
 */
const TOAST_MS = 1400;

/* ===================================================================== *
 * A 3-PIXEL FONT, because the device's own is 6px wide.
 *
 * Eight cells across 128px is 16px each. The host's print() advances ~6px per
 * character, so a cell holds TWO -- and eight two-letter labels is not a row
 * anyone can read; on hardware they simply ran into each other
 * ("ChrRbdictFamSha..."). At 4px advance the same cell holds four, which is
 * the difference between "Chrd Root Oct Fam" and mush.
 *
 * Ported from src/shared/param_pages/font5x3.mjs (schwung-movy's condensed
 * 5x3, MIT) rather than re-derived, so the glyphs match what the knob grid's
 * enum squares already draw. Copied rather than imported: an overlay is loaded
 * standalone and has no module resolver.
 *
 * Encoding: one number per row, bit0 = leftmost pixel.
 * ===================================================================== */
const F3 = {
    ' ':[],
    '-':[0,0,7,0,0],
    '.':[0,0,0,3,3],
    '/':[4,4,2,1,1],
    ':':[3,3,0,3,3],
    '0':[7,5,5,5,7],
    '1':[3,2,2,2,2],
    '2':[7,4,7,1,7],
    '3':[7,4,6,4,7],
    '4':[5,5,7,4,4],
    '5':[7,1,7,4,7],
    '6':[7,1,7,5,7],
    '7':[7,4,4,4,4],
    '8':[7,5,7,5,7],
    '9':[7,5,7,4,7],
    'A':[2,7,5,5,5],
    'B':[7,5,3,5,7],
    'C':[7,1,1,1,7],
    'D':[3,5,5,5,3],
    'E':[7,1,3,1,7],
    'F':[7,1,3,1,1],
    'G':[7,1,5,5,7],
    'H':[5,5,7,5,5],
    'I':[7,2,2,2,7],
    'J':[4,4,4,5,7],
    'K':[5,5,3,5,5],
    'L':[1,1,1,1,7],
    'M':[5,7,5,5,5],
    'N':[5,3,5,5,5],
    'O':[7,5,5,5,7],
    'P':[7,5,7,1,1],
    'Q':[3,5,5,7,2],
    'R':[7,5,3,5,5],
    'S':[6,1,2,4,3],
    'T':[7,2,2,2,2],
    'U':[5,5,5,5,7],
    'V':[5,5,5,5,2],
    'W':[5,5,5,7,7],
    'X':[5,5,2,5,5],
    'Y':[5,5,7,2,2],
    'Z':[7,4,2,1,7],
    '+':[0,2,7,2,0],
};
const F3_W = 4;      /* advance, including the 1px gap */
const F3_H = 5;

function tinyWidth(t) { return String(t).length * F3_W; }

/* Uppercased on the way in: the font has no lowercase, and a missing glyph
 * would silently swallow the character rather than draw something wrong. */
function tinyPrint(ctx, x, y, text) {
    const t = String(text).toUpperCase();
    for (let i = 0; i < t.length; i++) {
        const g = F3[t[i]];
        if (!g) continue;
        for (let r = 0; r < g.length; r++) {
            const bits = g[r];
            for (let b = 0; b < 3; b++) {
                if (bits & (1 << b)) ctx.fillRect(x + i * F3_W + b, y + r, 1, 1, 1);
            }
        }
    }
}

/* ===================================================================== *
 * BANKS OF EIGHT
 *
 * Chord banks first, global banks last, switched with SHIFT + JOG -- the only
 * free two-handed gesture once the jog selects chords, the click plays them
 * and Copy/Delete edit the progression.
 *
 * `label` is what a knob shows when nobody is touching it; the VALUE replaces
 * it while a finger is on that knob. Eight cells across 128px is 16px each --
 * four characters -- so the row can show eight MEANINGS or eight VALUES but
 * never both, and which one you want depends entirely on whether your hand is
 * on the control. Labels are capped at four characters by design.
 * ===================================================================== */
/* ---- BEGIN GENERATED ranges (tools/stacks/gen_chain_params.py) ---- */
const PARAM_RANGES = {"sel":[1,16],"root":["C1","C#1","D1","D#1","E1","F1","F#1","G1","G#1","A1","A#1","B1","C2","C#2","D2","D#2","E2","F2","F#2","G2","G#2","A2","A#2","B2","C3","C#3","D3","D#3","E3","F3","F#3","G3","G#3","A3","A#3","B3","C4","C#4","D4","D#4","E4","F4","F#4","G4","G#4","A4","A#4","B4","C5","C#5","D5","D#5","E5","F5","F#5","G5","G#5","A5","A#5","B5"],"degree":["I","II","III","IV","V","VI","VII","rest"],"coct":[1,5],"family":["5th","triad","6th","7th","9th","ext"],"shape":["rest","note","5","oct","maj","min","dim","aug","sus2","sus4","6","m6","69","maj7","min7","dom7","m7b5","dim7","mMaj7","7sus4","7sus2","aug7","maj7#5","7b5","add9","madd9","maj9","min9","9","7b9","7#9","m9b5","11","m11","maj11","13","maj13","m13"],"inv":[-3,3],"len":[1,64],"off":[0,15],"ccolour":["close","open","drop2","drop3","drop2+4","shell","rootless","quartal","spread","cluster"],"cstrum":[0,100],"cvel":[-63,63],"cgate":[-50,50],"cmute":["off","on"],"rhythm":["hold","half","quarter","eighth","16th","offbeat","dotted","push","tresillo","son 3-2","son 2-3","rumba","bossa","baiao","montuno","charl","charl 2","shuffle","comp","gallop","drive","anthem","garage","broken"],"ctrans":[-12,12],"genre":["none","Pop","Rock","Metal","Jazz","Blues","Soul","Gospel","Funk","R&B","Bossa","Latin","House","Reggae","Country","Cinematic"],"progression":["none","Axis","Sad Axis","Doo-wop","Pachelbel","Royal Road","Emotional","I-IV-V","Mixolydian","Grunge","Anthem","Thrash","Power Metal","Doom","Phrygian","ii-V-I","Minor ii-V","Rhythm A","Turnaround","Coltrane","Tritone","Bird Blues","Modal","12-bar","Quick IV","Minor blues","8-bar","Neo-soul","Montuno","iii-vi-ii-V","Slow jam","Plagal","Shouting","Walk-up","Amen","JB vamp","Funk turn","P-Funk","Clav","Two-chord","Minor lift","Quiet storm","Ipanema","Wave","Desafinado","Corcovado","Guajira","Bolero","Salsa","Deep vamp","Two-bar","Filter","Garage","Skank","Roots minor","Rockers","Boot scoot","Train","Andalusian","Aeolian","Dorian","Picardy","Ostinato","Lament"],"common":["none","I-V-vi-IV","vi-IV-I-V","I-vi-IV-V","I-IV-V","I-IV-I-V","ii-V-I","I-V-IV","I-iii-IV-V","vi-V-IV-V","i-VI-III-VII","i-iv-v","i-VII-VI-VII"],"uncommon":["none","I-bIII-IV-iv","Phrygian","Lydian II","Backdoor","bVI-bVII-I","i-v-bVI-bVII","Chrom desc","Borrowed IV","Secondary V","i-bVI-iv-V","Double plagal","Aug lift","Tritone col"],"colour":["close","open","drop2","drop3","drop2+4","shell","rootless","quartal","spread","cluster"],"grouping":["none","dynamic","dyn +1oct","dyn +2oct","C1-B2","C2-B3","C3-B4","open 1","open 2","open 3","guitar","drop 2","drop 3","drop 4","drop 2+3","drop 2+4"],"scale":["Chromatic","Major","Minor","Dorian","Phrygian","Lydian","Mixolydian","Locrian","HarmMinor","MelMinor","PentMaj","PentMin","Blues"],"key":["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"],"steps":[1,16],"rate":["2 bar","1 bar","1/2","1/4"],"run":["off","on"],"octave":[-2,2],"velocity":[1,127],"gate":[5,100],"hum_vel":[0,100],"roll_vel":["off","on"],"hum_time":[0,100],"roll_time":["off","on"],"swing":[0,75],"lanes":["scale","diatonic"],"preview":["off","chord","loop"],"read":["off","on"],"read_mode":["replace","append"],"defoct":[1,5],"bars":[1,16],"stamp":["off","on"],"stamp_mode":["rec arm","write file"],"clear":["off","on"],"play":["off","on"],"duplicate":["off","on"],"stretch":["off","on"],"compress":["off","on"],"undo":["off","on"],"redo":["off","on"],"insert":["off","on"],"remove":["off","on"]};
/* ---- END GENERATED ranges ---- */

const BANKS = [
/*
 * THE BANKS ARE THE LEVELS. Same names, same knobs, same order, so a group
 * holds the same eight controls whether you reach it by paging the knob grid
 * or by Mute+Jog in here.
 *
 * They had drifted -- VOICE carried a duplicate of the chord Velocity, HARMONY
 * mixed three different pages together, FEEL was missing Octave -- and drift
 * here is worse than in most places: the whole value of two surfaces onto one
 * module is that what you learn on either transfers. Two layouts for the same
 * parameters is just two things to learn.
 *
 * SETUP is `root` minus two keys that are GESTURES in this view: `grid` is the
 * door you came through, and `sel` is the jog. Nothing else differs.
 *
 * THE ORDER IS THE PAGE ORDER TOO, not only the contents. Matching the keys
 * but not their sequence still leaves two things to learn -- "third bank" and
 * "third page" have to mean the same group or the harmonisation is cosmetic.
 * The view still OPENS on CHORD rather than on the first bank, because that is
 * the one you came in to use; where you land is a separate question from what
 * order they sit in.
 *
 * tests/host/test_stacks_shapes.sh compares this table against module.json's
 * ui_hierarchy and fails on any divergence, because a comment asking for them
 * to be kept in step is exactly what let them drift the first time.
 */
    { name: "MAIN", keys: [["scale","SCL","Scale"], ["key","KEY","Key"], ["defoct","DOC","Octave Default"], ["steps","CHD","Chords"], ["rate","RTE","New Chord Len"], ["bars","BAR","Clip Bars"], ["grouping","GRP","Voice Grouping"], [null,"",""]] },
    { name: "START", keys: [["genre","GEN","Genre"], ["progression","PRG","Progression"], ["common","CMN","Common Prog"], ["uncommon","UNC","Uncommon"], ["colour","COL","Colour"], [null,"",""], [null,"",""], [null,"",""]] },
    { name: "CHORD", keys: [["root","RT","Root"], ["coct","OCT","Chord Oct"], ["family","FAM","Shape Family"], ["shape","SHP","Chord Shape"], ["inv","INV","Inversion"], ["len","LEN","Length"], ["off","OFF","Offset"], ["cvel","VEL","Chord Vel"]] },
    { name: "VOICE", keys: [["ccolour","COL","Colour"], ["cstrum","STR","Strum"], ["cgate","GAT","Chord Gate"], ["cmute","MUT","Mute"], ["rhythm","RHY","Rhythm"], ["ctrans","TRN","Transpose"], [null,"",""], [null,"",""]] },
    { name: "FEEL", keys: [["octave","OCT","Octave"], ["velocity","VEL","Velocity"], ["gate","GAT","Gate"], ["swing","SWG","Swing"], ["hum_vel","HVL","Human Vel"], ["roll_vel","RVL","Randomize Vel"], ["hum_time","HTM","Human Time"], ["roll_time","RTM","Randomize Time"]] },
    { name: "CLIP", keys: [["read","RD","Read Clip"], ["read_mode","RDM","Read Mode"], ["stamp","ST","Stamp Clip"], ["stamp_mode","STM","Stamp Mode"], ["clear","CLR","Clear"], ["lanes","LAN","Note Lanes"], ["preview","PRV","Preview"], ["run","RUN","Run"]] },
];

/* Values shortened to fit 16px. A truncation that reads beats a word that
 * overlaps its neighbour; the full word is on the knob page. */
const VALUE_SHORT = {
    close:"cls", open:"opn", drop2:"dr2", drop3:"dr3",
    chromatic:"chr", major:"maj", minor:"min", dorian:"dor", phrygian:"phr",
    lydian:"lyd", mixolydian:"mix", locrian:"loc", harmminor:"hmi",
    melminor:"mmi", pentmaj:"pMa", pentmin:"pMi", blues:"blu",
    diatonic:"dia", scale:"scl", chord:"chd", loop:"lp",
    replace:"rep", append:"app", "rec arm":"rec", "write file":"fil",
};
function shortValue(v) {
    if (v === null || v === undefined || v === "") return "-";
    const t = String(v);
    const k = VALUE_SHORT[t.toLowerCase()];
    if (k) return k;
    return t.length <= 4 ? t : t.slice(0, 4);
}

/* ===================================================================== *
 * KNOB LEDS
 *
 * THE RINGS ARE THE ONLY THING SAYING WHICH ENCODER DRIVES WHICH CELL. The row
 * is eight knobs; the drawn grid is 4x2. So knobs 1-4 are white and 5-8 amber,
 * value rides on top as intensity, and colour 0 means NOTHING IS BOUND HERE --
 * a dark ring is one that will do nothing if you turn it.
 *
 * The takeover has to drive them itself. `tickParamPages` owns the rings on the
 * knob pages, and diving in here calls `exitParamPages`, which deliberately
 * HANDS THEM BACK to Move (`shadow_restore_knob_leds`) rather than clearing
 * them -- so without this an overlay inherits Move's own track colours, and a
 * bank with empty slots shows lit, even red, rings over knobs that do nothing.
 *
 * Ramps copied from param_pages/knob_leds.mjs, which cannot be imported here
 * (an overlay is loaded standalone, with no module resolver). Ordered by
 * LUMINANCE, not by name -- that file records a version picked by name whose
 * third step was darker than its second, so a swept knob went dim, bright,
 * dark, bright.
 *
 *   white  #141414  #404040  #595959  #CCCCCC  #FFFFFF
 *   amber  #200D00  #5D1700  #AC1F00  #C93C00
 * ===================================================================== */
const LED_WHITE = [124, 123, 118, 122, 120];
const LED_AMBER = [70, 69, 4, 3];
const LED_CC0 = 71;                 /* CC 71-78, the same CCs the encoders send */

/* ------------------------------------------------------------------ pads --
 * THE BOTTOM ROW IS THE PROGRESSION.
 *
 * Notes 68-99 are four rows of eight, numbered BOTTOM-LEFT to top-right, so
 * 68-75 is the row your hands rest on and chord 1 sits under your left thumb
 * -- the same direction the staff reads and the same convention as Move's own
 * drum racks.
 *
 * The pads only reach us while `host_pad_block` is on, which also stops them
 * reaching Move. That is a GLOBAL switch, so it is tied strictly to onOpen /
 * onClose: leave it set and every other module loses its pads to us.
 */
const PAD_ROW1 = 68;                /* bottom-left pad */
const PAD_ROW_LEN = 8;
const ARROW_LEFT = 62, ARROW_RIGHT = 63, ARROW_UP = 55, ARROW_DOWN = 54;

/*
 * ROWS 2-4 EDIT THE CHORD THE BOTTOM ROW SELECTED.
 *
 * One parameter per row, so a row is eight values of one thing and the hand
 * learns a place rather than a sequence. Up/Down page the SET of three; the
 * bottom row never moves, so there is always one row you can reach without
 * first asking which page the surface is on.
 *
 * `opts` are the option strings the module answers with, so a pad writes the
 * VALUE rather than an index -- the same names the knob and the status row
 * use, and nothing here has to know the enum's order. `null` marks a pad with
 * nothing on it, which is drawn dark and does nothing.
 */
const PAD_PAGES = [
    { name: "WRITE", rows: [
        { key: "degree", label: "DEG", opts: ["I","II","III","IV","V","VI","VII","rest"] },
        { key: "len",    label: "LEN", opts: ["2","4","8","12","16","24","32","64"] },
        { key: "family", label: "QUAL", opts: ["5th","triad","6th","7th","9th","ext",null,null] },
    ]},
    { name: "VOICE", rows: [
        { key: "inv",     label: "INV", opts: ["-3","-2","-1","0","1","2","3",null] },
        { key: "ccolour", label: "COL", opts: ["close","open","drop2","drop3","drop2+4",
                                 "shell","rootless","quartal","spread","cluster"] },
        { key: "coct",    label: "OCT", opts: ["1","2","3","4","5",null,null,null] },
    ]},
    { name: "FEEL", rows: [
        { key: "rhythm", label: "RHY", opts: ["hold","half","quarter","eighth","16th","offbeat",
                                "dotted","push","tresillo","son 3-2","son 2-3",
                                "rumba","bossa","baiao","montuno","charl",
                                "charl 2","shuffle","comp","gallop","drive",
                                "anthem","garage","broken"] },
        { key: "cgate",  label: "GATE", opts: ["-50","-30","-15","0","15","30","40","50"] },
        { key: "cstrum", label: "STRUM", opts: ["0","10","20","35","50","65","80","100"] },
    ]},
];

/* Row 2 is notes 76-83, row 3 84-91, row 4 92-99 -- upward from the chords. */
const PAD_ROW_BASE = [68, 76, 84, 92];
const lastParamPad = [new Array(8).fill(-1), new Array(8).fill(-1),
                      new Array(8).fill(-1)];

/*
 * What a pad says, brightest first. A slot with no chord is dim rather than
 * dark: the row must show how long the progression is, or you cannot tell
 * "chord 5 is a rest" from "there is no chord 5".
 */
const PAD_PLAYING  = 122;   /* the chord sounding now */
const PAD_SELECTED = 3;     /* the one the banks are editing */
const PAD_WRITTEN  = 69;    /* a chord you have written */
const PAD_REST     = 70;    /* an empty slot inside the progression */
const PAD_OFF      = 0;     /* past the end -- nothing there */

/*
 * ONE HUE PER PARAMETER ROW, AND THE CHORD ROW KEEPS ITS OWN.
 *
 * Three rows in the same orange were unreadable: eight lit pads look the same
 * whether they are degrees or lengths, so the hand had to remember which row
 * was which and the LEDs added nothing the screen had not already said.
 *
 * The bottom row is deliberately EXCLUDED from this. It is the one row that
 * never changes meaning, so its colour must never change either -- that
 * constancy is what makes it the row you can reach without looking. Only the
 * rows above are recoloured, and they are recoloured BY POSITION rather than
 * by which parameter is on them, so the second row is always green whatever
 * page you are on. The hue tells you WHERE you are; the message on screen
 * tells you WHAT is there.
 *
 * Each entry is [on, off] -- the palette's own bright/dim pair for one hue, so
 * a row reads as one colour at two intensities rather than as two colours.
 */
const PAD_ROW_HUE = [
    null,            /* row 1: the chords, which keep the colours above */
    [11,  85],       /* row 2: neon green */
    [17,  97],       /* row 3: royal blue */
    [21, 105],       /* row 4: hot magenta */
];

const lastPad = new Array(PAD_ROW_LEN).fill(-1);
const lastLed = new Array(8).fill(-1);

/* 0..1 for a value, or null when there is nothing to show. PARAM_RANGES is
 * generated from module.json, so a range here cannot drift from the contract. */
function normalizedOf(key, raw) {
    if (raw === null || raw === undefined || raw === "") return null;
    const r = PARAM_RANGES[key];
    if (!r) return null;
    if (Array.isArray(r) && typeof r[0] === "string") {
        const i = r.indexOf(String(raw));
        return i < 0 ? null : (r.length < 2 ? 1 : i / (r.length - 1));
    }
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return null;
    const [lo, hi] = r;
    return hi === lo ? 1 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
}

function ledColor(k, nv) {
    if (nv === null) return 0;      /* unbound or unread: dark, never a guess */
    const ramp = k < 4 ? LED_WHITE : LED_AMBER;
    return ramp[Math.min(ramp.length - 1, Math.floor(nv * ramp.length))];
}

/* Emits only what changed -- eight sends a frame would be most of the
 * 128-packet flush budget. */
/*
 * THE PAD ROW MIRRORS THE STAFF.
 *
 * Same four facts the blocks already carry -- past the end, an empty slot, a
 * written chord, the selected one -- plus the chord that is SOUNDING, which is
 * the one thing the pads can show better than the screen: you can see it from
 * across the room.
 *
 * Diffed like the knob rings, so a still progression costs no MIDI at all.
 */
function updatePadLeds() {
    if (typeof move_midi_internal_send !== "function") return;
    const p = S.prog;
    for (let i = 0; i < PAD_ROW_LEN; i++) {
        const idx = S.padPage * PAD_ROW_LEN + i;
        let c = PAD_OFF;
        if (p && idx < p.count) {
            const ch = p.chords[idx];
            c = ch && ch.rest ? PAD_REST : PAD_WRITTEN;
            if (idx === p.playing) c = PAD_PLAYING;
            else if (idx === S.cursor) c = PAD_SELECTED;
        }
        if (lastPad[i] === c) continue;
        lastPad[i] = c;
        move_midi_internal_send([0x09, 0x90, PAD_ROW1 + i, c]);
    }
}

/*
 * A PARAMETER ROW LIGHTS THE VALUE THE SELECTED CHORD IS ON.
 *
 * Bright where the chord sits, dim on the other reachable values, dark where
 * there is no value at all -- so a glance says both "what is this chord" and
 * "what else could it be". Compared against the same S.vals the top row reads,
 * so it costs no extra IPC.
 */
/* How many degrees the current scale actually has -- the mask the module
 * publishes, counted. `rest` is always available, so it is not a degree. */
function degreeCount() {
    let m = (S.prog && S.prog.mask) | 0, n = 0;
    while (m) { n += m & 1; m >>>= 1; }
    return n || 7;
}

function updateParamPadLeds() {
    if (typeof move_midi_internal_send !== "function") return;
    const rows = (PAD_PAGES[S.parmPage] || {}).rows || [];
    for (let r = 0; r < 3; r++) {
        const spec = rows[r];
        const cur = spec ? S.vals[spec.key] : null;
        for (let col = 0; col < PAD_ROW_LEN; col++) {
            let c = PAD_OFF;
            if (spec) {
                const v = spec.opts[S.rowScroll[r] + col];
                /*
                 * A DEGREE THAT THE SCALE DOES NOT HAVE IS DARK.
                 *
                 * Pentatonic has five, blues six. Lighting seven would offer
                 * two pads that do nothing -- the module simply finds no such
                 * degree and leaves the root alone -- so the row would lie
                 * about what is reachable. Dark instead, which also makes the
                 * pad grid show the shape of the scale you are in.
                 */
                const ok = (spec.key !== "degree")
                        || (S.rowScroll[r] + col) < degreeCount();
                const hue = PAD_ROW_HUE[r + 1];
                if (v !== null && v !== undefined && ok)
                    c = (String(v) === String(cur)) ? hue[0] : hue[1];
            }
            if (lastParamPad[r][col] === c) continue;
            lastParamPad[r][col] = c;
            move_midi_internal_send([0x09, 0x90, PAD_ROW_BASE[r + 1] + col, c]);
        }
    }
}

function updateLeds() {
    if (typeof move_midi_internal_send !== "function") return;
    const keys = bank().keys;
    for (let k = 0; k < 8; k++) {
        const key = (keys[k] || [])[0];
        const c = key ? ledColor(k, normalizedOf(key, S.vals[key])) : 0;
        if (lastLed[k] === c) continue;
        lastLed[k] = c;
        move_midi_internal_send([0x0b, 0xB0, LED_CC0 + k, c]);
    }
}

const CHORD_BANK = (() => {
    for (let i = 0; i < BANKS.length; i++) if (BANKS[i].name === "CHORD") return i;
    return 0;
})();

const S = {
    prog: null,
    cursor: 0,
    shift: false,    /* Mute held -- the bank modifier */
    /*
     * Opens on CHORD -- the bank you came in to use. BY NAME, not by index:
     * it was 1, and inserting START as the second bank silently moved the
     * landing to a different bank. An index into a reorderable list is a
     * dependency nobody remembers they have.
     */
    bank: 0,
    touched: -1,     /* knob slot under a finger, or -1 */
    padPage: 0,      /* which eight chords the bottom row is showing */
    parmPage: 0,     /* which set of three parameter rows is up */
    rowScroll: [0, 0, 0],   /* how far each row is scrolled into a long list */
    toast: "",       /* what the last page movement did */
    toastAt: 0,
    trigKnob: -1,    /* knob whose trigger already fired this gesture */
    trigAt: 0,       /* when it fired, for the latch */
    holdCC: -1,      /* an edit button being held, for the long press */
    holdAt: 0,       /* when it went down */
    holdLong: false, /* has it passed the threshold -- set by tick, drawn by draw */
    vals: {},        /* values for the current bank, refreshed on events only */
    bankAt: 0,       /* when the bank last changed, for the transient title */
    xport: false,    /* transport running, from the overlay SHM */
    bpm: 120,
    anchorMs: 0,     /* wall clock at the transport's start edge */
    pollN: 0,
    /*
     * The jog is held. Tracked here rather than read back, because it is the
     * live fact: the module's `running` comes from the last `prog` read, and
     * between press and release there are no reads to refresh it.
     */
    holding: false,
};

/* How long the bank name replaces the labels after a switch. Long enough to
 * read while your hand is still on the jog, short enough that it is gone
 * before you reach for a knob. */
const BANK_TITLE_MS = 900;

/* Move sends relative CCs two's-complement in 7 bits: 1..63 up, 65..127 down. */
function delta(v) { return v < 64 ? v : v - 128; }

/*
 * SHIFT IS ASKED FOR, NOT LISTENED FOR.
 *
 * CC 49 never arrives: the shim forwards a fixed set of CCs to the UI (14, 3,
 * 51, 40-43, 71-78, 88, plus claimed ones) and Shift is not among them outside
 * overtake mode. So a `d1 === 49` branch here is unreachable code that looks
 * implemented -- which is exactly how Shift+Jog came to silently do nothing.
 *
 * The shim tracks Shift itself and publishes it in shadow_control; the host
 * exposes that as a global binding, and an overlay is evaluated in the same
 * QuickJS context as shadow_ui, so it can simply ASK at the moment of the
 * turn. Reading state beats waiting for an event that is not sent.
 *
 * Guarded by typeof and try/catch: an older host may not have the binding, and
 * a missing modifier must degrade to "no bank change", never to a throw --
 * a throw here retires the whole overlay for the session.
 */
function shiftHeld() {
    try {
        return typeof shadow_get_shift_held === "function"
            && shadow_get_shift_held() !== 0;
    } catch (e) {
        return false;
    }
}

function bank() { return BANKS[S.bank] || BANKS[0]; }

function refresh(ctx) {
    if (!ctx || typeof ctx.getParam !== "function") return;
    const raw = ctx.getParam("prog");
    /* A READ THAT DID NOT ANSWER MUST NOT BECOME A PICTURE. null means the
     * read did not complete -- keep the last good progression rather than
     * blanking the grid or inventing an empty one. */
    if (raw !== null && raw !== undefined) {
        const parsed = parseProg(raw);
        if (parsed) {
            /*
             * EVERY READ IS A RE-SYNC. The module reports where it actually
             * is, so the playhead's anchor is recomputed from that rather than
             * only from the transport's start edge -- which is what makes
             * entering mid-loop work, and stops wall-clock drift accumulating.
             */
            if (parsed.bpm > 20 && parsed.bpm < 300) S.bpm = parsed.bpm;
            const upb = (parsed.stepUnits || 8) / (parsed.stepBeats || 4);
            const secs = parsed.posUnits / (upb * (S.bpm / 60));
            S.anchorMs = (typeof ctx.now === "function" ? ctx.now() : Date.now())
                       - secs * 1000;
            S.prog = parsed;
            if (S.cursor > parsed.count - 1) S.cursor = parsed.count - 1;
            if (S.cursor < 0) S.cursor = 0;
        }
    }
}

/* The current bank's values. Read on events (bank change, turn, touch) and
 * never on the draw path -- one read is ~2.8ms against a 1.68ms whole render. */
function refreshBank(ctx) {
    if (!ctx || typeof ctx.getParam !== "function") return;
    S.vals = {};
    const want = new Set();
    for (const [key] of bank().keys) if (key) want.add(key);
    /* The pad rows show values too, and their keys are usually NOT on the
     * current bank -- Degree and Length are not on MAIN. Reading them here
     * keeps the pads on the same refresh as the knobs, so they cost no extra
     * IPC and can never disagree about what the selected chord is. */
    for (const row of (PAD_PAGES[S.parmPage] || {}).rows || []) want.add(row.key);
    for (const key of want) {
        const v = ctx.getParam(key);
        if (v !== null && v !== undefined) S.vals[key] = v;
    }
    updateLeds();
}

function atCursor() {
    if (!S.prog || S.cursor >= S.prog.count) return null;
    return S.prog.chords[S.cursor];
}

/* ------------------------------------------------------------- top row -- */
const CELL_W = 16;   /* 128 / 8 */

function drawTopRow(ctx, nowMs) {
    const b = bank();

    /*
     * THE BANK NAME IS TRANSIENT, NOT A RESERVED CELL. Parking it in a spare
     * slot only worked for banks that HAD one -- and those are exactly the
     * banks you are least likely to recognise from their labels.
     */
    if (nowMs - S.bankAt < BANK_TITLE_MS) {
        tinyPrint(ctx, 1, 0, `${b.name}  ${S.bank + 1}/${BANKS.length}`);
        ctx.fillRect(0, F3_H + 1, ctx.width, 1, 1);
        return;
    }

    /*
     * A TOUCHED KNOB TAKES THE WHOLE ROW.
     *
     * Eight cells is 16px each -- three glyphs -- which is enough to LABEL a
     * control and nowhere near enough to show its value: "montuno", "son 3-2",
     * "Andalusian" and "write file" all truncate to noise. The other seven
     * labels are not needed while a finger is on one knob, so the row becomes
     * a status line for that one: full name, full value, room to spare.
     *
     * This is also what makes 24 rhythms and 25 progressions usable at all --
     * a browser you cannot read the entries of is not a browser.
     */
    if (S.touched >= 0) {
        const [key, , full] = b.keys[S.touched] || [];
        if (key) {
            const name = String(full || key).toUpperCase();
            const val = S.vals[key];
            tinyPrint(ctx, 0, 0, name);
            const vx = tinyWidth(name) + F3_W * 2;
            tinyPrint(ctx, Math.min(vx, ctx.width - 1), 0,
                      val === undefined || val === null || val === "" ? "-" : String(val));
            ctx.fillRect(0, F3_H + 1, ctx.width, 1, 1);
            return;
        }
    }

    for (let i = 0; i < 8; i++) {
        const [key, label] = b.keys[i] || [null, ""];
        if (!key) continue;
        const x = i * CELL_W;
        /*
         * THREE GLYPHS, HARD, AND CENTRED. The advance is 4px and a cell is
         * 16px, so four characters fill it exactly and the label touches its
         * neighbour -- on hardware "ROOT" and "OCT" read as ROOTOCT. Three
         * leaves 4px of clear space inside every cell, which is the only thing
         * that actually separates them.
         */
        const txt = String(label).slice(0, 3);
        const inked = Math.max(0, txt.length * F3_W - 1);
        tinyPrint(ctx, x + Math.max(0, Math.floor((CELL_W - inked) / 2)), 0, txt);
    }
}

/*
 * AN EMPTY BUFFER HAS TO SAY WHAT TO DO WITH IT.
 *
 * After Clear the grid is a row of framed empty slots, which correctly shows
 * that the time is there and nothing is in it -- and gives no clue how to put
 * something in it. Copy is the obvious guess and the wrong one: it duplicates
 * the progression, so on a buffer of rests it makes more rests.
 *
 * Drawn only while EVERY chord is a rest: an empty state is the one moment the
 * instruction is worth screen space, and the moment a single chord exists it
 * would be clutter over the music.
 */
function drawEmptyHint(ctx, prog, H) {
    for (const c of prog.chords) if (!c.rest) return;

    /*
     * TWO LINES, AND THE SECOND ONE IS THE POINT.
     *
     * While every slot is a rest, CHD and BAR divide the clip between them --
     * four chords over eight bars gives four two-bar slots. That is useful and
     * completely invisible, so the hint says what the division came out as.
     * It appears ONLY in the state it describes, which is what lets it be a
     * hint rather than a modal: writing a chord ends both the derivation and
     * the message, and nothing has to be dismissed.
     */
    const u = prog.stepUnits || 8;
    const bars = prog.chords.length ? (prog.chords[0].len || 1) / u : 1;
    const nice = Number.isInteger(bars) ? String(bars)
               : String(Math.round(bars * 100) / 100);
    const lines = ["TURN SHP OR FAM TO FILL A SLOT",
                   `${prog.chords.length} SLOTS X ${nice} BAR` +
                   (bars === 1 ? "" : "S")];
    const w = Math.max(...lines.map((m) => m.length)) * F3_W;
    const x = Math.max(0, Math.floor((ctx.width - w) / 2));
    const y = Math.floor(H / 2) - 2 - F3_H;
    ctx.fillRect(x - 3, y - 2, w + 5, (F3_H + 2) * lines.length + 3, 0);
    for (let i = 0; i < lines.length; i++) {
        const lx = Math.max(0, Math.floor((ctx.width - lines[i].length * F3_W) / 2));
        tinyPrint(ctx, lx, y + i * (F3_H + 2), lines[i]);
    }
}

/* ===================================================================== *
 * THE PLAYHEAD
 *
 * Drawn WITHOUT a read per frame, which is the only reason it can exist here:
 * `draw` and `tick` are handed a context with getParam removed, and an IPC
 * read is ~2.8 ms against a 1.68 ms whole-screen render.
 *
 * So it is extrapolated from three cheap facts. `shadow_get_overlay_state()`
 * is a SHM read and carries `transportPlaying` and the tempo; the module tells
 * us how long one of its steps is in beats; and the clock is anchored on the
 * EDGE where the transport starts, which is exactly the moment the module
 * itself zeroes its pulse on MIDI Start. From there it is arithmetic.
 *
 * TWO HONEST LIMITS, both visible rather than hidden:
 *   - Entering while the transport is already running has no anchor, so the
 *     head is placed at the start of the chord the module last reported and
 *     runs from there. It is right within a chord, not to the millisecond.
 *   - A tempo change mid-loop is not seen until the next start. The alternative
 *     is polling, and polling is the thing this design exists to avoid.
 *
 * When the transport stops the head disappears rather than freezing: a
 * stationary head and a stopped transport look identical, and one of them is
 * a lie.
 * ===================================================================== */
const XPORT_POLL_TICKS = 4;      /* SHM, but it allocates a JS object */

function pollTransport(nowMs) {
    if (S.pollN++ % XPORT_POLL_TICKS) return;
    if (typeof shadow_get_overlay_state !== "function") return;
    let st;
    try { st = shadow_get_overlay_state(); } catch (e) { return; }
    if (!st) return;
    const playing = !!st.transportPlaying;
    /*
     * The tempo comes from the MODULE (prog), not from samplerBpm: that field
     * is only populated once the sampler has run, so trusting it made the very
     * first play sweep at the 120 fallback and every later one correct.
     * Shared memory is still where the transport flag comes from -- it is the
     * only live source for it.
     */
    if (playing && !S.xport) S.anchorMs = nowMs;    /* the start edge: pos 0 */
    S.xport = playing;
}

/*
 * Position in units, or null when there is nothing to draw.
 *
 * Gated on the LIVE transport only. It also tested `prog.running`, which comes
 * from the last `prog` read and is therefore refreshed on interaction -- so
 * pressing Play and simply watching the screen left the head hidden, because
 * the module's own "am I running" answer was still the stale one from before
 * you pressed it. The transport flag is read from shared memory every few
 * ticks and needs no such excuse.
 */
function playheadUnits(prog, nowMs) {
    /* The transport OR a held jog: the module runs the same sequence either
     * way, so the head belongs on screen for both. */
    if ((!S.xport && !S.holding) || !S.anchorMs) return null;
    const clip = Math.max(1, prog.clipUnits || 1);
    const unitsPerBeat = (prog.stepUnits || 8) / (prog.stepBeats || 4);
    const u = ((nowMs - S.anchorMs) / 1000) * (S.bpm / 60) * unitsPerBeat;
    return ((u % clip) + clip) % clip;
}

function drawPlayhead(ctx, prog, top, bottom, nowMs) {
    const u = playheadUnits(prog, nowMs);
    if (u === null) return;
    const x = Math.round((u / Math.max(1, prog.clipUnits || 1)) * ctx.width);
    /* Solid, one pixel, and drawn LAST so it reads over the blocks rather
     * than under them -- a playhead behind the music is a playhead you lose
     * exactly where the music is. */
    ctx.fillRect(Math.min(x, ctx.width - 1), top, 1, bottom - top + 1, 1);
}

/*
 * IS THIS MODULE MAKING THE SOUND?
 *
 * After a Stamp the clip holds the same notes Stacks is still generating, so
 * "am I hearing the module or the clip" becomes a real question with no way to
 * answer it by ear. A filled triangle means Stacks is generating.
 *
 * IT UPDATES ON INTERACTION, NOT LIVE, and that is a hard limit rather than a
 * shortcut: the host strips getParam from `draw` AND from `tick` (both are
 * DRAW_PATH_HOOKS), so nothing here can read a value per frame.
 */
function drawRunMark(ctx, prog, W, y) {
    if (!prog.running) return;
    for (let i = 0; i < 4; i++) ctx.fillRect(W - 6 + i, y - 3 + i, 1, 7 - i * 2, 1);
}

/*
 * VOICE GROUPING IS ON -- three stacked bars, offset, like voices displaced
 * into different registers. It sits left of the run mark on the title row.
 *
 * It exists because grouping is the one setting with no cell in the takeover's
 * chord row that CHANGES EVERY NOTE ON THE STAFF. Without a mark the notes
 * move and nothing on screen says why, which reads as the module having
 * drifted rather than as a setting doing its job. `none` draws nothing at all,
 * so the mark means exactly "something is being applied".
 */
function drawGroupMark(ctx, prog, W, y) {
    if (!prog || !prog.grouping) return;
    const x = W - (prog.running ? 13 : 6);
    ctx.fillRect(x + 2, y - 3, 4, 1, 1);
    ctx.fillRect(x,     y,     4, 1, 1);
    ctx.fillRect(x + 3, y + 3, 4, 1, 1);
}

/* ---------------------------------------------------------- the roll ---- */
/*
 * LENGTH IS THE WIDTH OF THE NOTE and the chords run BACK TO BACK: chord k
 * begins where chord k-1 ended, so lengthening one pushes the rest later. The
 * x axis is the CLIP -- `bars` long -- and the progression repeats to fill it,
 * exactly as Stamp writes it, so the picture is the file you will get.
 */
function drawRoll(ctx, prog, top, bottom) {
    const W = ctx.width;
    /*
     * An ALL-REST progression has no pitches, so there is no scale to compute
     * -- and returning here would draw a blank screen for the one state that
     * most needs to look deliberate: a freshly cleared buffer. The rests are
     * drawn against the whole band instead.
     */
    const sc = computeScale(prog, top, bottom);

    const slot = [];
    let acc = 0;
    for (const c of prog.chords) { slot.push(acc); acc += Math.max(1, c.len); }
    const progU = Math.max(1, acc);
    const clipU = Math.max(progU, prog.clipUnits || progU);
    const xOf = (u) => Math.round((u * W) / clipU);

    if (sc) drawGrid(ctx, sc, prog, 0, W, top, bottom);

    const passes = Math.ceil(clipU / progU);
    for (let pass = 0; pass < passes; pass++) {
        for (let k = 0; k < prog.count; k++) {
            const ch = prog.chords[k];
            const startU = pass * progU + slot[k];
            if (startU >= clipU) continue;
            const x0 = xOf(startU + ch.off);
            const x1 = Math.max(x0 + 2, xOf(startU + Math.max(1, ch.len)));
            const w = Math.min(x1, W) - x0;
            if (w <= 0) continue;

            /* A slot boundary, so back-to-back chords remain countable. */
            if (k > 0 || pass > 0) {
                for (let y = top; y <= bottom; y += 3) ctx.fillRect(xOf(startU), y, 1, 1, 1);
            }

            if (ch.rest) {
                drawRest(ctx, x0, w, top, bottom);
                /* The bracket is the SLOT's, so an empty slot still shows it. */
                if (pass === 0 && k === S.cursor)
                    drawSelection(ctx, x0, w, top, bottom);
                continue;
            }
            if (!sc) continue;
            drawChordBlock(ctx, sc, ch, x0, w, top, bottom,
                           pass === 0 && k === S.cursor, k === prog.playing,
                           prog.stepUnits || 8);
        }
    }
}

/*
 * A REST IS DRAWN, NOT OMITTED. Silence you wrote on purpose has to look
 * different from a gap where nothing has been placed yet, or the progression
 * reads as broken. Light diagonal hatching across the slot: unmistakably
 * deliberate, and it cannot be confused with a note because it has no lane.
 */
function drawRest(ctx, x, w, top, bottom) {
    /*
     * An EMPTY SLOT, framed. Two solid edges say "this much time", and a
     * dashed line through the middle says "and nothing plays in it". The first
     * attempt hatched the slot diagonally, which drew a long slash across the
     * whole pitch range and read as a glitch rather than as a rest -- ink in
     * the note area is always read as notes.
     */
    const mid = Math.floor((top + bottom) / 2);
    ctx.fillRect(x, top, 1, bottom - top + 1, 1);
    if (w > 2) ctx.fillRect(x + w - 1, top, 1, bottom - top + 1, 1);
    for (let i = 1; i < w - 1; i += 3) ctx.fillRect(x + i, mid, 2, 1, 1);
}

/*
 * VELOCITY IS INK DENSITY and MUTE IS AN OUTLINE.
 *
 * On a 1-bit screen there is no grey, so "quieter" has to be fewer pixels:
 * a loud chord is solid, a mid one is checkered, a soft one is a thin line.
 * That reads instantly across a whole progression in a way a number never
 * does. A muted chord keeps its full shape but loses its fill, so you can see
 * what it WOULD play -- which is the difference between muting and deleting.
 */
function drawChordBlock(ctx, sc, ch, x, w, top, bottom, selected, playing, stepUnits) {
    const vel = Number.isFinite(ch.vel) ? ch.vel : 100;
    const dense = ch.mute ? 0 : (vel >= 96 ? 3 : vel >= 64 ? 2 : 1);

    /*
     * REPEAT IS DRAWN AS THE SUBDIVISION IT PLAYS. `arm_chord` stamps the
     * chord `rep` times across its own length, so the block is split the same
     * way -- one segment per trigger, with a gap you can count. Drawn as a
     * single long block it was indistinguishable from a repeat of one, and the
     * only way to know the setting was to remember turning the knob.
     *
     * A gap of 1px is spent per division and the segments take what is left,
     * so four repeats inside a narrow chord degrade to thin marks rather than
     * to nothing.
     */
    /*
     * THE RHYTHM IS DRAWN AS THE HITS IT PLAYS. The mask covers one step and
     * TILES across the chord, exactly as the scheduler does -- so a bossa
     * reads as a bossa on screen and not as a solid block. A single long block
     * made every pattern look like every other one, and the only way to know
     * which was set was to remember turning the knob.
     *
     * `stepUnits` is how many of the chord's own length units make one step,
     * so a two-step chord shows the figure twice without the drawer knowing
     * anything about tempo.
     */
    const mask = ch.mask || 1;
    const stepW = (mask === 1) ? w
                : w * (Math.min(ch.len, stepUnits) / Math.max(1, ch.len));
    const hits = [];
    /* "hold" is ONE hit for the whole chord and must not tile -- tiling it
     * drew a two-bar chord as two one-bar blocks, matching what the scheduler
     * was (wrongly) playing. Every other figure is bar-length and repeats. */
    const tiles = (mask === 1) ? 1 : Math.ceil(ch.len / Math.max(1, stepUnits));
    for (let tile = 0; tile < tiles; tile++) {
        for (let b = 0; b < 16; b++) {
            if (!(mask & (1 << b))) continue;
            const u = tile * stepUnits + (b / 16) * stepUnits;
            if (u >= ch.len) break;
            hits.push(Math.round((u / ch.len) * w));
        }
    }
    if (!hits.length) hits.push(0);

    for (const n of ch.notes) {
        const y = sc.y(n);
        if (y < top || y > bottom) continue;
        ctx.fillRect(x, y - 1, w, 3, 0);              /* clear the lane behind */

        for (let r = 0; r < hits.length; r++) {
            const sx = x + hits[r];
            const end = r + 1 < hits.length ? x + hits[r + 1] - 1 : x + w;
            const sw = Math.min(end - sx, x + w - sx);
            if (sw <= 0) continue;
            if (dense === 3) {
                ctx.fillRect(sx, y - 1, sw, 2, 1);
            } else if (dense === 2) {
                ctx.fillRect(sx, y - 1, sw, 1, 1);
                for (let i = 0; i < sw; i += 2) ctx.fillRect(sx + i, y, 1, 1, 1);
            } else if (dense === 1) {
                for (let i = 0; i < sw; i += 2) ctx.fillRect(sx + i, y - 1, 1, 1, 1);
            } else {
                /* muted: ends only, so the shape survives without the body */
                ctx.fillRect(sx, y - 1, 1, 2, 1);
                ctx.fillRect(sx + sw - 1, y - 1, 1, 2, 1);
            }
        }
        if (!sc.D.inScale[n] && x - 2 >= 0) ctx.fillRect(x - 2, y - 1, 1, 2, 1);
        if (playing && y + 1 <= bottom) ctx.fillRect(x, y + 1, w, 1, 1);
    }

    if (selected) drawSelection(ctx, x, w, top, bottom);
}

/*
 * SELECTION IS A FULL-HEIGHT BRACKET, AND IT BELONGS TO THE SLOT, NOT TO THE
 * NOTES.
 *
 * It has to be findable on a chord whose notes all sit at the bottom of the
 * range -- and, more importantly, on a slot that has NO notes. It lived inside
 * drawChordBlock, which the rest path skips with an early `continue`, so a
 * selected REST drew no bracket at all: on a freshly cleared buffer -- one
 * rest, which is the state the module BOOTS in -- nothing on screen said what
 * you were about to edit. The one moment the cursor matters most was the one
 * moment it was invisible.
 */
function drawSelection(ctx, x, w, top, bottom) {
    for (let y = top; y <= bottom; y += 2) {
        ctx.fillRect(x, y, 1, 1, 1);
        ctx.fillRect(Math.min(x + w - 1, ctx.width - 1), y, 1, 1, 1);
    }
    ctx.fillRect(x, top, w, 1, 1);
}

/*
 * WHAT THE RELEASE WILL DO, while you are still holding.
 *
 * The long press cannot fire at the threshold (tick has no setParam), so
 * without this you would hold a button with no idea whether you had held it
 * long enough. Drawn only while the flag is up, so it costs nothing the rest
 * of the time and needs no dismissing.
 */
function say(ctx, msg) {
    S.toast = msg;
    S.toastAt = (typeof ctx.now === "function" ? ctx.now() : Date.now());
}

function drawToast(ctx, H, nowMs) {
    if (!S.toast || nowMs - S.toastAt > TOAST_MS) return;
    const w = S.toast.length * F3_W;
    const x = Math.max(0, Math.floor((ctx.width - w) / 2));
    const y = Math.floor(H / 2) - 2;
    ctx.fillRect(x - 3, y - 2, w + 5, F3_H + 4, 0);
    ctx.drawRect(x - 3, y - 2, w + 5, F3_H + 4, 1);
    tinyPrint(ctx, x, y, S.toast);
}

function drawHoldHint(ctx, H) {
    if (!S.holdLong) return;
    const msg = "RELEASE: HALFTIME";
    const w = msg.length * F3_W;
    const x = Math.max(0, Math.floor((ctx.width - w) / 2));
    const y = H - F3_H - 3;
    ctx.fillRect(x - 3, y - 2, w + 5, F3_H + 4, 0);
    ctx.drawRect(x - 3, y - 2, w + 5, F3_H + 4, 1);
    tinyPrint(ctx, x, y, msg);
}

/* ===================================================================== *
 * The overlay
 * ===================================================================== */
globalThis.canvas_overlay = {
    widgetKind: "custom:stkstaff",

    onOpen(ctx) {
        S.bank = CHORD_BANK;
        S.padPage = 0;
        lastLed.fill(-1);   /* the shim just replayed Move's rings; re-emit all */
        lastPad.fill(-1);
        S.parmPage = 0;
        S.rowScroll = [0, 0, 0];
        for (const r of lastParamPad) r.fill(-1);
        /* Take the pads. Global switch -- released in onClose, always. */
        if (typeof host_pad_block === "function") host_pad_block(1);
        refresh(ctx);
        refreshBank(ctx);
        if (S.prog) S.cursor = Math.max(0, Math.min(S.prog.count - 1, S.prog.sel - 1));
    },

    /*
     * GIVE THE RINGS BACK, do not just darken them. Move writes an LED only
     * when its value changes, so a knob we left dark stays dark on its own
     * track until something moves it -- the same bug exitParamPages documents.
     */
    onClose() {
        lastLed.fill(-1);
        lastPad.fill(-1);
        /*
         * GIVE THE PADS BACK BEFORE RELEASING THE BLOCK, and give them back
         * DARK rather than leaving our colours on Move's grid -- Move writes a
         * pad LED only when its own value changes, so a pad we left lit stays
         * lit on its track until something else moves it. Same failure the
         * knob rings document above.
         */
        for (const r of lastParamPad) r.fill(-1);
        /*
         * DO NOT DARKEN THEM HERE. Blanking the pads and releasing the block
         * hands Move a grid it will not repaint -- it writes a pad LED only
         * when its own value changes -- so they respond and stay invisible,
         * which reads as "the pads are dead".
         *
         * The host restores Move's own colours from the shim's SHM mirror when
         * it releases the block, which is the only place that runs on EVERY
         * exit path. Releasing here just brings that forward.
         */
        if (typeof host_pad_block === "function") host_pad_block(0);
        if (typeof shadow_restore_knob_leds === "function") shadow_restore_knob_leds();
    },

    draw(ctx) {
        const W = ctx.width, H = ctx.height;
        if (!S.prog) {
            ctx.print(2, Math.floor(H / 2) - 3, "reading progression...", 1);
            return;
        }
        drawTopRow(ctx, typeof ctx.now === "function" ? ctx.now() : 0);
        ctx.fillRect(0, F3_H + 2, W, 1, 1);
        drawRunMark(ctx, S.prog, W, F3_H + 1);
        drawGroupMark(ctx, S.prog, W, F3_H + 1);
        /* module.json declares show_footer:false, so nothing is painted after
         * this and the roll owns everything below the rule. */
        drawRoll(ctx, S.prog, F3_H + 4, H - 1);
        drawPlayhead(ctx, S.prog, F3_H + 4, H - 1,
                     typeof ctx.now === "function" ? ctx.now() : 0);
        drawEmptyHint(ctx, S.prog, H);
        drawHoldHint(ctx, H);
        drawToast(ctx, H, typeof ctx.now === "function" ? ctx.now() : 0);
    },

    /* The only per-frame work is a throttled SHM read; no IPC. */
    tick(ctx) {
        const now = (typeof ctx.now === "function" ? ctx.now() : Date.now());
        pollTransport(now);
        /*
         * Watch the held button cross the threshold. tick CANNOT act -- its
         * context has setParam removed -- so all it does is raise the flag
         * that `draw` reads. The action itself waits for the release.
         */
        if (S.holdCC >= 0 && !S.holdLong && now - S.holdAt >= LONG_PRESS_MS)
            S.holdLong = true;
        /*
         * RE-ASSERT THE CLAIM EVERY FRAME WE ARE ACTUALLY ON SCREEN.
         *
         * The host RELEASES pad_block whenever nothing on screen wants the
         * pads -- which is what stops us stranding them for every other module
         * when you leave. The consequence is that taking them ONCE in onOpen
         * is not enough: dismiss the shadow UI and come back, and the flag has
         * been cleared while onOpen does not run again, so the pads would be
         * dead until you reopened the staff.
         *
         * So ownership is continuous and idempotent: the owner asserts while
         * visible, the host clears when nobody is. Gated on the display being
         * SHOWN, or this would fight the very release it depends on -- `tick`
         * is gated on the view, and the view outlives the screen.
         */
        if (typeof host_pad_block === "function"
            && (typeof shadow_get_display_mode !== "function"
                || shadow_get_display_mode() === 1))
            host_pad_block(1);

        /* The pad row follows the playhead, so it updates per frame like the
         * head does -- and costs nothing when nothing moved. */
        updatePadLeds();
        updateParamPadLeds();
    },

    onMidi(ctx, payload) {
        const d = (payload && payload.data) || [];
        if (d.length < 3) return;
        const status = d[0] & 0xF0, d1 = d[1], d2 = d[2];

        /* KNOB TOUCH is a NOTE (0-9), not a CC. It is what switches the top row
         * from meanings to values, so it has to be tracked before the CC
         * branch returns. */
        if (status === 0x90 && d2 > 0 && d1 < 8) { S.touched = d1; return; }
        if ((status === 0x80 || (status === 0x90 && d2 === 0)) && d1 < 8) {
            if (S.touched === d1) S.touched = -1;
            return;
        }
        /*
         * PADS. Only reach us while host_pad_block is on, so there is no need
         * to guard against Move seeing them too.
         *
         * A pad SELECTS and PLAYS: down selects the slot and starts it, up
         * stops it -- the same contract the jog click has, so holding a pad
         * sustains exactly as holding the jog does. Selecting silently is
         * still available on the jog, which is why that stays silent.
         */
        if (status === 0x90 || status === 0x80) {
            /* Rows 2-4 write one value to the selected chord, on the press. */
            for (let r = 1; r <= 3; r++) {
                const col = d1 - PAD_ROW_BASE[r];
                if (col < 0 || col >= PAD_ROW_LEN) continue;
                if (!(status === 0x90 && d2 > 0)) return;   /* press only */
                const row = (PAD_PAGES[S.parmPage] || {}).rows;
                const spec = row && row[r - 1];
                if (!spec) return;
                const idx = S.rowScroll[r - 1] + col;
                const v = spec.opts[idx];
                if (v === null || v === undefined) return;  /* empty pad */
                /* Dark pads do nothing -- see degreeCount() above. */
                if (spec.key === "degree" && idx >= degreeCount()) return;
                ctx.setParam(spec.key, v);
                refresh(ctx);
                refreshBank(ctx);
                return;
            }
            const slot = d1 - PAD_ROW1;
            if (slot < 0 || slot >= PAD_ROW_LEN) return;
            const idx = S.padPage * PAD_ROW_LEN + slot;
            const down = (status === 0x90 && d2 > 0);
            if (down) {
                if (!S.prog || idx >= S.prog.count) return;   /* past the end */
                S.cursor = idx;
                ctx.setParam("sel", String(idx + 1));
                ctx.setParam("play", "on");
                S.holding = true;
                refresh(ctx);
                refreshBank(ctx);
            } else if (S.holding) {
                ctx.setParam("play", "off");
                S.holding = false;
            }
            return;
        }

        if (status !== 0xB0) return;
        if (!S.prog) { refresh(ctx); return; }

        /*
         * THE ARROWS, and which pair does what is deliberate.
         *
         *   Up / Down            the SET of parameter rows (write / voice / feel)
         *   Left / Right         scroll the current rows through a long list
         *   Mute + Left/Right    the chord row, chords 1-8 / 9-16
         *
         * The frequent action is on the bare button and the rare one behind a
         * modifier: most progressions are under eight chords so the chord row
         * seldom needs paging, while Rhythm has 24 figures and Colour 10.
         *
         * Mute rather than Shift because a shift-held press is NEVER delivered
         * to a claimed CC -- "the module gets the BARE buttons only" -- which
         * is the same rule that made Shift+Copy unreachable.
         */
        if ((d1 === ARROW_LEFT || d1 === ARROW_RIGHT) && d2 > 0) {
            const dir = (d1 === ARROW_RIGHT) ? 1 : -1;
            if (S.shift) {                     /* Mute + arrow: the chords */
                const pages = Math.max(1, Math.ceil(S.prog.count / PAD_ROW_LEN));
                S.padPage = Math.max(0, Math.min(pages - 1, S.padPage + dir));
                const lo = S.padPage * PAD_ROW_LEN + 1;
                say(ctx, `CHORDS ${lo}-${Math.min(lo + 7, S.prog.count)}`);
            } else {                           /* scroll the parameter rows */
                const rows = (PAD_PAGES[S.parmPage] || {}).rows || [];
                let moved = false;
                for (let r = 0; r < rows.length; r++) {
                    const max = Math.max(0, rows[r].opts.length - PAD_ROW_LEN);
                    const was = S.rowScroll[r];
                    S.rowScroll[r] = Math.max(0, Math.min(max, was + dir));
                    if (S.rowScroll[r] !== was) moved = true;
                }
                /* Name the row that actually has more to show, so the message
                 * is about the thing that moved rather than the page. */
                const long = rows.find((x) => x.opts.length > PAD_ROW_LEN);
                say(ctx, moved && long
                    ? `${long.label} ${S.rowScroll[rows.indexOf(long)] + 1}-` +
                      `${S.rowScroll[rows.indexOf(long)] + PAD_ROW_LEN} OF ${long.opts.length}`
                    : "NOTHING MORE TO SHOW");
            }
            return;
        }

        if ((d1 === ARROW_UP || d1 === ARROW_DOWN) && d2 > 0) {
            const was = S.parmPage;
            const want = S.parmPage + (d1 === ARROW_UP ? 1 : -1);
            S.parmPage = Math.max(0, Math.min(PAD_PAGES.length - 1, want));
            if (S.parmPage === was) {
                /* Say nothing happened rather than name the page again: a
                 * message that fires on a press which changed NOTHING is the
                 * reason the pads looked broken when there was only one page. */
                say(ctx, (d1 === ARROW_UP) ? "TOP ROW SET" : "FIRST ROW SET");
                return;
            }
            S.rowScroll = [0, 0, 0];
            const pg = PAD_PAGES[S.parmPage];
            /* The page NAME plus what its rows are, because the name alone
             * does not tell you which pad does what. */
            /* The rows are named, not abbreviated from the key: `ccolour`
             * truncates to "CCO", which names nothing. */
            say(ctx, pg ? `${pg.name}: ${pg.rows.map((r) => r.label).join(" ")}`
                        : "ROWS");
            refreshBank(ctx);          /* the new rows need their values */
            return;
        }

        if (d1 === MUTE_CC) { S.shift = d2 > 0; return; }

        if (d1 === JOG_TURN_CC) {
            const step = delta(d2) > 0 ? 1 : -1;
            if (shiftHeld() || S.shift) {
                /* SHIFT + JOG changes bank -- Shift read from the shim, not
                 * from a CC. Mute is kept as a second modifier because it IS
                 * forwarded, so the gesture still works on a host whose
                 * shift binding is missing. Clamped, not wrapped: the banks are
                 * ordered chord-first, so the ends mean something. */
                const b = Math.max(0, Math.min(BANKS.length - 1, S.bank + step));
                if (b !== S.bank) {
                    S.bank = b;
                    S.bankAt = typeof ctx.now === "function" ? ctx.now() : 0;
                    refreshBank(ctx);
                }
                return;
            }
            const c = Math.max(0, Math.min(S.prog.count - 1, S.cursor + step));
            if (c !== S.cursor) {
                S.cursor = c;
                /* Selecting is SILENT -- `sel` no longer auditions. */
                ctx.setParam("sel", String(c + 1));
                refresh(ctx);
                refreshBank(ctx);
            }
            return;
        }

        if (d1 === JOG_CLICK_CC) {
            /* A GATE, not a trigger: the chord sounds for exactly as long as
             * the jog is down. The release matters as much as the press. */
            if (d2 === 0) {
                ctx.setParam("play", "off");
                S.holding = false;
                refresh(ctx);          /* so the playhead stops with the sound */
                return;
            }
            /*
             * MUTE+CLICK MUTES the selected chord -- the button says what it
             * does. It used to be a second way to INSERT, because Mute was
             * blanket-treated as "the other Shift"; that wasted the one
             * modifier whose name already names an action, and left muting
             * reachable only from a knob on the VOICE bank.
             *
             * SHIFT+CLICK inserts a copy of the selected chord; a plain click
             * plays it. Shift is read from the shim rather than tracked from
             * CC 49, which never arrives -- the same reason the bank modifier
             * has to ask instead of listen.
             *
             * `~1` toggles: the module flips a two-option enum on any step, so
             * this needs no read to know which way to go.
             */
            if (S.shift) {
                ctx.setParam("cmute", "~1");
                refresh(ctx);
                refreshBank(ctx);
                return;
            }
            if (shiftHeld()) {
                ctx.setParam("insert", "on");
                refresh(ctx);
                if (S.prog) {
                    S.cursor = Math.min(S.cursor + 1, S.prog.count - 1);
                    ctx.setParam("sel", String(S.cursor + 1));
                }
                refreshBank(ctx);
            } else {
                ctx.setParam("play", "on");
                S.holding = true;
                refresh(ctx);          /* re-anchors on the chord we start from */
            }
            return;
        }

        /*
         * COPY DUPLICATES THE WHOLE PROGRESSION, not one chord -- that is what
         * the button means everywhere else, and duplicating a single chord
         * already has a gesture (Shift+click). The clip's bars grow to hold
         * the longer phrase; the module refuses outright rather than copying a
         * partial one when it would not fit.
         */
        /*
         * COPY: three actions on one button.
         *   tap            duplicate the progression   (twice as many chords)
         *   hold           halftime                    (each chord twice as long)
         *   Mute + press   double-time                 (each chord half as long)
         *
         * Mute is decided at the PRESS, because holding Mute is already an
         * unambiguous statement and waiting would make the modifier feel late.
         * Tap and hold can only be told apart on the release.
         */
        if (d1 === COPY_CC && d2 > 0 && S.shift) {
            ctx.setParam("compress", "on");     /* double-time */
            S.holdCC = -1;
            refresh(ctx);
            refreshBank(ctx);
            return;
        }
        if (d1 === COPY_CC && d2 > 0) {
            S.holdCC = d1;
            S.holdAt = (typeof ctx.now === "function" ? ctx.now() : Date.now());
            S.holdLong = false;
            return;                              /* nothing fires on the press */
        }
        if (d1 === COPY_CC && d2 === 0 && S.holdCC === COPY_CC) {
            const t = (typeof ctx.now === "function" ? ctx.now() : Date.now());
            const long = (t - S.holdAt) >= LONG_PRESS_MS;
            S.holdCC = -1;
            S.holdLong = false;
            ctx.setParam(long ? "stretch" : "duplicate", "on");
            refresh(ctx);
            refreshBank(ctx);
            return;
        }

        /*
         * UNDO, and MUTE+UNDO for redo -- Move's own button, so the gesture is
         * the one already in your hand rather than a knob to find. Mute for
         * the same reason as Copy above: a shift-held press never reaches a
         * claimed CC.
         */
        if (d1 === UNDO_CC && d2 > 0) {
            ctx.setParam(S.shift ? "redo" : "undo", "on");
            refresh(ctx);
            refreshBank(ctx);
            if (S.prog) {
                if (S.cursor > S.prog.count - 1) S.cursor = S.prog.count - 1;
                if (S.cursor < 0) S.cursor = 0;
            }
            return;
        }

        if (d1 === DELETE_CC && d2 > 0) {
            ctx.setParam("remove", "on");
            refresh(ctx);
            if (S.prog) {
                if (S.cursor > S.prog.count - 1) S.cursor = S.prog.count - 1;
                ctx.setParam("sel", String(S.cursor + 1));
            }
            return;
        }

        if (d1 >= KNOB_CC_FIRST && d1 < KNOB_CC_FIRST + 8) {
            const slot = d1 - KNOB_CC_FIRST;
            const key = (bank().keys[slot] || [])[0];
            if (!key) return;
            const step = delta(d2);
            if (!step) return;

            /*
             * A TRIGGER FIRES ONCE PER GESTURE, NOT ONCE PER DETENT.
             *
             * One flick of an encoder sends several deltas and a slow spin
             * sends dozens. That is harmless for Clear, which is idempotent,
             * and destructive for Stamp Clip and Read Clip -- a single turn
             * would have written the clip eight times. So the first detent
             * fires and the rest of the gesture is swallowed until the knob
             * has been still for a moment, or a different knob is touched.
             */
            if (TRIGGERS[key]) {
                const t = (typeof ctx.now === "function" ? ctx.now() : Date.now());
                if (S.trigKnob === slot && t - S.trigAt < TRIGGER_LATCH_MS) {
                    S.trigAt = t;             /* still spinning: stay latched */
                    return;
                }
                S.trigKnob = slot;
                S.trigAt = t;
                ctx.setParam(key, "on");
                refresh(ctx);
                refreshBank(ctx);
                return;
            }

            const cur = ctx.getParam(key);
            if (cur === null || cur === undefined) return;   /* no answer, no write */

            /*
             * ASK THE CONTRACT WHAT THIS IS. DO NOT PARSE THE VALUE.
             *
             * This used to decide "number or enum" by running parseInt over
             * whatever the module had just reported -- and SIX CHORD SHAPES
             * ARE NAMED WITH DIGITS: 5, 6, 69, 9, 11 and 13.
             *
             * Landing on the 6/9 chord made the knob believe it was holding
             * the NUMBER 69, so a detent wrote "70", which is not a shape, so
             * the module refused it and the knob went dead -- reported as "the
             * shape shows 69 and then it hangs". Worse on the power chord "5":
             * a detent wrote "6", which IS a shape, eight positions away, so
             * the walk silently teleported.
             *
             * PARAM_RANGES is generated from the contract and already says
             * which is which: an enum lists its option STRINGS, a number gives
             * [lo, hi]. A value can be ambiguous; the declaration cannot.
             */
            const range = PARAM_RANGES[key];
            const numeric = Array.isArray(range) && typeof range[0] === "number";
            const n = parseInt(cur, 10);
            if (numeric && Number.isFinite(n)) {
                ctx.setParam(key, String(n + step));
            } else {
                /*
                 * An enum answers by NAME, so only the module knows what the
                 * next option is -- we send a relative step and it walks.
                 *
                 * The step goes in the VALUE. A key containing a colon is
                 * treated by the canvas runtime as already fully qualified
                 * (`if (key.includes(":")) return key`), so a "key:verb" form
                 * loses the component prefix and addresses nobody -- which is
                 * how every enum here came to be silently dead.
                 */
                ctx.setParam(key, "~" + step);
            }
            refresh(ctx);
            refreshBank(ctx);
            return;
        }
    },

    /*
     * The Chord cell: the progression's CONTOUR.
     *
     * Two wrong answers came first. A shrunken piano roll was the wrong thing
     * made small -- adjacent chords share notes so their blocks butt into
     * continuous lines, and at 15px the pitch scale collapses so distinct
     * notes land on the same row. Uniform position blocks fixed the legibility
     * and threw away the music: four identical bars say where you are and
     * nothing about what is there.
     *
     * A contour is what a cell this size can actually carry. Each chord is a
     * mark whose HEIGHT is its root, so the shape of the progression -- rising,
     * falling, the drop into the vi -- reads at a glance, and changing a root
     * visibly moves it. Selection is a full-height tick behind the mark, which
     * cannot be confused with pitch because it spans the whole cell.
     */
    drawCell(ctx, payload) {
        const w = ctx.width, h = ctx.height;
        if (w < 8 || h < 6) return;
        const prog = parseProg((payload && payload.values || {}).prog);
        if (!prog) return;

        const n = prog.count;
        const colW = Math.max(2, Math.floor(w / n));
        const top = 3, bot = h - 2;   /* row 0 is the selection edge */

        /* Scale to the roots actually present, so the contour uses the whole
         * cell whatever octave the progression sits in. */
        let lo = 127, hi = 0;
        for (const c of prog.chords) {
            if (c.rest || !c.notes.length) continue;
            const r = c.notes[0];
            if (r < lo) lo = r;
            if (r > hi) hi = r;
        }
        const span = Math.max(1, hi - lo);

        for (let k = 0; k < n; k++) {
            const c = prog.chords[k];
            const x = k * colW;
            const bw = Math.max(1, colW - 1);

            /* THREE SIGNALS, THREE PLACES. Selection was a full-height dotted
             * column, which ran through the contour mark and made the selected
             * chord the hardest one to read. It lives on the top edge now,
             * where nothing else draws; the contour owns the middle; a rest
             * owns a short dash on the baseline. None can be mistaken for
             * another, and none is the absence of another. */
            if (k === prog.sel - 1) ctx.fillRect(x, 0, bw, 1, 1);
            if (c.rest || !c.notes.length) {
                const d = Math.max(1, Math.floor(bw / 2));
                ctx.fillRect(x + Math.floor((bw - d) / 2), bot, d, 1, 1);
                continue;
            }
            const y = hi === lo ? Math.floor((top + bot) / 2)
                                : bot - Math.round(((c.notes[0] - lo) / span) * (bot - top));
            ctx.fillRect(x, y - 1, bw, 2, 1);
        }
    },
};
