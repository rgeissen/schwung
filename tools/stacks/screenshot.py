#!/usr/bin/env python3
"""
Grab Move's 128x64 OLED as ASCII (and optionally a PNG).

Reads /dev/shm/schwung-display-live over ssh -- the buffer the shim mirrors the
composited display into. It is SSD1306 page format, NOT row-major:

    byte = page * 128 + col,  page = row / 8,  bit = row % 8

so bit N of a byte is eight rows apart from bit N+1, and decoding it row-major
gives a picture that looks like interlaced noise rather than an obvious error.

Requires Global Settings -> display_mirror_enabled = true in features.json AND
a shim restart: load_feature_config() runs once at init.

    python3 tools/stacks/screenshot.py [--png out.png] [--host move.local]
"""
import subprocess, sys, argparse

W, H = 128, 64

ap = argparse.ArgumentParser()
ap.add_argument("--host", default="ableton@move.local")
ap.add_argument("--png")
ap.add_argument("--scale", type=int, default=4)
a = ap.parse_args()

# Raw binary over ssh: BusyBox has no base64, and its `od` lacks -A/-t, so
# the framebuffer comes back as bytes on stdout with text=False. Warnings from
# ssh land on stderr and cannot corrupt the frame.
raw = subprocess.run(
    ["ssh", a.host, "cat /dev/shm/schwung-display-live"],
    capture_output=True, timeout=30)
if raw.returncode != 0:
    sys.exit(f"ssh failed: {raw.stderr.decode(errors='replace').strip()}")
buf = raw.stdout
if len(buf) < 1024:
    sys.exit(f"short buffer: {len(buf)} bytes, expected 1024")

px = [[0]*W for _ in range(H)]
for row in range(H):
    page, bit = row // 8, row % 8
    for col in range(W):
        px[row][col] = (buf[page*128 + col] >> bit) & 1

lit = sum(sum(r) for r in px)
print(f"+{'-'*W}+")
for r in px:
    print("|" + "".join("#" if v else " " for v in r) + "|")
print(f"+{'-'*W}+")
print(f"{lit} of {W*H} pixels lit ({100*lit//(W*H)}%)")
if lit == 0:
    print("\nALL BLANK. Either display_mirror is off (needs features.json + a")
    print("shim restart) or nothing is drawing.")

if a.png:
    try:
        from PIL import Image
        im = Image.new("1", (W, H))
        im.putdata([px[y][x] for y in range(H) for x in range(W)])
        im = im.resize((W*a.scale, H*a.scale), Image.NEAREST)
        im.save(a.png)
        print(f"wrote {a.png}")
    except ImportError:
        print("(PIL not installed; skipped PNG)")
