/*
 * ONE LOOP LENGTH: WHAT PLAYS, WHAT IS DRAWN, AND WHAT IS STAMPED.
 *
 * Two bugs met here, and they hid each other.
 *
 * 1. Browsing a progression did not grow the clip. A twelve-bar blues loaded
 *    into a four-bar clip left two thirds of itself outside: playing, drawn on
 *    the staff, and absent from anything Stamp wrote. Silent truncation with
 *    the chords visible on screen the whole time.
 *
 * 2. The sequencer looped at the PROGRESSION length while the playhead looped
 *    at the CLIP length, so the two agreed only when bars happened to be a
 *    multiple of the phrase. At bars=3 against a 4-bar progression the clip is
 *    24 units and the phrase 32: the head restarted three quarters of the way
 *    through the music, every lap.
 *
 * The invariant is that there is exactly ONE loop length -- the clip -- with
 * the progression tiling inside it.
 */
#include <stdio.h>
#include <string.h>
#include "../../src/modules/midi_fx/stacks/dsp/stacks.c"
static void lg(const char*m){(void)m;} static float bp(void){return 120.f;}

int main(void){
  host_api_v1_t h; memset(&h,0,sizeof h); h.log=lg; h.get_bpm=bp;
  move_midi_fx_init(&h);
  int bad=0;

  /*
   * --- 0. THE DEFAULT the module opens on -------------------------------
   *
   * Four one-bar slots in a four-bar clip, all rests. Pinned because it is
   * what every other assertion here starts from, and because "empty" moved
   * once already: a single rest was defensible (empty must not be ZERO chords,
   * since every add gesture copies the chord you are on) but it is not the
   * shape of anything anybody writes.
   */
  {
    stk_t *s = (stk_t*)stk_create(NULL, NULL);
    char rt[16]; stk_get_param(s, "rate", rt, sizeof rt);
    int ok = s->prog.count == 4 && s->bars == 4
          && strcmp(rt, "1 bar") == 0 && buffer_is_empty(&s->prog)
          && s->prog.ch[0].len == UNITS_PER_BAR;
    printf("  boot: CHD=%d RTE=%s BAR=%d, all rests   %s\n",
           s->prog.count, rt, s->bars,
           ok ? "ok" : "FAIL: not 4 chords / 1 bar / 4 bars");
    if (!ok) bad = 1;
    /* Clear must return to exactly that, not to whatever was left behind. */
    stk_set_param(s, "progression", "12-bar");
    stk_set_param(s, "clear", "on");
    stk_get_param(s, "rate", rt, sizeof rt);
    int same = s->prog.count == 4 && s->bars == 4 && buffer_is_empty(&s->prog);
    printf("  after CLR: CHD=%d RTE=%s BAR=%d          %s\n",
           s->prog.count, rt, s->bars,
           same ? "ok" : "FAIL: Clear does not return to the boot state");
    if (!same) bad = 1;
    stk_destroy(s);
  }
  printf("\n");

  /* --- 1. browsing grows the clip to hold what it loaded ----------------- */
  struct { const char *lib, *entry; } L[] = {
    { "common", "I-V-vi-IV" }, { "progression", "12-bar" },
    { "progression", "Coltrane" }, { "uncommon", "Backdoor" },
  };
  for (unsigned i = 0; i < sizeof(L)/sizeof(*L); i++) {
    stk_t *s = (stk_t*)stk_create(NULL, NULL);
    stk_set_param(s, L[i].lib, L[i].entry);
    int bu   = bar_units_for(&s->prog);
    int need = (prog_total_units(&s->prog) + bu - 1) / bu;
    int ok   = s->bars >= need;
    printf("  %-11s %-10s needs %2d bars, clip is %2d   %s\n",
           L[i].lib, L[i].entry, need, s->bars,
           ok ? "ok" : "FAIL: the clip truncates the progression");
    if (!ok) bad = 1;
    stk_destroy(s);
  }

  /*
   * --- 2. the sequencer's loop IS the clip -------------------------------
   *
   * Driven by pulses rather than inspected, because the bug was in the wrap
   * arithmetic and reading the constant back would have agreed with itself.
   * The chord index is recovered the way the scheduler recovers it, and the
   * position must return to the first chord exactly at the clip boundary.
   */
  printf("\n");
  int bars_cases[] = { 3, 4, 5, 8 };
  for (unsigned i = 0; i < sizeof(bars_cases)/sizeof(*bars_cases); i++) {
    stk_t *s = (stk_t*)stk_create(NULL, NULL);
    stk_set_param(s, "common", "I-V-vi-IV");
    char b[8]; snprintf(b, sizeof b, "%d", bars_cases[i]);
    stk_set_param(s, "bars", b);

    int unit = RATE_CLOCKS[s->prog.rate] / STEP_SUBDIV; if (unit < 1) unit = 1;
    int clip_u = clampi(s->bars, 1, 16) * bar_units_for(&s->prog);
    int total_u = prog_total_units(&s->prog);

    /* Walk one clip plus a little, recording where the phrase restarts. */
    int restart = -1;
    for (int u = 1; u < clip_u * 2; u++) {
      int pos = (u % clip_u);
      if (total_u > 0) pos %= total_u;
      if (pos == 0 && restart < 0 && u >= clip_u) restart = u;
    }
    int ok = (restart == clip_u);
    printf("  bars=%-2d  clip=%3d units, phrase=%3d   loop restarts at %3d   %s\n",
           s->bars, clip_u, total_u, restart,
           ok ? "ok" : "FAIL: the music loops somewhere other than the clip");
    if (!ok) bad = 1;
    stk_destroy(s);
  }

  /*
   * --- 3. EVERYTHING that lengthens the music grows the clip -------------
   *
   * Four things lengthen a progression and a fifth RESCALES it without
   * touching a chord: RTE changes what a LEN unit means, so the same four
   * chords are 4 bars at "1 bar" and 8 at "2 bar". Each could push the music
   * past the end of the clip, where it still plays and is still drawn but is
   * absent from anything Stamp writes.
   *
   * CHD and RTE were the two that never grew it, because the rule existed as
   * four copies of the same arithmetic and they got none. It is one function
   * now, and this asserts the OUTCOME at every door into it.
   */
  printf("\n");
  {
    struct { const char *key, *val, *what; } doors[] = {
      { "steps",     "8",     "CHD: more chords" },
      { "duplicate", "on",    "Copy: repeat the phrase" },
      { "stretch",   "on",    "Shift+Copy: hold each chord longer" },
    };
    for (unsigned i = 0; i < sizeof(doors)/sizeof(*doors); i++) {
      stk_t *s = (stk_t*)stk_create(NULL, NULL);
      stk_set_param(s, "common", "I-V-vi-IV");
      stk_set_param(s, doors[i].key, doors[i].val);
      int bu = bar_units_for(&s->prog);
      int need = (prog_total_units(&s->prog) + bu - 1) / bu;
      int ok = s->bars >= need;
      printf("  %-32s needs %2d bars, clip is %2d   %s\n",
             doors[i].what, need, s->bars,
             ok ? "ok" : "FAIL: the music runs past the end of the clip");
      if (!ok) bad = 1;
      stk_destroy(s);
    }

    /*
     * RATE IS THE OTHER EXCEPTION, and for the opposite reason: it must not
     * change the music AT ALL. `len` is an absolute duration now, so Rate only
     * chooses what a NEW chord gets. It used to redefine the unit every
     * existing length was counted in, which made a "12-bar" blues 6 bars at
     * "1/2" and 24 at "2 bar" -- one control silently redefining another's
     * units, and the cause of three separate bugs.
     *
     * This asserts the progression is IDENTICAL across every rate, so the old
     * behaviour cannot come back as "growing the clip to fit", which is what a
     * test written around the symptom would have allowed.
     */
    {
        static const char *const R[] = { "2 bar", "1 bar", "1/2", "1/4" };
        stk_t *r = (stk_t*)stk_create(NULL, NULL);
        stk_set_param(r, "common", "I-V-vi-IV");
        int u0 = prog_total_units(&r->prog), b0 = r->bars, l0 = r->prog.ch[0].len;
        int same = 1;
        for (unsigned i = 0; i < 4; i++) {
            stk_set_param(r, "rate", R[i]);
            if (prog_total_units(&r->prog) != u0 || r->bars != b0
                || r->prog.ch[0].len != l0) same = 0;
        }
        printf("  %-32s %d units, %d bars at every rate  %s\n",
               "RTE: cannot touch existing music", u0, b0,
               same ? "ok" : "FAIL: Rate changed a progression that already existed");
        if (!same) bad = 1;
        stk_destroy(r);

        /* ...but it DOES still set what a new chord gets, or it does nothing. */
        int seen[4], differ = 0;
        for (unsigned i = 0; i < 4; i++) {
            stk_t *n = (stk_t*)stk_create(NULL, NULL);
            stk_set_param(n, "rate", R[i]);
            stk_set_param(n, "clear", "on");
            seen[i] = n->prog.ch[0].len;
            if (i && seen[i] != seen[0]) differ = 1;
            stk_destroy(n);
        }
        printf("  %-32s new chord LEN %d/%d/%d/%d            %s\n",
               "RTE: still sets a NEW chord", seen[0], seen[1], seen[2], seen[3],
               differ ? "ok" : "FAIL: Rate has no effect at all now");
        if (!differ) bad = 1;
    }

    /*
     * THE CLIP FITS UNTIL YOU SAY OTHERWISE.
     *
     * Grow-only was the first rule and it was wrong: it cannot tell YOUR
     * twelve bars from a leftover twelve, so browsing the 12-bar blues and
     * then anything shorter left four bars of music looping three times in a
     * stale clip. Fitting both ways fixes that; latching on a manual BAR is
     * what keeps a clip you deliberately made longer.
     */
    {
        stk_t *a = (stk_t*)stk_create(NULL, NULL);
        stk_set_param(a, "progression", "12-bar");
        stk_set_param(a, "common", "I-V-vi-IV");     /* browse to a shorter one */
        int fit = a->bars == 4;
        printf("  %-32s clip is %2d              %s\n",
               "browse long then short: it fits", a->bars,
               fit ? "ok" : "FAIL: a stale clip survived browsing");
        if (!fit) bad = 1;
        stk_destroy(a);

        /* A clip you asked for is kept, even as the music shrinks under it. */
        stk_t *b = (stk_t*)stk_create(NULL, NULL);
        stk_set_param(b, "common", "I-V-vi-IV");
        stk_set_param(b, "bars", "8");
        stk_set_param(b, "steps", "2");
        int kept = b->bars == 8;
        printf("  %-32s clip is %2d              %s\n",
               "you set BAR=8, music shrinks", b->bars,
               kept ? "ok (your choice is kept)" : "FAIL: BAR was overridden");
        if (!kept) bad = 1;

        /* ...but nothing is EVER truncated silently, manual or not. */
        stk_set_param(b, "progression", "12-bar");
        int grew = b->bars >= 12;
        printf("  %-32s clip is %2d              %s\n",
               "manual, but music needs 12", b->bars,
               grew ? "ok (grows rather than truncate)"
                    : "FAIL: music runs past the clip");
        if (!grew) bad = 1;
        stk_destroy(b);
    }
  }

  /*
   * --- 4. EVERY DOOR, not a remembered list of them --------------------
   *
   * The fit was called from the four handlers somebody thought of, and `len`,
   * `off`, `insert` and `remove` were not among them -- so editing ONE chord's
   * length pushed the progression past the end of the clip: 5.375 bars of
   * music in a 4-bar clip, playing and drawn but absent from the stamp. It is
   * done once at the parameter door now, so this walks the keys that change
   * how much music there is and asserts the outcome for each.
   */
  printf("\n");
  {
    struct { const char *key, *val, *what; } doors[] = {
      { "len",       "16", "LEN: one chord made longer" },
      { "insert",    "on", "insert: one more chord" },
      { "duplicate", "on", "Copy" },
      { "stretch",   "on", "Shift+Copy" },
      { "steps",     "8",  "CHD" },
    };
    for (unsigned i = 0; i < sizeof(doors)/sizeof(*doors); i++) {
      stk_t *s = (stk_t*)stk_create(NULL, NULL);
      stk_set_param(s, "common", "I-V-vi-IV");
      stk_set_param(s, doors[i].key, doors[i].val);
      int bu = bar_units_for(&s->prog);
      int need = (prog_total_units(&s->prog) + bu - 1) / bu;
      int ok = s->bars >= need;
      printf("  %-32s music %2d bars, clip %2d   %s\n",
             doors[i].what, need, s->bars,
             ok ? "ok" : "FAIL: music runs past the end of the clip");
      if (!ok) bad = 1;
      stk_destroy(s);
    }
  }

  /*
   * --- 5. WHILE EMPTY, CHORDS AND BARS DIVIDE THE CLIP -------------------
   *
   * "Four chords over eight bars" gives four two-bar slots -- and only while
   * every slot is still a rest, because after that the lengths are yours.
   *
   * It sets the LENGTHS, not the rate. Rate has four values, so BARS/CHORDS
   * lands on one only when the answer is exactly 2, 1, 1/2 or 1/4 bars: three
   * chords over eight bars needs 21.33 units and no rate can say it. Deriving
   * the rate would have worked for the tidy cases and silently done nothing
   * for the rest, so the odd ratio is asserted here beside the tidy one.
   */
  printf("\n");
  {
    struct { int chd, bar, len; const char *note; } d[] = {
      { 4, 8, 16, "the tidy case: 2 bars each" },
      { 4, 4,  8, "1 bar each" },
      { 3, 8, 21, "odd ratio: no rate can say it" },
      { 5, 8, 12, "odd ratio" },
    };
    for (unsigned i = 0; i < sizeof(d)/sizeof(*d); i++) {
      char b[8];
      /* Both orders must reach the same place, or the two knobs disagree. */
      for (int order = 0; order < 2; order++) {
        stk_t *s = (stk_t*)stk_create(NULL, NULL);
        snprintf(b, sizeof b, "%d", order ? d[i].chd : d[i].bar);
        stk_set_param(s, order ? "steps" : "bars", b);
        snprintf(b, sizeof b, "%d", order ? d[i].bar : d[i].chd);
        stk_set_param(s, order ? "bars" : "steps", b);
        int ok = s->prog.ch[0].len == d[i].len;
        if (!order)
          printf("  CHD=%d over BAR=%-2d -> LEN %2d  %-30s %s\n",
                 d[i].chd, d[i].bar, s->prog.ch[0].len, d[i].note,
                 ok ? "ok" : "FAIL: wrong division");
        else if (!ok)
          printf("      FAIL: the other knob order gave LEN %d\n",
                 s->prog.ch[0].len);
        if (!ok) bad = 1;
        stk_destroy(s);
      }
    }

    /*
     * ANY TWO SETTLE THE THIRD, AND THE ONE TURNED LAST WINS.
     *
     * Rate participates too: a REST is not music you wrote, so "Rate cannot
     * reach a chord that already exists" must not apply to an empty slot.
     * Applying it there left CHD=4 + RTE="2 bar" as four ONE-bar slots in a
     * four-bar clip -- two of the three controls silently ignored.
     *
     * And dividing unconditionally broke the other direction: set Rate, then
     * Chords, and Chords overwrote the rate with a division of the old clip.
     * All three orders must land in the same place.
     */
    {
        const char *want = "4 slots of 2 bars in an 8-bar clip";
        struct { const char *k1, *v1, *k2, *v2; } order[] = {
            { "steps", "4",     "rate",  "2 bar" },
            { "steps", "4",     "bars",  "8"     },
            { "rate",  "2 bar", "steps", "4"     },
        };
        for (unsigned i = 0; i < 3; i++) {
            stk_t *t = (stk_t*)stk_create(NULL, NULL);
            stk_set_param(t, order[i].k1, order[i].v1);
            stk_set_param(t, order[i].k2, order[i].v2);
            int ok = t->prog.count == 4 && t->bars == 8
                  && t->prog.ch[0].len == 2 * UNITS_PER_BAR;
            printf("  %-5s=%-5s then %-5s=%-5s -> %d x %g bars, clip %2d  %s\n",
                   order[i].k1, order[i].v1, order[i].k2, order[i].v2,
                   t->prog.count,
                   (double)t->prog.ch[0].len / UNITS_PER_BAR, t->bars,
                   ok ? "ok" : "FAIL: not the same as the other orders");
            if (!ok) { bad = 1; (void)want; }
            stk_destroy(t);
        }
    }

    /* And a WRITTEN buffer is never re-divided. */
    stk_t *w = (stk_t*)stk_create(NULL, NULL);
    stk_set_param(w, "bars", "8");
    stk_set_param(w, "steps", "4");
    stk_set_param(w, "sel", "1");
    stk_set_param(w, "shape", "min");      /* now something is written */
    int before = w->prog.ch[0].len;
    stk_set_param(w, "bars", "12");
    int kept = w->prog.ch[0].len == before;
    printf("  %-32s LEN %d -> %d            %s\n",
           "written buffer, BAR changed", before, w->prog.ch[0].len,
           kept ? "ok (lengths are yours now)"
                : "FAIL: a written chord was re-divided");
    if (!kept) bad = 1;
    stk_destroy(w);
  }

  printf("\n%s\n", bad ? "FAIL"
    : "the clip is the loop: everything that lengthens the music grows it, and BAR still shrinks it");
  return bad;
}
