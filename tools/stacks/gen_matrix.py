#!/usr/bin/env python3
"""
Emit the Stacks control matrix as a publishable HTML page.

GENERATED, NOT WRITTEN. The banks live in canvas.js, the parameter names and
ranges in module.json, and the levels in the same contract the device reads --
so a hand-kept page is a fourth copy that goes stale the first time a knob
moves. This reads all three and lays them out; the design is in the template,
the facts are never typed twice.

    python3 tools/stacks/gen_matrix.py            # -> docs/stacks-matrix.html
    python3 tools/stacks/gen_matrix.py --out X    # somewhere else
"""
import argparse, json, pathlib, re, html

ROOT = pathlib.Path(__file__).resolve().parents[2]
MJ = ROOT / "src/modules/midi_fx/stacks/module.json"
CJS = ROOT / "src/modules/midi_fx/stacks/canvas.js"

def check_desc_balance(desc, lo=95, hi=180):
    """Fail the build if any cell's text drifts out of the band.

    The cells are a fixed grid. A description five times longer than its
    neighbours does not read as more important -- it reads as a broken layout,
    and it stretches every cell in its row. Voice Grouping once ran to 627
    characters against a median of 74, which is what prompted this.

    Length is measured on the RENDERED text, with tags and entities resolved:
    `&mdash;` is one character on screen and eight in the source, and counting
    the source would let a cell full of markup pass while looking twice as long
    as its neighbours.
    """
    import html as _html
    bad = []
    for k, v in desc.items():
        n = len(_html.unescape(re.sub(r"<[^>]+>", "", v)))
        if n < lo or n > hi:
            bad.append(f"  {k}: {n} chars (want {lo}-{hi})")
    if bad:
        raise SystemExit("Cell descriptions are unbalanced:\n" + "\n".join(bad))


ap = argparse.ArgumentParser()
ap.add_argument("--out", default=str(ROOT / "docs/stacks-matrix.html"))
a = ap.parse_args()

mj = json.load(MJ.open())
PRESET_NAMES = [e for e in
    (json.load(MJ.open())["capabilities"]["chain_params"])
    if e["key"] == "progression"][0]["options"][1:]   # minus "none"
# Every library's size is COUNTED, never typed. The prose below said "63" in one
# place, "twenty-five" in another and "25" in a third, all describing the same
# knob -- three numbers for one fact is what happens when a count is written by
# hand next to a table that grows.
def _optcount(key):
    return len([e for e in mj["capabilities"]["chain_params"]
                if e["key"] == key][0]["options"]) - 1   # minus "none"
N_GENRE, N_COMMON, N_UNCOMMON = (_optcount("progression"),
                                 _optcount("common"), _optcount("uncommon"))
N_PROGS = N_GENRE + N_COMMON + N_UNCOMMON
params = {e["key"]: e for e in mj["capabilities"]["chain_params"]}
levels = mj["ui_hierarchy"]["levels"]

src = CJS.read_text()
blk = src[src.index("const BANKS = ["):src.index("];", src.index("const BANKS = ["))]
banks = []
for m in re.finditer(r'\{\s*name:\s*"(\w+)",\s*keys:\s*\[(.*?)\]\s*\}', blk, re.S):
    cells = re.findall(r'\["([a-z_]+)","([^"]*)","[^"]*"\]|\[null,"",""\]', m.group(2))
    banks.append((m.group(1), [(k, l) if k else (None, None) for k, l in cells]))

PAGE = {"CHORD": "Chord", "VOICE": "Voice", "MAIN": "Main", "START": "Start", "FEEL": "Feel", "CLIP": "Clip"}

