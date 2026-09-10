/*
 * WHERE THE CHORDS ACTUALLY LAND, counted in MIDI clocks from Move's downbeat.
 *
 * Reported from the device as "the chords are stamped too early -- they don't
 * land on the exact timing", and it is the same off-by-one the shim already
 * carries a measured war story about (src/host/transport_grid.h):
 *
 *   `pulse` is zeroed on MIDI Start (0xFA) and INCREMENTED by every clock
 *   (0xF8) -- and per the MIDI spec the FIRST CLOCK AFTER START IS THE
 *   DOWNBEAT. So a counter written that way reads 1 at the downbeat, and
 *   anything firing at `pulse % BAR == 0` fires one clock EARLY, forever.
 *
 * The error is TEMPO-SCALED, which is what makes it worse than it sounds: one
 * clock is 20.8ms at 120 BPM and 125ms at 20 BPM. In a stamped clip it is
 * every note of every chord sitting just before the line it belongs on.
 *
 * This test counts clocks rather than trusting the reasoning: it drives the
 * module the way Move does -- Start, then clocks -- and records the clock
 * index at which each chord's first note-on is emitted. Clock index 0 is the
 * first clock after Start, i.e. the downbeat, so chord 1 must be emitted at
 * index 0 and chord 2 at exactly one chord-length of clocks later.
 */
#include <stdio.h>
#include <string.h>
#include "../../src/modules/midi_fx/stacks/dsp/stacks.c"
static void lg(const char *m){ (void)m; } static float bp(void){ return 120.f; }

/*
 * One tick per clock is enough: the module schedules on `pulse`, which only
 * moves when a clock arrives, so a tick between clocks can add nothing.
 *
 * Collected as ONSET CLOCKS rather than predicted note numbers -- a chord's
 * resolved pitches are computed inside the scheduler and are not stored on the
 * chord, and the question here is WHEN a chord starts, not which notes it is.
 */
static int onsets(stk_t *s, int clocks, int *at, int max_at) {
    uint8_t out[64][3]; int lens[64];
    int n_at = 0, last = -99;
    for (int c = 0; c < clocks; c++) {
        uint8_t clk = 0xF8;
        int got = 0;
        int n = stk_process_midi(s, &clk, 1, out, lens, 64);
        for (int i = 0; i < n; i++)
            if ((out[i][0] & 0xF0) == 0x90 && out[i][2] > 0) got = 1;
        n = stk_tick(s, 128, 44100, out, lens, 64);
        for (int i = 0; i < n; i++)
            if ((out[i][0] & 0xF0) == 0x90 && out[i][2] > 0) got = 1;
        /* One chord is several note-ons in one block; count the block, once. */
        if (got && c != last && n_at < max_at) { at[n_at++] = c; last = c; }
    }
    return n_at;
}

int main(void) {
    host_api_v1_t h; memset(&h, 0, sizeof h); h.log = lg; h.get_bpm = bp;
    move_midi_fx_init(&h);
    int bad = 0;

    stk_t *s = (stk_t *)stk_create(NULL, NULL);
    /* Two one-bar chords, no humanise and no swing: the only thing under test
     * is WHEN each chord starts. Chords 3 and 4 stay rests, so the only note
     * onsets in the two bars measured are the two being asked about. */
    stk_set_param(s, "clear", "on");
    stk_set_param(s, "hum_time", "0");
    stk_set_param(s, "swing", "0");
    stk_set_param(s, "rhythm", "hold");
    stk_set_param(s, "sel", "1");
    stk_set_param(s, "degree", "I");
    stk_set_param(s, "sel", "2");
    stk_set_param(s, "degree", "V");
    stk_set_param(s, "run", "on");
    int len1 = s->prog.ch[0].len;

    uint8_t start = 0xFA; uint8_t out[64][3]; int lens[64];
    stk_process_midi(s, &start, 1, out, lens, 64);
    /* Anything sounding BETWEEN Start and the first clock is early by
     * definition: the downbeat has not happened yet. */
    int pre = stk_tick(s, 128, 44100, out, lens, 64), pre_on = 0;
    for (int i = 0; i < pre; i++)
        if ((out[i][0] & 0xF0) == 0x90 && out[i][2] > 0) pre_on = 1;
    printf("  between Start and the first clock: %s\n",
           pre_on ? "FAIL: a chord sounded before the downbeat" : "silent, ok");
    if (pre_on) bad = 1;

    int at[8], n_at = onsets(s, BAR_CLOCKS * 2, at, 8);
    printf("  chord onsets, in clocks from the first clock:");
    for (int i = 0; i < n_at; i++) printf(" %d", at[i]);
    printf("\n");

    if (n_at < 2) {
        printf("  FAIL: expected two chord onsets in two bars, saw %d\n", n_at);
        return 1;
    }
    /* Clock 0 IS the downbeat (transport_grid.h), so chord 1 belongs there. */
    printf("  chord 1 on clock %d, expected 0                   %s\n", at[0],
           at[0] == 0 ? "ok" : "FAIL: not on the downbeat");
    if (at[0] != 0) bad = 1;
    printf("  chord 2 on clock %d, expected %d                  %s\n",
           at[1], len1 * UNIT_CLOCKS,
           at[1] == len1 * UNIT_CLOCKS ? "ok" : "FAIL: off the bar line");
    if (at[1] != len1 * UNIT_CLOCKS) bad = 1;

    stk_destroy(s);
    printf(bad ? "\nFAIL\n" : "\nPASS\n");
    return bad;
}
