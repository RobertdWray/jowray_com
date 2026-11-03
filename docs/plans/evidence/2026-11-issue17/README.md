# Issue #17 evidence

## PR A (#25), preview deployment of `feat/derived-web-images` @ ad72f44, 2026-11-03

- `preview-heic-claim-page-chrome.jpg`: the claim page in Chrome (desktop) after uploading `__tests__/fixtures/rotated.heic` through `/share` on the Vercel preview. The HEIC renders upright (48×64, blue landmark top-right), so the worker-thread libheif decode, the HEIF rotation transform and the sanitized-only serving all work on Vercel's runtime, not only under Vitest.
- Observed in the browser (tokens redacted): inline `/api/media/<id>?t=…` → 302 to `preview/derived/<memoryId>/<uuid>.jpg` (48×64); `&v=thumb` → 302 to a second `preview/derived/…jpg` key; `&v=original` → the untouched `.heic` (Chrome downloads it, it cannot display HEIC). The served copy loaded with `naturalWidth × naturalHeight = 48 × 64`.
- Not yet measured: decode time and memory for a 24 MP iPhone HEIC on Vercel (plan V2/V13); run with a real phone photo before relying on the 30 MP ceiling.
