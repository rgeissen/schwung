/*
 * INVERSION IS ONE LADDER THROUGH ZERO, NOT TWO HALVES THAT MIRROR.
 *
 * Up rotates the LOWEST voice an octave up; down rotates the HIGHEST voice an
 * octave down. Each detent moves exactly ONE voice, so a sweep of -3..+3 walks
 * the voicing steadily and the ends sit an octave below and above root.
 *
 * It used to do |inv| UPWARD rotations and then drop the whole chord an
 * octave, which is a different operation wearing the same name. On a triad
 * that made -1 and -2 the +1 and +2 voicings moved down -- the halves mirrored
 * instead of continuing -- and made -3 byte-identical to inv=0: a wasted
 * position in the middle of a seven-step control.
 *
 *      -3  48 52 55   <- the same chord as 0
 *      -1  40 43 48       (the +1 voicing, an octave down)
 */
#include <stdio.h>
#include <string.h>
#include "../../src/modules/midi_fx/stacks/dsp/stacks.c"
static void lg(const char*m){(void)m;} static float bp(void){return 120.f;}

static int notes(stk_t*s,int*o){
  return chord_notes_g(&s->prog.ch[0], s->octave, s->prog.scale, s->prog.key,
                       s->prog.ch[0].colour, 0, NULL, 0, o, 16);
}
int main(void){
  host_api_v1_t h; memset(&h,0,sizeof h); h.log=lg; h.get_bpm=bp;
  move_midi_fx_init(&h);
  int bad = 0;

  for (const char *shape = "maj"; shape; shape = strcmp(shape,"maj") ? NULL : "maj7") {
    stk_t *s = (stk_t*)stk_create(NULL, NULL);
    stk_set_param(s, "sel", "1");
    stk_set_param(s, "shape", shape);
    stk_set_param(s, "root", "C3");

    int prev[16], pn = 0, seen[7][16], sn[7], idx = 0;
    printf("  %s:\n", shape);
    for (int i = -3; i <= 3; i++, idx++) {
      char b[8]; snprintf(b, sizeof b, "%d", i);
      stk_set_param(s, "inv", b);
      int o[16], n = notes(s, o);
      sn[idx] = n;
      for (int j = 0; j < n; j++) seen[idx][j] = o[j];

      /*
       * THE INVARIANT IS PER DETENT, and it is the only one that holds for
       * every voice count: one rotation moves exactly ONE voice, by exactly
       * one octave. Asserting "-3..+3 spans an octave" instead is true only
       * for a TRIAD -- three rotations of a four-voice chord move three of its
       * four voices, which is 19 semitones, not 24. My first version asserted
       * 24 for everything and failed the correct code.
       *
       * Both arrays are sorted, so the moved voice is found by removing the
       * common run: exactly one entry of `prev` must be absent from `o` and
       * exactly one entry of `o` absent from `prev`, differing by 12.
       */
      if (pn == n && pn > 0) {
        int gone = -1, came = -1, ndiff = 0;
        for (int a = 0; a < pn; a++) {
          int found = 0;
          for (int b = 0; b < n; b++) if (prev[a] == o[b]) { found = 1; break; }
          if (!found) { gone = prev[a]; ndiff++; }
        }
        int narr = 0;
        for (int b = 0; b < n; b++) {
          int found = 0;
          for (int a = 0; a < pn; a++) if (o[b] == prev[a]) { found = 1; break; }
          if (!found) { came = o[b]; narr++; }
        }
        if (ndiff != 1 || narr != 1 || came - gone != 12) {
          printf("    FAIL: inv %+d moved %d voice(s) by %d, want 1 voice by +12\n",
                 i, ndiff, ndiff == 1 ? came - gone : 0);
          bad = 1;
        }
      }
      printf("    inv=%+d ", i);
      for (int j = 0; j < n; j++) printf("%4d", o[j]);
      printf("\n");
      pn = n; for (int j = 0; j < n; j++) prev[j] = o[j];
    }

    /* 1. No two positions may be identical -- that is the wasted-slot bug. */
    for (int a = 0; a < 7 && !bad; a++)
      for (int b = a + 1; b < 7; b++) {
        if (sn[a] != sn[b]) continue;
        int same = 1;
        for (int j = 0; j < sn[a]; j++) if (seen[a][j] != seen[b][j]) same = 0;
        if (same) {
          printf("    FAIL: inv=%+d and inv=%+d are the same chord\n", a-3, b-3);
          bad = 1;
        }
      }

    /* 2. Strictly ascending: every step must move the voicing UP. */
    for (int a = 0; a + 1 < 7; a++) {
      if (seen[a][0] >= seen[a+1][0]) {
        printf("    FAIL: inv=%+d does not sit below inv=%+d\n", a-3, a-2);
        bad = 1;
      }
    }

    /*
     * 3. A TRIAD specifically returns to root position an octave up after
     *    three rotations -- three voices, three steps. This is the shape the
     *    ladder is easiest to reason about, so it is worth pinning; a
     *    four-voice chord does NOT reach an octave in three steps and must not
     *    be asserted to.
     */
    if (sn[3] == 3) {
      int span = seen[6][0] - seen[0][0];
      if (span != 24) {
        printf("    FAIL: triad -3..+3 spans %d semitones, want 24\n", span);
        bad = 1;
      }
    }
    stk_destroy(s);
  }

  printf("\n%s\n", bad ? "FAIL"
    : "inversion walks one continuous ladder; no position repeats another");
  return bad;
}
