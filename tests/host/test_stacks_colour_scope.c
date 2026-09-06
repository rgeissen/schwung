/*
 * COLOUR APPLIES TO TWO OF THE THREE LIBRARIES, AND THAT IS THE POINT.
 *
 * A Genre progression is a VOICING somebody chose: a jazz ii-V-I is
 * m7-dom7-maj7 because that is what makes it jazz. Letting a global Colour
 * flatten it to triads would quietly turn the library into something else --
 * so those chords are marked `styled` and Colour steps over them.
 *
 * Common and Uncommon are written as plain triads with no style of their own,
 * which is exactly what Colour is for. A chord you built by hand is unstyled
 * too: you chose its shape, so you may recolour it.
 *
 * The test asserts the DIFFERENCE, not each half on its own -- "colour works"
 * and "colour does nothing" are each satisfiable by a broken build.
 */
#include <stdio.h>
#include <string.h>
#include "../../src/modules/midi_fx/stacks/dsp/stacks.c"
static void lg(const char*m){(void)m;} static float bp(void){return 120.f;}

/*
 * The observable difference a VOICING makes is the SPAN -- lowest to highest
 * sounding note. Counting notes would miss it: drop2 moves a voice down an
 * octave and the count is unchanged, which is the whole point of a voicing.
 */
static int span(stk_t*st,int i){
  int out[16];
  int n=chord_notes_g(&st->prog.ch[i], st->octave, st->prog.scale, st->prog.key, st->prog.ch[i].colour, 0, NULL, 0, out, 16);
  if(n<1) return 0;
  int lo=out[0],hi=out[0];
  for(int j=1;j<n;j++){ if(out[j]<lo)lo=out[j]; if(out[j]>hi)hi=out[j]; }
  return hi-lo;
}
static int worst(stk_t*st){
  int m=0; for(int i=0;i<st->prog.count;i++){int v=span(st,i); if(v>m)m=v;} return m;
}