# What each knob DOES. Kept here rather than in module.json because it is
# documentation, not contract -- the device never reads it, and chain_params
# crosses an IPC boundary on every component load. The assertion below is what
# keeps it honest: a knob added to a bank without a description fails the build
# of this page rather than shipping a blank cell.
DESC = {
 # ---------------------------------------------------------------------------
 # ONE PARAGRAPH, ONE LENGTH.
 #
 # These sit in a fixed grid of equal cells, so a description five times longer
 # than its neighbours does not read as more important -- it reads as a broken
 # layout, and it stretches the whole row it lands in. Voice Grouping was 627
 # characters against a median of 74.
 #
 # So each one states WHAT THE CONTROL DOES and, where it is surprising, the one
 # fact you would otherwise get wrong. The reasoning, the war stories and the
 # cross-references belong in the note cards at the foot of the page, which are
 # free to run long because nothing is aligned to them. `check_desc_balance`
 # below fails the build if any cell drifts out of the band again.
 # ---------------------------------------------------------------------------
 "scale":     "Which notes exist. Roots snap to it and it draws the grid's lanes. <strong>Live</strong>: changing it re-snaps the progression already in the buffer.",
 "key":       "The tonic, and the line you read pitch against. <strong>Transposes the buffer</strong> as you turn it; at the edge of the range it stops rather than deforming.",
 "defoct":    "The octave the progression sits in. Moves the whole buffer by octaves as you turn it, and sets where a newly filled slot starts.",
 "steps":     "How many chords. Growing copies the last one; while the buffer is still empty it instead divides <em>Clip Bars</em> between the slots.",
 "rate":      "The length a chord is given. It cannot reach a chord you have <em>written</em> &mdash; but while the buffer is empty it re-lengths every slot, and the clip follows.",
 "bars":      "How long the clip is, and the <strong>one loop length</strong>. It <em>follows the music</em> &mdash; both ways &mdash; until you turn it yourself; after that it is yours, and only grows if the music would not fit.",
 "degree":    "Sets the chord's root by scale degree, counted through the scale's own notes &mdash; a pentatonic has five, a blues six. Bound to the pad row, where a missing degree is dark.",
 "grouping":  "How the chords sit against each other, and where. <em>dynamic</em> leads each voicing from the one before; the registers fold them into two octaves; opens and drops space them.",

 "genre":     "Groups the library into 15 styles. Turning it jumps to that genre's first progression and applies it &mdash; the gesture Family performs on Shape.",
 "progression":"63 progressions, stored as semitones from the tonic so they land in your Key and Scale. <strong>Voiced by style</strong>, so Colour leaves them alone. It overwrites.",
 "common":    "The progressions most songs are built from. Written as plain triads with no style of their own, which is what makes Colour meaningful on them.",
 "uncommon":  "Chromatic and modal material: borrowed iv, backdoor, Phrygian, chromatic mediants, secondary dominants. Plain triads like Common, so Colour applies.",
 "colour":    "How the chord is voiced, not which chord it is: close, open, the drops, shell, rootless, quartal, spread, cluster. The axis <em>Shape</em> cannot express.",

 "root":      "The chord's root note; Family and Shape build upward from it. Snapped into the current Scale at the moment it sounds.",
 "coct":      "Which octave that root sits in. Moves the whole chord with its shape and inversion intact, leaving the voicing alone.",
 "family":    "<strong>Not a value of its own</strong>: it reads the chord's family and writes <em>Chord Shape</em>. Leaving a family and coming back lands on that family's first chord.",
 "shape":     "<strong>The chord itself</strong>, from intervals through 13ths &mdash; the one thing stored per chord and written into the clip. Includes <em>rest</em>.",
 "inv":       "One ladder through zero: up rotates the lowest voice an octave up, down rotates the highest an octave down. Each detent moves exactly one voice.",
 "len":       "How long this chord lasts, in eighths of a bar &mdash; an absolute duration, so 8 is one bar whatever <em>New Chord Len</em> says. Chords run back to back.",
 "off":       "Delays the chord inside its own slot so it can sit off the beat. It never pushes the next chord along.",
 "cvel":      "Offsets this chord's velocity against the global <em>Velocity</em>. Visible in the grid: a quieter chord draws lighter.",

 "ccolour":   "The same setting as Start's Colour, reached per chord: Start voices the whole progression, this voices the one you are editing, and each reads what the other left.",
 "cstrum":    "Spreads this chord's notes across time, lowest first &mdash; a strum rather than every note landing together.",
 "cgate":     "Offsets how much of this chord's length actually sounds, against the global <em>Gate</em>. Shorter reads as a stab.",
 "cmute":     "Silences this chord but keeps it in the progression. Drawn as an outline, so you can still see what it would play.",
 "rhythm":    "24 figures &mdash; the grid, syncopation, clave, jazz comping, rock, electronic. Each covers one BAR and repeats across the chord; <em>hold</em> strikes once and is held.",
 "ctrans":    "Transposes this chord in semitones after its shape is built, so the shape survives and only the pitch moves.",

 "octave":    "Transposes the whole progression at once. The per-chord <em>Transpose</em> on VOICE rides on top of this.",
 "velocity":  "Base velocity that every chord is measured from. The per-chord <em>Chord Vel</em> is an offset against it.",
 "gate":      "Base proportion of a chord's length that actually sounds. The per-chord <em>Chord Gate</em> offsets this one.",
 "swing":     "Delays the off-beat units. Measured against absolute position rather than the chord's own, so it cannot drift.",
 "hum_vel":   "Spreads velocity per note, as a share of the base. Seeded, so the same feel repeats until you randomize it.",
 "roll_vel":  "Re-rolls which deviations the notes get. Same depth, a new feel &mdash; and Stamp writes the take you heard.",
 "hum_time":  "Spreads onsets per note. The spread is shifted so the earliest note still lands on the beat, never clamped.",
 "roll_time": "Re-rolls the timing spread and leaves velocity where it is, so the two can be dialled in separately.",

 "read":      "Reads the clip playing on this track and names its chords, so you can edit something you already recorded.",
 "read_mode": "Whether reading replaces the progression or appends to it, so one phrase can be built from several clips.",
 "stamp":     "Writes the progression back to the clip. Under Rec arm it plays exactly one lap for Move to record.",
 "stamp_mode":"Rec arm lets Move write the clip and is the default. Write file edits Song.abl directly, and is opt-in.",
 "clear":     "Empties the buffer to a single rest, in your Key and Octave Default &mdash; not to a demo progression.",
 "lanes":     "Which grid lines the staff draws: only the notes of the selected scale, or all seven letter names.",
 "preview":   "Whether editing a chord auditions it, and whether the progression keeps looping while the transport is stopped.",
 "run":       "Whether Stacks plays along with Move's transport. Switched off after a stamp so the clip is not doubled.",

 "stretch":   "Halftime: every chord held twice as long, so the phrase plays at half speed over twice the bars. Bound to <em>hold Copy</em>; a tap duplicates instead.",
 "compress":  "Double-time: every chord half as long. The exact inverse of Half Length, so the pair round-trips; refused at the floor rather than flattening the relative lengths.",
 "undo":      "Steps back through the buffer. Every write is captured, so an ordinary shape edit undoes like a Duplicate does.",
 "redo":      "Steps forward again through the buffer. Editing after an undo discards the branch you were walking back into.",
 "duplicate": "Repeats the whole progression at the same tempo, growing the clip to hold it. Refused if it would not fit.",
 "insert":    "Inserts a copy of the selected chord after it, because you insert while editing something you want a variation of.",
 "remove":    "Deletes the selected chord. A progression of one is the floor, since every add gesture copies the chord you are on.",
 "play":      "Plays from the selected chord onward for exactly as long as it is held, looping round the end of the clip.",
 "sel":       "Which chord the CHORD and VOICE banks act on. The jog does this in the grid, so it spends no knob there.",
 "grid":      "The note grid itself &mdash; the fullscreen staff, entered by clicking the jog and left only with Back.",
}

