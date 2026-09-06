/*
 * KEY, OCTAVE DEFAULT AND SCALE ARE LIVE, AND THEY LIVE ON MAIN.
 *
 * They used to be load-time settings, and the failure was quiet. Roots were
 * baked to absolute MIDI notes when a progression loaded and nothing ever
 * re-derived them, so turning Key afterwards did not transpose -- but it did
 * change which pitch classes were in the scale, and `chord_notes` re-snapped
 * SOME roots and not others. Measured on the old build, A -> C moved one chord
 * of four up a semitone and left three alone: a progression in neither key,
 * with no error anywhere.
 *
 * Four properties, and the last one is the one that makes the model coherent.
 */
#include <stdio.h>
#include <string.h>
#include "../../src/modules/midi_fx/stacks/dsp/stacks.c"
static void lg(const char*m){(void)m;} static float bp(void){return 120.f;}

static int roots(stk_t*st,int*out){
  for(int i=0;i<st->prog.count;i++){
    int o[16];
    if(chord_notes_g(&st->prog.ch[i], st->octave, st->prog.scale, st->prog.key, st->prog.ch[i].colour, 0, NULL, 0, o, 16) < 1) return -1;
    out[i]=o[0];
  }
  return st->prog.count;
}
/* Every chord moved by the SAME interval, and that interval is `want`. */
static int moved_uniformly(const int*a,const int*b,int n,int want,const char*tag){
  int d=b[0]-a[0], ok=(d==want);
  for(int i=1;i<n;i++) if(b[i]-a[i]!=d) ok=0;
  printf("  %-38s ",tag);
  for(int i=0;i<n;i++) printf("%+d ",b[i]-a[i]);
  printf("  %s\n", ok?"ok":(d!=want?"FAIL: wrong interval":"FAIL: not uniform"));
  return !ok;
}

int main(void){
  host_api_v1_t h; memset(&h,0,sizeof h); h.log=lg; h.get_bpm=bp;
  move_midi_fx_init(&h);
  int bad=0, a[STK_MAX_CHORDS], b[STK_MAX_CHORDS], n;

  /* 1. Key transposes the buffer, by the interval it names. */
  stk_t*s1=(stk_t*)stk_create(NULL,NULL);
  stk_set_param(s1,"common","I-V-vi-IV");
  n=roots(s1,a); stk_set_param(s1,"key","C"); roots(s1,b);
  bad |= moved_uniformly(a,b,n,3,"Key A->C transposes every chord");

  /* 2. Octave Default moves WHOLE octaves. A clamp that landed on any
   *    semitone would transpose into a different key. */
  n=roots(s1,a); stk_set_param(s1,"defoct","4"); roots(s1,b);
  bad |= moved_uniformly(a,b,n,12,"Octave Default 3->4 moves +12");

  /* 3. It applies to a buffer nothing browsed for -- the transform belongs to
   *    the buffer, not to the library. */
  stk_t*s2=(stk_t*)stk_create(NULL,NULL);
  stk_set_param(s2,"shape","min"); stk_set_param(s2,"steps","3");
  n=roots(s2,a); stk_set_param(s2,"key","C"); roots(s2,b);
  bad |= moved_uniformly(a,b,n,3,"a hand-built buffer transposes too");

  /* 4. THE CONVERGENCE. Setting the harmony before browsing and after
   *    browsing must reach the same notes, or the two controls disagree about
   *    what the progression is. */
  stk_t*p=(stk_t*)stk_create(NULL,NULL);
  stk_set_param(p,"common","I-V-vi-IV");
  stk_set_param(p,"key","C"); stk_set_param(p,"defoct","5");
  int na=roots(p,a);
  stk_t*q=(stk_t*)stk_create(NULL,NULL);
  stk_set_param(q,"key","C"); stk_set_param(q,"defoct","5");
  stk_set_param(q,"common","I-V-vi-IV");
  int nb=roots(q,b);
  int same=(na==nb);
  for(int i=0;i<na&&same;i++) if(a[i]!=b[i]) same=0;
  printf("  %-38s ","load-then-set == set-then-load");
  for(int i=0;i<na;i++) printf("%d ",a[i]);
  printf(" vs ");
  for(int i=0;i<nb;i++) printf("%d ",b[i]);
  printf("  %s\n", same?"ok":"FAIL: the two orders disagree");
  if(!same) bad=1;

  /* 5. A library entry must not write Scale -- the harmony is the user's. */
  stk_t*r=(stk_t*)stk_create(NULL,NULL);
  stk_set_param(r,"scale","Dorian");
  stk_set_param(r,"common","I-V-vi-IV");   /* a MAJOR entry */
  char sc[32]; stk_get_param(r,"scale",sc,sizeof sc);
  printf("  %-38s %-8s  %s\n","Scale survives a library load",sc,
         strcmp(sc,"Dorian")==0?"ok":"FAIL: browsing overwrote Scale");
  if(strcmp(sc,"Dorian")) bad=1;

  printf("\n%s\n", bad ? "FAIL"
    : "Key, Octave Default and Scale transform the buffer, and browsing lands in them");
  stk_destroy(s1); stk_destroy(s2); stk_destroy(p); stk_destroy(q); stk_destroy(r);
  return bad;
}
