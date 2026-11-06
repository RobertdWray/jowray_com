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

Filled in at step B9 (local e2e) and B12 (production smoke and device checks).
