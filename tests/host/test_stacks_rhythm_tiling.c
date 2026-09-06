/*
 * "HOLD" MEANS ONCE. EVERY OTHER FIGURE IS A BAR AND TILES.
 *
 * A rhythm mask covers one BAR and repeats across the chord -- a clave over a
 * two-bar chord is two claves, which is what a clave is. `hold` is the
 * degenerate mask, a single hit at position 0, and tiling it RE-ARTICULATES
 * the chord every bar: a two-bar chord came out as two one-bar chords, played
 * that way and drawn that way, so it read as the module splitting the chord.
 *
 * It only became reachable when `len` became an absolute duration. Before
 * that, a chord was measured in units of Rate, so the chord's length and the
 * rhythm's span were the same thing by construction and could never disagree.
 * Widening one without the other is what opened the gap -- which is why this
 * asserts the RELATIONSHIP (strikes per bar) rather than a fixed count.
 */
#include <stdio.h>
#include <string.h>
#include "../../src/modules/midi_fx/stacks/dsp/stacks.c"
static void lg(const char*m){(void)m;} static float bp(void){return 120.f;}

/* How many times the chord is struck, by distinct onset. */
static int strikes(const char *rhythm, const char *rate) {
    host_api_v1_t h; memset(&h,0,sizeof h); h.log=lg; h.get_bpm=bp;
    move_midi_fx_init(&h);
    stk_t *s = (stk_t*)stk_create(NULL, NULL);
    stk_set_param(s, "steps", "4");
    stk_set_param(s, "rate", rate);
    stk_set_param(s, "sel", "1");
    stk_set_param(s, "shape", "maj");
    stk_set_param(s, "rhythm", rhythm);
    s->pend_n = 0;
    arm_chord(s, 0, 0);
    int at[128], n = 0;
    for (int i = 0; i < s->pend_n; i++) {
        int seen = 0;
        for (int j = 0; j < n; j++) if (at[j] == s->pend[i].at) seen = 1;
        if (!seen && n < 128) at[n++] = s->pend[i].at;
    }
    stk_destroy(s);
    return n;
}

int main(void) {
    int bad = 0;

    /* 1. HOLD strikes once, whatever the chord's length. */
    for (const char *r = "1 bar"; r; r = strcmp(r,"1 bar") ? NULL : "2 bar") {
        int n = strikes("hold", r);
        printf("  hold, a %s chord            %d strike(s)  %s\n", r, n,
               n == 1 ? "ok" : "FAIL: the chord re-articulates");
        if (n != 1) bad = 1;
    }

    /* 2. A real figure tiles: twice the chord, twice the figure. */
    struct { const char *name; } figs[] = { {"quarter"}, {"son 3-2"}, {"eighth"} };
    for (unsigned i = 0; i < sizeof(figs)/sizeof(*figs); i++) {
        int one = strikes(figs[i].name, "1 bar");
        int two = strikes(figs[i].name, "2 bar");
        int ok = one > 1 && two == one * 2;
        printf("  %-9s 1 bar -> %2d, 2 bars -> %2d      %s\n",
               figs[i].name, one, two,
               ok ? "ok" : "FAIL: a bar-length figure must tile");
        if (!ok) bad = 1;
    }

    printf("\n%s\n", bad ? "FAIL"
        : "hold strikes once at any length; every other figure tiles per bar");
    return bad;
}