check_desc_balance(DESC)
CHORD_SCOPE = {"CHORD", "VOICE"}

# Where the CONTRACT default is not what the module actually gives you, say
# what really happens. `root` is the case: it is computed from Key and Octave
# Default the moment a rest becomes a chord, so printing the literal in
# chain_params would document a number no one ever sees.
DEFAULT_NOTE = {
 "root": "Key at Octave Default",
 "coct": "follows Octave Default",
}

def dflt(key, e):
    """What you get before you touch it, or None if the question is meaningless."""
    if not e or e.get("access") == "write":
        return None                      # a trigger has no resting value
    if key in DEFAULT_NOTE:
        return DEFAULT_NOTE[key]
    d = e.get("default")
    if d is None:
        return None
    if e["type"] == "enum":
        o = e.get("options", [])
        return o[d] if isinstance(d, int) and 0 <= d < len(o) else str(d)
    return str(d)

def rng(e):
    if not e: return ""
    if e["type"] == "int":  return f'{e["min"]} – {e["max"]}'
    if e["type"] == "enum":
        o = e["options"]
        return " / ".join(o) if len(o) <= 4 else f"{len(o)} options"
    return e["type"]

def cell(i, key, label):
    if not key:
        return f'<div class="knob knob--empty"><span class="pos">{i}</span></div>'
    e = params.get(key, {})
    trig = ' <span class="trig">fires</span>' if e.get("access") == "write" else ""
    d = dflt(key, e)
    dfl = f' &middot; <span class="dflt">{html.escape(d)}</span>' if d else ""
    return (f'<div class="knob"><span class="pos">{i}</span>'
            f'<span class="code">{html.escape(label)}</span>'
            f'<span class="name">{html.escape(e.get("name", key))}{trig}</span>'
            f'<span class="desc">{DESC[key]}</span>'
            f'<span class="rng">{html.escape(rng(e))}{dfl}'
            f' &middot; <span class="key">{html.escape(key)}</span></span></div>')

missing = sorted({k for _, ks in banks for k, _ in ks if k and k not in DESC})
if missing:
    raise SystemExit(f"no description for: {', '.join(missing)} -- add it to DESC")

sections = []
for name, keys in banks:
    scope = "selected chord" if name in CHORD_SCOPE else "whole progression"
    cls = "chord" if name in CHORD_SCOPE else "prog"
    strip = "".join(
        f'<span>{html.escape(l) if l else ""}</span>' for _, l in keys)
    grid = "".join(cell(i + 1, k, l) for i, (k, l) in enumerate(keys))
    used = sum(1 for k, _ in keys if k)
    sections.append(f'''
    <section class="bank bank--{cls}">
      <header class="bank__head">
        <h2>{name}</h2>
        <p class="scope">acts on the <strong>{scope}</strong></p>
        <p class="page">knob page <code>{PAGE.get(name, name)}</code> &middot; {used} of 8</p>
      </header>
      <div class="screen" aria-label="the label row as it appears on the device">{strip}</div>
      <div class="grid">{grid}</div>
    </section>''')

