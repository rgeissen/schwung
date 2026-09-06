#include <stdio.h>
#include <string.h>
#include "../../src/modules/midi_fx/stacks/dsp/stacks.c"
static void lg(const char*m){(void)m;} static float bp(void){return 120.f;}
static void snap(stk_t*st,char*o,int n){ stk_get_param(st,"state",o,n); }
int main(void){
  host_api_v1_t h; memset(&h,0,sizeof h); h.log=lg; h.get_bpm=bp; move_midi_fx_init(&h);
  stk_t*a=(stk_t*)stk_create(NULL,NULL);
  /* build something that uses every field */
  /* All THREE browsers carry an index, and each one overwrites the buffer --
   * so set them in order and let the last one win. The two that lost still
   * have to come back, or reopening a preset puts you at the top of a library
   * you were half way down. */
  stk_set_param(a,"common","ii-V-I");
  stk_set_param(a,"uncommon","Backdoor");
  stk_set_param(a,"progression","Andalusian");
  stk_set_param(a,"key","F"); stk_set_param(a,"defoct","2");
  stk_set_param(a,"bars","8"); stk_set_param(a,"rate","1/2");
  stk_set_param(a,"velocity","77"); stk_set_param(a,"gate","55");
  stk_set_param(a,"swing","30"); stk_set_param(a,"hum_vel","40");
  stk_set_param(a,"hum_time","20"); stk_set_param(a,"roll_vel","on");
  stk_set_param(a,"lanes","diatonic"); stk_set_param(a,"preview","loop");
  stk_set_param(a,"sel","2");
  stk_set_param(a,"ccolour","shell"); stk_set_param(a,"cstrum","65");
  stk_set_param(a,"cvel","-20"); stk_set_param(a,"cgate","25");
  stk_set_param(a,"cmute","on"); stk_set_param(a,"rhythm","bossa");
  stk_set_param(a,"ctrans","-5");
  char s1[4096]; snap(a,s1,sizeof s1);
  printf("state (%d bytes):\n%.180s...\n\n", (int)strlen(s1), s1);

  /* restore into a fresh instance */
  stk_t*b=(stk_t*)stk_create(NULL,NULL);
  stk_set_param(b,"state",s1);
  char s2[4096]; snap(b,s2,sizeof s2);
  int same = strcmp(s1,s2)==0;
  printf("round trip: %s\n", same?"IDENTICAL":"DIFFERENT");
  if(!same){ printf(" a: %s\n b: %s\n", s1, s2); }
  /* spot-check the fields that used to be dropped */
  const char *k[]={"ccolour","cstrum","cvel","cgate","cmute","rhythm","ctrans",
                   "key","scale","bars","swing","hum_vel","preview","lanes",
                   "common","uncommon","progression","genre"};
  int bad=!same;
  for(unsigned i=0;i<sizeof(k)/sizeof(*k);i++){
    char x[64],y[64]; stk_get_param(a,k[i],x,sizeof x); stk_get_param(b,k[i],y,sizeof y);
    printf("  %-9s %-10s %s %s\n", k[i], x, strcmp(x,y)?"!=":"==", y);
    if(strcmp(x,y)) bad=1;
  }
  printf("\n%s\n", bad?"FAIL: a preset would not restore what it saved"
                      :"a preset restores the whole instrument");
  stk_destroy(a); stk_destroy(b); return bad;
}