int main(void){
  host_api_v1_t h; memset(&h,0,sizeof h); h.log=lg; h.get_bpm=bp;
  move_midi_fx_init(&h);
  int bad=0;

  struct { const char *lib, *entry; int recolourable; } cases[] = {
    { "progression", "12-bar",     0 },   /* genre: styled */
    { "common",      "I-V-vi-IV",  1 },
    { "uncommon",    "Backdoor",   1 },
  };

  for(unsigned k=0;k<sizeof(cases)/sizeof(*cases);k++){
    stk_t*st=(stk_t*)stk_create(NULL,NULL);
    stk_set_param(st,cases[k].lib,cases[k].entry);
    int before=worst(st);
    stk_set_param(st,"colour","drop2");
    int after=worst(st);
    char rb[64]; stk_get_param(st,"colour",rb,sizeof rb);
    int moved = after>before;
    int ok = moved == cases[k].recolourable;
    printf("  %-11s %-11s span %d -> %d, reads back %-8s  %s\n",
           cases[k].lib, cases[k].entry, before, after, rb,
           ok ? "ok" : (cases[k].recolourable ? "FAIL: Colour was ignored"
                                              : "FAIL: Colour overwrote a style"));
    if(!ok) bad=1;
    stk_destroy(st);
  }

  /*
   * A chord you built by hand is unstyled, so it recolours like Common does --
   * and it must stay that way after a styled progression has been through the
   * buffer, or Clear would leave the flag behind and Colour would be dead on a
   * progression the user wrote themselves.
   */
  stk_t*st=(stk_t*)stk_create(NULL,NULL);
  stk_set_param(st,"progression","12-bar");  /* styled buffer ... */
  stk_set_param(st,"clear","1");                 /* ... thrown away */
  stk_set_param(st,"shape","maj7");              /* Clear leaves a REST; make it
                                                  * a chord, by hand, which is
                                                  * the case under test */
  int b0=worst(st);
  stk_set_param(st,"colour","drop2");
  int a0=worst(st);
  printf("  %-11s %-11s span %d -> %d                        %s\n",
         "(by hand)","default",b0,a0,
         a0>b0?"ok":"FAIL: a cleared buffer kept the old styling");
  if(a0<=b0) bad=1;
  stk_destroy(st);

  /*
   * COLOUR IS A LAYER; FAMILY REWRITES THE CHORD. Three knobs look like they
   * do the same job -- Family, Shape and Colour all change how dense a chord
   * sounds -- and the difference is WHERE the change is stored. Shape is the
   * chord and Family is the coarse knob onto that same value, so both are
   * destructive; Colour is applied to the intervals as they play and leaves
   * Shape alone. Assert both halves: "Colour is reversible" is only meaningful
   * beside "Family is not".
   */
  printf("\n");
  stk_t*f=(stk_t*)stk_create(NULL,NULL);
  stk_set_param(f,"common","I-V-vi-IV"); stk_set_param(f,"sel","1");
  char s0[32],s1[32],s2[32];
  stk_set_param(f,"shape","sus4");     stk_get_param(f,"shape",s0,sizeof s0);
  stk_set_param(f,"colour","7th");     stk_get_param(f,"shape",s1,sizeof s1);
  stk_set_param(f,"colour","written"); stk_get_param(f,"shape",s2,sizeof s2);
  int col_ok = !strcmp(s0,s1) && !strcmp(s0,s2);
  printf("  Colour over %-6s -> shape %-6s -> %-6s   %s\n", s0, s1, s2,
         col_ok ? "ok" : "FAIL: Colour rewrote Chord Shape");
  if(!col_ok) bad=1;

  stk_set_param(f,"shape","sus4");   stk_get_param(f,"shape",s0,sizeof s0);
  stk_set_param(f,"family","7th");   stk_get_param(f,"shape",s1,sizeof s1);
  stk_set_param(f,"family","triad"); stk_get_param(f,"shape",s2,sizeof s2);
  /* Family is EXPECTED to lose it -- it is a jump, and pinning that stops
   * anyone "fixing" Colour and Family into the same thing by accident. */
  int fam_ok = strcmp(s0,s1) && strcmp(s0,s2);
  printf("  Family over %-6s -> shape %-6s -> %-6s   %s\n", s0, s1, s2,
         fam_ok ? "ok (jump, not a layer)" : "FAIL: Family stopped writing Shape");
  if(!fam_ok) bad=1;
  stk_destroy(f);

  /*
   * A VOICING MUST NOT RENAME THE CHORD. Colour rearranges the notes it was
   * given; a shell or drop-2 Amaj7 is still an Amaj7, so the caption above the
   * staff stays put while the notes underneath it move. (While Colour was a
   * density ladder this was the opposite assertion -- it changed which chord
   * sounded, so the name had to follow. Pinning it the new way is what stops
   * the old apparatus creeping back.)
   */
  printf("\n");
  stk_t*g=(stk_t*)stk_create(NULL,NULL);
  stk_set_param(g,"shape","maj7");
  char first[24]=""; int moved=0;
  for (int i = 0; i < NUM_COLOURS; i++) {
    stk_set_param(g,"colour",COLOURS[i]);
    char pb[4096]; stk_get_param(g,"prog",pb,sizeof pb);
    const char *p = pb;
    for (int j = 0; j < 12 && p; j++) { p = strchr(p,'|'); if (p) p++; }
    char nm[24]; int j = 0;
    while (p && *p && *p != ',' && j < 23) nm[j++] = *p++;
    nm[j] = 0;
    if (!first[0]) snprintf(first,sizeof first,"%s",nm);
    if (strcmp(first,nm)) { printf("  FAIL: %s renamed the chord %s -> %s\n",
                                   COLOURS[i], first, nm); bad = 1; }
    if (span(g,0) != span(g,0)) {}
    printf("  %-9s %-8s span %2d\n", COLOURS[i], nm, span(g,0));
    if (i && span(g,0) != 11) moved = 1;   /* 11 = a close maj7 */
  }
  if (!moved) { printf("  FAIL: no voicing changed the spacing\n"); bad = 1; }
  stk_destroy(g);

  printf("\n%s\n", bad ? "FAIL"
    : "Colour voices Common/Uncommon, spares Genre, never rewrites Shape, never renames the chord");
  return bad;
}