GESTURES = [
    # ------------------------------------------------------------------
    # EVERY GESTURE THE OVERLAY HANDLES, and nothing it does not.
    # `check_gestures.py` compares this list against the CC handlers in
    # canvas.js, so a gesture added to one and not the other fails the build.
    # An undocumented gesture is one nobody finds; a documented one that does
    # not exist is worse.
    # ------------------------------------------------------------------
    ("Jog", "select chord", "silent &mdash; selecting is navigation, not performance"),
    ("Shift + Jog", "change bank", "Mute + Jog does the same, because Shift is not forwarded on every path"),
    ("Mute + Jog", "change bank", "the same as Shift + Jog"),
    ("Jog click (hold)", "play from the selected chord onward, and round the clip", "for exactly as long as you hold it; the playhead follows, transport or not"),
    ("Shift + Jog click", "insert a copy of the selected chord", "and follow it &mdash; you insert while editing something you want a variation of"),
    ("Mute + Jog click", "mute the selected chord", "the button says what it does. Drawn as an outline, so you still see what it would play &mdash; muting is not deleting"),
    ("Copy", "duplicate the whole progression", "twice as many chords; the clip grows to hold it, and it is refused if it would not fit"),
    ("Copy (hold)", "halftime", "every chord twice as long, so the phrase plays at half speed over twice the bars. Fires on RELEASE, and the screen says <code>RELEASE: HALFTIME</code> once you have held it long enough"),
    ("Mute + Copy", "double-time", "every chord half as long &mdash; the exact inverse of the hold, so the two round-trip. Refused at the floor rather than flattening the relative lengths"),
    ("Undo", "step back", "Move's own button. Every write is captured, so an ordinary shape edit undoes like a Duplicate does, and the clip length comes back with the chords"),
    ("Mute + Undo", "redo", "a new edit after undoing discards the branch"),
    ("Delete", "remove the selected chord", "a progression of one is the floor, since every add gesture copies the chord you are on"),
    ("Knob 1&ndash;8", "the cell above it on the current bank", "a trigger fires on a TURN, either direction, once per gesture &mdash; the click cannot be used, it plays a chord"),
    ("Touch a knob", "the row becomes that knob's full name and value", "eight cells is three glyphs each, which can label a control but never show its value"),
    ("Pad, bottom row", "select that chord and play it", "notes 68&ndash;75, left to right, and it is the chords on <strong>every bank</strong> &mdash; the one row your hand can trust without checking which page it is on. Holding sustains, exactly like holding the jog click; releasing stops. A pad past the end of the progression does nothing"),
    ("Pads, rows 2&ndash;4", "edit the selected chord", "one parameter per row, acting on whatever the bottom row selected. <strong>WRITE</strong> degree&middot;length&middot;quality, <strong>VOICE</strong> inversion&middot;colour&middot;octave, <strong>FEEL</strong> rhythm&middot;gate&middot;strum. A degree the scale does not have is dark and inert"),
    ("Up / Down", "page the parameter rows", "the set of three above the chords. The chord row never moves"),
    ("Left / Right", "scroll the parameter rows", "for lists longer than eight &mdash; 24 rhythms, 10 colours"),
    ("Mute + Left/Right", "page the chord row", "chords 1&ndash;8, then 9&ndash;16, clamping at both ends. The rare action goes behind the modifier: most progressions are under eight chords, while the option lists are long"),
    ("Back", "leave the grid", "the only way out &mdash; the jog click is claimed for playing"),
    ("CHD knob (Main)", "add several chords at once", "growing the count copies the last chord; while the buffer is still empty it divides the clip between the slots instead"),
]
gest = "".join(
    f'<tr><th scope="row">{g}</th><td>{d}</td><td class="note">{n}</td></tr>'
    for g, d, n in GESTURES)

