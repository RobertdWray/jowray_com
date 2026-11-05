# Test fixtures

Non-personal images generated locally; CI needs no encoder.

- `tiny.heic`: 64×48 solid red, HEVC. `magick -size 64x48 xc:red /tmp/issue17-tiny.png && heif-enc --hevc -q 85 -o tiny.heic /tmp/issue17-tiny.png`
- `rotated.heic`: 64×48 red with a 16×16 blue square at the top-left, encoded with `--rotate-cw 90` so the decoded image is 48×64 with the blue square at the top-right (proves the decoder applies the HEIF rotation transform). `magick -size 64x48 xc:red -fill blue -draw 'rectangle 0,0 15,15' /tmp/issue17-oriented.png && heif-enc --hevc --rotate-cw 90 -q 85 -o rotated.heic /tmp/issue17-oriented.png`

Tools: ImageMagick `7.1.2-35`, libheif `heif-enc 1.23.7` (Homebrew), 2026-11-03.
- `anim.gif`: two 32×32 frames (red, blue), loops; proves animated GIF output keeps its frames. `magick -size 32x32 xc:red xc:blue -set delay 20 -loop 0 anim.gif`
- `noise.png`: 1000×1000 random noise; its JPEG at q72 and q60 both exceed 350 KB, which is the thumbnail `too_large` case. `magick -size 1000x1000 xc:gray +noise Random -depth 8 noise.png`
- `anim-portrait.gif`: two 40×400 frames; proves the long-edge cap applies to a portrait animation (per-frame height). `magick -size 40x400 xc:red xc:blue -set delay 20 -loop 0 anim-portrait.gif`
- `anim-400.gif`: 400 identical 1×1 frames; over the 300-frame cap (issue #45). `magick -size 1x1 xc:red -duplicate 399 -set delay 5 -loop 0 anim-400.gif`
- `anim-400x10.gif`: 400 identical 10×10 frames (a 40,000-pixel strip); proves the pixel ceiling counts the whole strip of an animation. `magick -size 10x10 xc:blue -duplicate 399 -set delay 5 -loop 0 anim-400x10.gif`
