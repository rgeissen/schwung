/*
 * UNDO IS A RING OF WHOLE PROGRESSIONS, AND IT RESTORES EXACTLY.
 *
 * Two things are easy to get almost right here, and both were wrong first.
 *
 * The capture point: this module has forty keys that can touch the buffer, so
 * a hand-kept list of "the mutating ones" is wrong the first time a key is
 * added -- and the symptom is an edit that silently cannot be undone,
 * discovered only after the work is gone. Capture therefore happens once, at
 * the end of EVERY write, by comparing against the newest stored state.
 *
 * The extent: `bars` lives outside stk_prog_t, and both Duplicate and Double
 * Length grow it. A history holding only the chords put the notes back and
 * left the clip stretched -- an undo that half-undoes, which is worse than
 * none because you stop trusting the button. Measured before the fix: undoing
 * a stretch restored lengths 16 -> 8 and left bars at 16 instead of 4.
 */
#include <stdio.h>
#include <string.h>
#include "../../src/modules/midi_fx/stacks/dsp/stacks.c"
static void lg(const char*m){(void)m;} static float bp(void){return 120.f;}

static int check(const char*what,int got,int want,int*bad){
  int ok = got==want;
  printf("  %-40s %3d %s %-3d %s\n", what, got, ok?"==":"!=", want,
         ok?"ok":"FAIL");
  if(!ok) *bad=1;
  return ok;
}
int main(void){
  host_api_v1_t h; memset(&h,0,sizeof h); h.log=lg; h.get_bpm=bp;
  move_midi_fx_init(&h);
  int bad=0;
  stk_t*s=(stk_t*)stk_create(NULL,NULL);

  stk_set_param(s,"common","I-V-vi-IV");
  int c0=s->prog.count, b0=s->bars, l0=s->prog.ch[0].len;

  /* Double Length: every chord twice as long, clip grown to hold it. */
  stk_set_param(s,"stretch","on");
  check("stretch doubles chord length", s->prog.ch[0].len, l0*2, &bad);
  check("stretch grows the clip",       s->bars,           b0*2, &bad);
  check("stretch does NOT add chords",  s->prog.count,     c0,   &bad);

  /* Duplicate: twice as many chords, same lengths. */
  stk_set_param(s,"duplicate","on");
  check("duplicate doubles the count",  s->prog.count,     c0*2, &bad);

  /* Undo restores BOTH halves of what each edit changed. */
  stk_set_param(s,"undo","on");
  check("undo 1 restores the count",    s->prog.count,     c0,   &bad);
  check("undo 1 restores the bars",     s->bars,           b0*2, &bad);
  stk_set_param(s,"undo","on");
  check("undo 2 restores the length",   s->prog.ch[0].len, l0,   &bad);
  check("undo 2 restores the bars",     s->bars,           b0,   &bad);

  stk_set_param(s,"redo","on");
  check("redo re-applies the stretch",  s->prog.ch[0].len, l0*2, &bad);
  check("redo re-applies the bars",     s->bars,           b0*2, &bad);

  /*
   * An ORDINARY parameter edit is undoable too -- that is the whole point of
   * capturing on every write rather than on a list of "big" operations.
   */
  stk_set_param(s,"sel","2");
  char before[24]; stk_get_param(s,"shape",before,sizeof before);
  stk_set_param(s,"shape","dim");
  char during[24]; stk_get_param(s,"shape",during,sizeof during);
  stk_set_param(s,"undo","on");
  char after[24]; stk_get_param(s,"shape",after,sizeof after);
  printf("  %-40s %s -> %s -> %s  %s\n","a plain shape edit undoes",
         before,during,after,
         (!strcmp(after,before) && strcmp(during,before)) ? "ok"
           : "FAIL: an ordinary edit was not captured");
  if(strcmp(after,before) || !strcmp(during,before)) bad=1;

  /* A new edit after undoing discards the redo branch: the future you were
   * walking back into no longer follows from the present. */
  stk_set_param(s,"shape","aug");
  check("editing after undo drops redo", s->hist_ahead, 0, &bad);

  /* Undo never runs off the end of an empty history. */
  for (int i = 0; i < STK_UNDO_DEPTH * 2; i++) stk_set_param(s,"undo","on");
  check("undo bottoms out safely",       s->prog.count > 0, 1, &bad);

  /*
   * COPY IS THREE ACTIONS, AND THE TWO STRETCHES ARE INVERSES.
   *
   *   tap          duplicate    twice as many chords
   *   hold         halftime     each chord twice as long
   *   Mute+press   double-time  each chord half as long
   *
   * Doubling the length IS halftime, so the third gesture has to be the
   * INVERSE or two of the three do the same thing. Asserted as a round trip:
   * halftime then double-time must return the exact lengths, which is what
   * makes them a pair rather than two similar operations.
   */
  printf("\n");
  {
    stk_t *t = (stk_t*)stk_create(NULL, NULL);
    stk_set_param(t, "common", "I-V-vi-IV");
    stk_set_param(t, "sel", "1");
    stk_set_param(t, "len", "16");          /* make it uneven: 2/1/1/1 */
    int before[STK_MAX_CHORDS], n = t->prog.count;
    for (int i = 0; i < n; i++) before[i] = t->prog.ch[i].len;

    stk_set_param(t, "stretch", "on");
    stk_set_param(t, "compress", "on");
    int same = 1;
    for (int i = 0; i < n; i++) if (t->prog.ch[i].len != before[i]) same = 0;
    printf("  %-38s %s\n", "halftime then double-time round-trips",
           same ? "ok" : "FAIL: the two are not inverses");
    if (!same) bad = 1;

    /* Proportion is preserved, not flattened. */
    stk_set_param(t, "compress", "on");
    int prop = t->prog.ch[0].len == before[0] / 2
            && t->prog.ch[1].len == before[1] / 2;
    printf("  %-38s %d %d %s\n", "uneven lengths halve in proportion",
           t->prog.ch[0].len, t->prog.ch[1].len,
           prop ? "ok" : "FAIL: relative lengths changed");
    if (!prop) bad = 1;

    /* At the floor it refuses outright rather than flattening. */
    for (int i = 0; i < 8; i++) stk_set_param(t, "compress", "on");
    int floored = t->prog.ch[0].len >= 1 && t->prog.ch[1].len >= 1
               && t->prog.ch[0].len != t->prog.ch[1].len;
    printf("  %-38s %d %d %s\n", "at the floor it refuses, not flattens",
           t->prog.ch[0].len, t->prog.ch[1].len,
           floored ? "ok" : "FAIL: lengths collapsed together");
    if (!floored) bad = 1;
    stk_destroy(t);
  }

  printf("\n%s\n", bad ? "FAIL"
    : "undo captures every write and restores the progression AND the clip");
  stk_destroy(s);
  return bad;
}