NOTES = [
    ("VEL and GAT appear twice, and mean different things.",
     "On CHORD and VOICE they are a <em>± offset</em> for that one chord; on FEEL they are the "
     "<em>base</em> every chord is measured from. Chord banks offset, global banks set — "
     "consistent, but three characters cannot say so."),
    ("The banks are the levels.",
     "Every bank holds the same knobs in the same order as the knob page of the same name, so what "
     "you learn on one surface transfers to the other. "
     "<code>tests/host/test_stacks_shapes.sh</code> fails on any divergence. Two keys never appear: "
     "<code>grid</code> is the door you came through and <code>sel</code> is the jog, so neither spends a knob."),
    ("Grouping leads; Colour arranges; Shape chooses.",
     "Three axes, and none can express another. <em>Chord Shape</em> picks the chord. "
     "<em>Colour</em> arranges that one chord &mdash; close, dropped, shell, quartal. "
     "<em>Voice Grouping</em> is the only one that looks BETWEEN chords: it leads each "
     "voicing from the one before and places the progression in a register."),
    ("Copy is three actions, and two of them are inverses.",
     "A tap duplicates the progression, a HOLD halftimes it, and Mute+press double-times it. "
     "Doubling a chord's length IS halftime, so the third gesture has to be the inverse or two of "
     "the three do the same thing &mdash; a test asserts they round-trip exactly. The long press "
     "fires on RELEASE because <code>tick</code> has no <code>setParam</code>; it can only SEE the "
     "threshold pass, which is why the screen tells you what the release will do while you are "
     "still holding."),
    ("Shift belongs to the host on these buttons.",
     "<em>Shift&thinsp;+&thinsp;Copy</em> and <em>Shift&thinsp;+&thinsp;Delete</em> are Schwung's own "
     "snapshot and recall, and the shim withholds a shift-held press from a claimed CC entirely "
     "&mdash; the module gets the BARE buttons only. So the second gesture on Copy and Undo is "
     "<strong>Mute</strong>, which IS forwarded. The jog is unaffected: its claim is a different "
     "mechanism, so <em>Shift&thinsp;+&thinsp;Jog</em> and <em>Shift&thinsp;+&thinsp;Click</em> "
     "work as written."),
    ("A rhythm is a BAR; “hold” is not.",
     "Every figure covers one bar and repeats across the chord &mdash; a clave over a two-bar chord "
     "is two claves, which is what a clave is. <em>hold</em> is the degenerate mask, one hit at "
     "position 0, and tiling it re-articulates the chord every bar: a two-bar chord played AND drew "
     "as two one-bar chords. It was unreachable until <em>Length</em> became an absolute duration, "
     "because until then a chord and a rhythm shared one unit by construction."),
    ("The bottom row is the chords, always.",
     "It does not change with the knob bank, and it will not change when parameter rows arrive "
     "above it. That is the point: one row your hand can reach without first asking which page "
     "the surface is on. A test cycles every bank and checks a pad still selects the same chord, "
     "so a future row feature cannot quietly sweep the chord row into its paging."),
    ("The pad row is the progression.",
     "Notes 68&ndash;99 are four rows of eight, numbered bottom-left to top-right, so the row your "
     "hands rest on is chords 1&ndash;8 reading left to right &mdash; the same direction the staff "
     "reads. The LEDs carry four states the screen already computes (past the end, an empty slot, "
     "a written chord, the selected one) plus the chord that is SOUNDING, which is the one thing "
     "the pads show better than a 128&times;64 display: you can see it from across the room."),
    ("One hue per row, and the chords keep theirs.",
     "Three rows in the same colour were unreadable: eight lit pads look the same whether they are "
     "degrees or lengths. Rows 2&ndash;4 are green, blue and magenta <strong>by position</strong> "
     "&mdash; the second row is green on every page &mdash; so the hue tells you WHERE you are "
     "while the message tells you WHAT is there. The bottom row is excluded on purpose: it never "
     "changes meaning, so it must never change colour."),
    ("Every page movement says what it did.",
     "The arrows and pads are silent hardware, and the LEDs alone cannot answer it &mdash; eight "
     "lit pads look the same whether they are degrees or rhythms. So a movement that changes what "
     "a control MEANS puts a line on the staff, and it names the ROWS rather than just the page: "
     "<code>WRITE: DEG LEN FAM</code>, <code>CHORDS 9-16</code>. Transient, never modal &mdash; it "
     "is an answer to something you just did, not a state to keep reading."),
    ("The pads are a chord editor.",
     "The bottom row picks a chord; the three rows above edit that chord, one parameter per row, "
     "so the hand learns a PLACE rather than a sequence. <em>Up/Down</em> page the set of three "
     "and <em>Left/Right</em> scroll a row through a list longer than eight. The chords stay on "
     "<em>Mute&thinsp;+&thinsp;Left/Right</em>: the frequent action belongs on the bare button, "
     "and most progressions are under eight chords while Rhythm has 24 figures."),
    ("Taking the pads is a GLOBAL switch.",
     "<code>host_pad_block</code> stops pad notes reaching Move and forwards them here &mdash; for "
     "every module, not just this one. So it is taken in <code>onOpen</code> and released in "
     "<code>onClose</code>, and all 32 are handed back <strong>dark</strong>: Move writes a pad "
     "LED only when its own value changes, so one left lit stays lit on its track until something "
     "else moves it. Taking it once is not enough either &mdash; the host RELEASES it whenever "
     "nothing on screen wants the pads, including when the display is dismissed, so the overlay "
     "re-asserts every visible frame. Ownership is continuous; the owner sets, the host clears."),
    ("Colour is VOICING. Adding a note is SHAPE.",
     "Colour used to be a density ladder &mdash; triad, 7th, 9th &mdash; and every rung of it "
     "produced a chord that ALREADY EXISTS as a shape: <code>maj7</code>, <code>add9</code>, "
     "<code>maj9</code>, <code>11</code>, <code>13</code> and the altered dominants are all in "
     "the table. It was a second, slower route to Shape. What Shape cannot express is how a "
     "chord is <em>arranged</em>, so that is what Colour is now, and the old <em>Spread</em> "
     "knob is absorbed into it rather than sitting beside it meaning half the same thing."),
    ("FAM and SHP are one value, not two.",
     "<em>Chord Shape</em> is the chord; <em>Shape Family</em> is the coarse knob onto that same "
     "value, crossing all 38 in six steps. Family keeps no state, and it is the destructive one "
     "&mdash; leaving a family and returning lands on its first chord, so a <code>sus4</code> "
     "taken to 7th and back is a <code>maj</code>. Colour, by contrast, always undoes."),
    ("Harmony lives on MAIN, and it is live.",
     "Key, Octave Default and Scale are not load-time settings. Turning Key <em>transposes</em> "
     "whatever is in the buffer, Octave Default moves it by whole octaves, and Scale re-snaps it "
     "&mdash; whether the chords came from a library, a clip, or your own hands. Browsing on "
     "<em>Start</em> lands material in that harmony and never overwrites it, so setting the key "
     "first and setting it afterwards reach the same notes."),
    ("CHD, RTE and BAR: music, seed, window.",
     "<em>Length</em> is an ABSOLUTE duration &mdash; eighths of a bar, so 8 is one bar, always. "
     "<em>New Chord Len</em> only seeds it: it chooses what a newly created chord gets and cannot "
     "reach one that already exists. <em>Chords</em> &times; <em>Length</em> is how much music "
     "there is, and <em>Clip Bars</em> is the window you keep. Everything that lengthens the music "
     "grows the window to fit; only <em>Clip Bars</em> can make it smaller, because saying so is "
     "its job."),
    ("Rate used to redefine another control's units.",
     "<em>Length</em> was counted in units of Rate, so turning Rate changed what every existing "
     "length MEANT: the same four chords were 4 bars at &ldquo;1 bar&rdquo; and 8 at &ldquo;2 "
     "bar&rdquo;, and a library entry played at whatever scale happened to be selected &mdash; a "
     "<code>12-bar</code> blues was 6 bars at &ldquo;1/2&rdquo; and 24 at &ldquo;2 bar&rdquo;, "
     "where it truncated against the 16-bar clip. One control silently redefining the units of "
     "another caused three separate bugs before it was named."),
    ("The clip follows the music until you say otherwise.",
     "<em>Clip Bars</em> fits what you have written, in both directions, so browsing a twelve-bar "
     "blues and then something shorter leaves a four-bar clip rather than four bars looping three "
     "times in a stale twelve. Turn it yourself and that becomes your answer: it stops following, "
     "and from then on only grows &mdash; music is never truncated behind your back. <em>Clear</em> "
     "returns it to fitting."),
    ("The clip is the loop, and browsing grows it.",
     "<em>Clip Bars</em> is the single loop length for all three surfaces. Two bugs used to hide "
     "each other here: browsing did not grow the clip, so a twelve-bar blues loaded into four "
     "bars lost two thirds of itself &mdash; silently, with the chords still drawn on screen &mdash; "
     "and the sequencer looped at the PROGRESSION length while the playhead looped at the CLIP "
     "length, so the two agreed only when the bars happened to be a multiple of the phrase."),
    ("It opens on FOUR EMPTY BARS.",
     "Four one-bar slots in a four-bar clip, in A minor &mdash; all rests, so nothing has been "
     "written for you. It is the ordinary shape, so you turn <em>Chord Shape</em> four times and "
     "have a progression rather than inserting three slots first. Empty is never ZERO chords: "
     "every add gesture copies the chord you are on, which is also why <em>Delete</em> has a floor "
     "of one. This is a chord sequencer, so it hands you no progression you did not write &mdash; "
     f"<em>Start</em> offers {N_PROGS} to begin from, and <em>Clear</em> returns to exactly this."),
    ("While empty, any TWO of CHD, RTE and BAR settle the third.",
     "Four chords at two bars gives an eight-bar clip; four chords in an eight-bar clip gives "
     "two-bar slots. Whichever you turned <strong>last</strong> is the one that wins, and all "
     "three orders land in the same place. A REST is not music you wrote, which is why Rate may "
     "re-length a slot here and never a chord you have written. It sets the <em>lengths</em>, not "
     "the rate: Rate has four values, so BARS/CHORDS lands on one only when the answer is exactly "
     "2, 1, &frac12; or &frac14; bars &mdash; three chords over eight needs 21.33 units and no "
     "rate can say it. The staff's empty hint shows what the division came out as."),
    ("Starting from nothing: the first move is an EDIT.",
     "On an empty buffer there is nothing to add TO, so you do not add &mdash; you turn "
     "<em>Chord Shape</em> and the rest becomes a chord, in your Key at your Octave Default. "
     "From there <strong>Shift&nbsp;+&nbsp;Click</strong> inserts a copy of the chord you are on "
     "and follows it, which is the gesture you will use most: you insert while editing something "
     "you want a variation of, then change its Root or Shape. To add several at once, turn "
     "<em>Chords</em> on MAIN &mdash; growing the count copies the last one."),
    ("The playhead costs no reads.",
     "<code>draw</code> and <code>tick</code> are handed a context with <code>getParam</code> "
     "removed, so a position cannot be polled. It is extrapolated instead, from the transport and "
     "tempo in shared memory and the step length the module publishes, re-anchored on every read from the position the module reports. "
     "It disappears when the transport stops &mdash; a frozen head and a "
     "stopped transport look identical, and one of them is a lie."),
    ("Touch a knob and it takes the whole row.",
     "Eight cells is three glyphs each &mdash; enough to <em>label</em> a control and nowhere near "
     "enough to show its value. While a finger is on one knob the other seven labels are not "
     "needed, so the row becomes a status line for that one: full name, full value. It is what "
     f"makes 24 rhythms and {N_PROGS} progressions readable at all."),
    ("Every knob shows its resting value.",
     "The <em>default</em> on each cell is what you get before you touch anything — the module "
     "boots into <em>A minor</em>, i&ndash;VI&ndash;III&ndash;VII. Triggers have none: they fire "
     "and return to off."),
    ("Triggers on knobs fire on a turn.",
     "The click plays a chord, so the marked parameters respond to the encoder rather than a press."),
]
notes = "".join(f"<div class='note-card'><h3>{t}</h3><p>{b}</p></div>" for t, b in NOTES)

