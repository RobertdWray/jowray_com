# Test fixtures

Non-personal images generated locally; CI needs no encoder.

- `tiny.heic`: 64×48 solid red, HEVC. `magick -size 64x48 xc:red /tmp/issue17-tiny.png && heif-enc --hevc -q 85 -o tiny.heic /tmp/issue17-tiny.png`
- `rotated.heic`: 64×48 red with a 16×16 blue square at the top-left, encoded with `--rotate-cw 90` so the decoded image is 48×64 with the blue square at the top-right (proves the decoder applies the HEIF rotation transform). `magick -size 64x48 xc:red -fill blue -draw 'rectangle 0,0 15,15' /tmp/issue17-oriented.png && heif-enc --hevc --rotate-cw 90 -q 85 -o rotated.heic /tmp/issue17-oriented.png`

Tools: ImageMagick `7.1.2-35`, libheif `heif-enc 1.23.7` (Homebrew), 2026-11-03.
