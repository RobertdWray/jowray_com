# Evidence: photo GPS, place suggestions and MCP lookup (2026-11-06)

Plan: `docs/plans/2026-11-06-photo-gps-places.md` (§1.2 is summarised here). Refs #58.

Coordinates in this folder are rounded to 2 decimal places (about 1 km). No family photo, claim link or full-precision point is
committed. Test fixtures use the Statue of Liberty (40.689247 N, 74.044502 W) or the official Nominatim documentation examples.

## Method (2026-11-06, read-only)

- One read-only `SELECT` against the production database, using the `.env` credentials on Rob's instruction (plan R4), listed the
  READY media of memory `62a9a223-0555-47cc-9a38-3e41dbbe7820`.
- Each original was fetched from Blob storage with the storage service's `get` and parsed locally. Nothing was written. The script
  was a scratch file and is not committed.
- Nominatim `reverse` (`format=jsonv2`, `addressdetails=1`) was called by hand three times for the GPS photo's point, at zoom 18, 14
  and 10, with an identifying User-Agent, well inside the 1 request/second limit.

## Findings

| Media | File | Camera / software | GPS | Point (2 dp) |
|---|---|---|---|---|
| `b58bbb0c-…` | `IMG_0565.jpeg` | iPhone 7, iOS 12.1.4, taken 2019-03-15 | full GPS IFD, horizontal error 10 m | 28.40 N, 81.45 W |
| `52bb6436-…` | `IMG_5415.jpeg` | 384×512, software "Google" | no GPS IFD | — |

Nominatim reverse for the GPS photo's point:

| Zoom | Result |
|---|---|
| 18 | `name` "Grande Vista Golf Club", `category`/`type` `leisure`/`golf_course`, city Orlando, state Florida; the address also held a `house_number` (not recorded) |
| 14 | "Williamsburg" |
| 10 | "Orange County" |

Conclusions used by the plan:

- Production photos carry GPS in their originals, so the server reads it from the stored original (D2).
- Zoom 18 gives a named non-residential feature plus the town and state, which is what a label needs (D5). The house number in the
  address is why labels never use `house_number`, `road` or `postcode`.

## Research sources (why phones often send no GPS)

- Apple, WWDC23 "What's new in privacy" (session 10107, 11:28): "By default, all image metadata are included, but users can now choose
  to remove sensitive metadata, like location, from selected photos." https://developer.apple.com/videos/play/wwdc2023/10107/?time=688
- WebKit `Source/WebKit/UIProcess/ios/forms/WKFileUploadPanel.mm`: camera captures are re-encoded as JPEG without EXIF ("FIXME: Should
  EXIF data be maintained?"). https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/ios/forms/WKFileUploadPanel.mm
- Android, "Access media files from shared storage": "If your app uses scoped storage, the system hides location information by
  default." https://developer.android.com/training/data-storage/shared/media#media-location-permission
- Chromium issues 40721166 and 40287342: Chrome on Android lacks `ACCESS_MEDIA_LOCATION`, so picked photos arrive with zeroed
  coordinates and blank refs. https://issues.chromium.org/issues/40721166 and https://issues.chromium.org/issues/40287342
- ExifReader 4.51.0 README, GPS section: on Android, `accept="image/*"` on the file input is reported to strip GPS values.
  https://github.com/mattiasw/ExifReader/blob/v4.51.0/README.md#gps

## Runtime evidence

Filled in at step B9 (local e2e) and B12 (production smoke and device checks), plus the B6 share-UI check below.

### B6: place buttons on /share (2026-11-06, local `next dev -p 3107`, `PLACES_PROVIDER=stub`)

Run against the throwaway Neon branch `gps-e2e-20261106` with outbound email off, in an isolated Chrome DevTools context. Nothing
was sent: the check ends before Send (B9 does the full e2e). The fixtures are JPEGs generated with sharp at public points: the
Statue of Liberty, and the Nominatim reverse docs' example points (jsonv2 34.44 S 58.71 W, Bologna 44.50 N 11.34 E, Birmingham
52.55 N 1.82 W). One JPEG has no EXIF. None is a family photo.

| File | What it shows |
|---|---|
| `b6-liberty-gps.jpg`, `b6-no-gps.jpg`, `b6-docs-point-gps.jpg`, `b6-docs-bologna-gps.jpg`, `b6-docs-birmingham-gps.jpg` | The generated fixtures (2 KB each). |
| `b6-390-looking-up.png` | 390×844: after picking the Liberty photo, the polite live region under "Where?" says "Looking up where your photos were taken…". The lookup was held for 6 s by an in-page fetch delay so the moment could be captured. The region's text history was `""` → `"Looking up where your photos were taken…"` → `"From your photos:Photo location found near 40.69, -74.04 (test)Place names © OpenStreetMap contributors"`. |
| `b6-390-suggestion-before-tap.png` | 390×844: "From your photos:", one button "Photo location found near 40.69, -74.04 (test)" (`type="button"`, `aria-pressed="false"`, 297×80 px, at least the 56 px `min-h-tap`), and the link "Place names © OpenStreetMap contributors" to `https://www.openstreetmap.org/copyright`. Where is still empty: nothing fills itself. |
| `b6-390-suggestion-after-tap.png` | 390×844: the tap filled Where with the label, and the button shows pressed (`aria-pressed="true"`). Typing after it left the text editable and set `aria-pressed="false"`. |
| `b6-390-two-photos.png` | 390×844: two photos with points on one card give two buttons, in photo order. |
| `b6-390-a11y-after-remove.txt` | Accessibility snapshot after removing the photo: its suggestion is gone and the live region (`generic live="polite"`) is empty but still mounted. The person's Where text stays. Adding the no-GPS JPEG then left the region empty (0 px) and sent no lookup: one `POST /api/places/suggest` in the network log for the whole sequence. |
| `b6-1280-suggestion-after-tap.png` | 1280×800 (`roomy` two-column card): the button under Where, pressed after the tap. The wrapper and the input are the same width (391 px), so the row lays out as before; no horizontal scroll. |
| `b6-1280-a11y-after-tap.txt` | Verbose accessibility snapshot at 1280: `group "From your photos:"`, then `button "Photo location found near 40.69, -74.04 (test)" … pressed`, then `link "Place names © OpenStreetMap contributors"`. |

Also observed:
- The parser loads on demand [C14]. Before any photo, the page fetched only a 925-byte loader stub named after `lib/photo-gps.ts`,
  with no parser code in it. `node_modules/exifreader/src` (634 KB in dev, unminified) and `lib/photo-gps.ts` (8 KB) were fetched
  only after the first photo was picked.
- The browser console had no errors or warnings. The dev server log shows each `POST /api/places/suggest 200` and no errors.

### B6 fix round 1: a failed lookup is asked again on re-add (2026-11-06, same setup)

| File | What it shows |
|---|---|
| `b6f1-390-readd-after-failure.png` | 390×844. The page's `fetch` was wrapped so the first `POST /api/places/suggest` answered a faked `503 busy`: no buttons. After removing the photo and picking it again, a second request answered 200 and the button appeared, as shown. A third remove and re-add sent no request: the kept answer was reused. |