total = sum(1 for _, ks in banks for k, _ in ks if k)

pathlib.Path(a.out).parent.mkdir(parents=True, exist_ok=True)
pathlib.Path(a.out).write_text(f'''<title>Stacks Control Matrix</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
:root {{
  --ground:#EDF1F4; --panel:#FFFFFF; --ink:#0E1419; --muted:#5C6B78;
  --line:#D3DCE3; --accent:#B45309; --prog:#1F6B85;
  --screen:#090C0F; --phosphor:#D7E6F0; --screen-line:#232B33;
  --shadow:0 1px 2px rgba(14,20,25,.06), 0 8px 24px rgba(14,20,25,.05);
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    --ground:#080B0E; --panel:#11161B; --ink:#E4EBF1; --muted:#8496A4;
    --line:#1D252D; --accent:#FFB454; --prog:#79BDD4;
    --screen:#05070A; --phosphor:#DCE8F0; --screen-line:#1B222A;
    --shadow:0 1px 0 rgba(255,255,255,.03), 0 12px 32px rgba(0,0,0,.5);
  }}
}}
:root[data-theme="dark"] {{
  --ground:#080B0E; --panel:#11161B; --ink:#E4EBF1; --muted:#8496A4;
  --line:#1D252D; --accent:#FFB454; --prog:#79BDD4;
  --screen:#05070A; --phosphor:#DCE8F0; --screen-line:#1B222A;
  --shadow:0 1px 0 rgba(255,255,255,.03), 0 12px 32px rgba(0,0,0,.5);
}}
* {{ box-sizing:border-box; }}
body {{
  margin:0; background:var(--ground); color:var(--ink);
  font:400 15px/1.6 "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
  -webkit-font-smoothing:antialiased;
}}
.wrap {{ max-width:1080px; margin:0 auto; padding:44px 24px 72px; }}

.masthead {{ display:flex; flex-wrap:wrap; align-items:flex-end; gap:20px 32px;
  padding-bottom:22px; border-bottom:2px solid var(--ink); }}
.masthead h1 {{
  font:700 clamp(38px,7vw,64px)/.92 "Chakra Petch", ui-sans-serif, sans-serif;
  letter-spacing:-.02em; margin:0; text-wrap:balance;
}}
.masthead p {{ margin:0; max-width:46ch; color:var(--muted); }}
.stats {{ margin-left:auto; display:flex; gap:26px;
  font:500 12px/1 "IBM Plex Mono", ui-monospace, monospace; color:var(--muted); }}
.stats b {{ display:block; font:700 22px/1.2 "Chakra Petch", sans-serif; color:var(--ink);
  font-variant-numeric:tabular-nums; }}

h2, h3 {{ text-wrap:balance; }}
.eyebrow {{ font:500 11px/1 "IBM Plex Mono", monospace; letter-spacing:.16em;
  text-transform:uppercase; color:var(--muted); margin:52px 0 16px; }}

.bank {{ background:var(--panel); border:1px solid var(--line); border-radius:3px;
  box-shadow:var(--shadow); overflow:hidden; margin-bottom:20px; }}
.bank__head {{ display:flex; flex-wrap:wrap; align-items:baseline; gap:6px 18px;
  padding:16px 20px 14px; border-bottom:1px solid var(--line);
  border-left:3px solid var(--prog); }}
.bank--chord .bank__head {{ border-left-color:var(--accent); }}
.bank__head h2 {{ margin:0; font:700 24px/1 "Chakra Petch", sans-serif;
  letter-spacing:.04em; color:var(--prog); }}
.bank--chord .bank__head h2 {{ color:var(--accent); }}
.scope {{ margin:0; color:var(--muted); font-size:14px; }}
.scope strong {{ color:var(--ink); font-weight:600; }}
.page {{ margin:0 0 0 auto; font:400 12px/1 "IBM Plex Mono", monospace; color:var(--muted); }}
.page code {{ color:var(--ink); }}

/* The device's own label row. Dark in BOTH themes: the hardware display is
   dark, and a light "screen" would be a picture of something that does not
   exist. */
.screen {{ display:grid; grid-template-columns:repeat(8,1fr);
  background:var(--screen); border-bottom:1px solid var(--line); }}
.screen span {{ padding:9px 2px; text-align:center; color:var(--phosphor);
  font:500 12px/1 "IBM Plex Mono", monospace; letter-spacing:.06em;
  border-right:1px solid var(--screen-line); }}
.screen span:last-child {{ border-right:0; }}

.grid {{ display:grid; grid-template-columns:repeat(4,1fr); }}
.knob {{ position:relative; display:flex; flex-direction:column; gap:4px;
  padding:15px 15px 14px; border-right:1px solid var(--line);
  border-bottom:1px solid var(--line); min-height:150px; }}
.grid .knob:nth-child(4n) {{ border-right:0; }}
.grid .knob:nth-child(n+5) {{ border-bottom:0; }}
.pos {{ position:absolute; top:9px; right:11px;
  font:400 10px/1 "IBM Plex Mono", monospace; color:var(--muted); }}
.code {{ font:500 17px/1.1 "IBM Plex Mono", monospace; letter-spacing:.04em;
  color:var(--prog); }}
.bank--chord .code {{ color:var(--accent); }}
.name {{ font-size:14px; font-weight:600; line-height:1.3; }}
.rng {{ font:400 11.5px/1.4 "IBM Plex Mono", monospace; color:var(--muted);
  font-variant-numeric:tabular-nums; padding-top:6px; }}
.desc {{ font-size:12.5px; line-height:1.45; color:var(--muted); }}
.rng {{ margin-top:auto; }}
.key {{ opacity:.6; }}
/* The resting value, marked so it is not read as part of the range. */
.dflt {{ color:var(--ink); }}
.dflt::before {{ content:"default "; color:var(--muted); }}
.trig {{ display:inline-block; margin-left:5px; padding:1px 5px; border-radius:2px;
  border:1px solid var(--line); font:500 9px/1.5 "IBM Plex Mono", monospace;
  letter-spacing:.08em; text-transform:uppercase; color:var(--muted);
  vertical-align:middle; }}
.knob--empty {{ background:repeating-linear-gradient(-45deg,
  transparent 0 6px, var(--line) 6px 7px); opacity:.5; }}

table {{ width:100%; border-collapse:collapse; background:var(--panel);
  border:1px solid var(--line); border-radius:3px; box-shadow:var(--shadow); }}
th, td {{ text-align:left; padding:11px 16px; border-bottom:1px solid var(--line);
  font-size:14px; vertical-align:top; }}
tr:last-child th, tr:last-child td {{ border-bottom:0; }}
tbody th {{ font:500 14px/1.5 "IBM Plex Mono", monospace; white-space:nowrap;
  width:1%; color:var(--ink); }}
td.note {{ color:var(--muted); font-size:13px; }}

.notes {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(272px,1fr)); gap:14px; }}
.note-card {{ padding:16px 18px; border-left:2px solid var(--line); }}
.note-card h3 {{ margin:0 0 5px; font-size:14px; font-weight:600; }}
.note-card p {{ margin:0; font-size:13.5px; color:var(--muted); }}
code {{ font:400 .92em/1 "IBM Plex Mono", monospace; }}
em {{ font-style:normal; color:var(--ink); }}

footer {{ margin-top:52px; padding-top:18px; border-top:1px solid var(--line);
  font:400 12px/1.7 "IBM Plex Mono", monospace; color:var(--muted); }}
@media (max-width:720px) {{
  .grid {{ grid-template-columns:repeat(2,1fr); }}
  .grid .knob:nth-child(4n) {{ border-right:1px solid var(--line); }}
  .grid .knob:nth-child(2n) {{ border-right:0; }}
  .grid .knob:nth-child(n+5) {{ border-bottom:1px solid var(--line); }}
  .grid .knob:nth-child(n+7) {{ border-bottom:0; }}
  .page {{ margin-left:0; }}
}}
</style>

<div class="wrap">
  <header class="masthead">
    <div>
      <h1>Stacks</h1>
      <p>Control matrix for the chord-progression MIDI FX on Ableton Move.
         {len(banks)} banks of eight encoders, reached by <strong>Shift&nbsp;+&nbsp;Jog</strong>
         in the note grid or by paging the knob view. Opens on four empty bars; <em>Start</em>
         holds {N_PROGS} progressions in three libraries to begin from &mdash;
         {N_GENRE} voiced by genre, {N_COMMON} common and {N_UNCOMMON} uncommon.</p>
    </div>
    <div class="stats">
      <span><b>{len(banks)}</b>banks</span>
      <span><b>{total}</b>knobs</span>
      <span><b>38</b>chords</span>
    </div>
  </header>

  <p class="eyebrow">Banks</p>
  {"".join(sections)}

  <p class="eyebrow">Not on a knob &mdash; gestures</p>
  <table><tbody>{gest}</tbody></table>

  <p class="eyebrow">Worth knowing</p>
  <div class="notes">{notes}</div>

  <footer>
    Generated from <code>module.json</code> and <code>canvas.js</code> by
    <code>tools/stacks/gen_matrix.py</code> &mdash; regenerate after any knob change.
  </footer>
</div>
''')
print(f"wrote {a.out}  ({len(banks)} banks, {total} knobs)")
