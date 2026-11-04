# Family admin page: local walk evidence (2026-11-04)

Branch `feat/admin-page`, walk run against commit `a823127` (the three walk fixes included), `next dev` on the Neon `dev` branch with throwaway `ADMIN_PAGE_SECRET` / `CRON_SECRET`, `OUTBOUND_ENABLED=false`, `OUTBOUND_ALLOWLIST=`, `ADMIN_ALERT_EMAILS=`. Chrome DevTools MCP in an isolated browser context. Synthetic rows only ("Phone Check" from an earlier walk; "Admin Walk" drafted here).

| Check | Result | File |
|---|---|---|
| B1 signed out; wrong key refused with no cookie; right key → `/admin` list; cookie `Path=/admin; Max-Age=2592000; HttpOnly; SameSite=lax` | pass | `b1-signed-out-1440.jpg`, `b1-wrong-key-1440.jpg` |
| B2 `curl -I /admin` → `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`; dev log contains the secret 0 times, shows only `POST /admin/enter`; Sentry tunnel body contains it 0 times | pass | dev log (not committed) |
| B3 `/admin/media/<id>` 404 without / with a garbage cookie; thumbnails 302 to the blob host; audio, video, HEIC (web copy) render | pass | `b13-detail-1440.jpg`, `b3-draft-gallery-1440.jpg` |
| B4 edit "when" + "where" → "Saved."; one ADMIN revision with exactly those keys | pass | history in `b13-detail-1440.jpg` |
| B5 two tabs: visibility saved in A; words saved in B → banner names "visibility", words intact; Save again → saved; A then stale on "words"; Reload → fields match the server | pass | `b5-stale-banner-1440.jpg` |
| B6 Approve → Hide → Back to pending, one revision each | pass | |
| B7 DRAFT: no Approve, "Waiting for them to press Share", New link → fresh `/m/<token>` works, old one shows not-found; Share on the claim page → PENDING, `contactOptIn` recorded, Approve offered | pass | `b7-new-link-1440.jpg` |
| B8 Delete (two-step) → read-only detail with Restore, thumbnails still render, Deleted (1); Restore → `purgedFiles: 0` | pass | `b8-deleted-detail-1440.jpg` |
| B9 local cron while deleted → `deletedBlobsRemoved: 0`, no emails, `errors: 0` | pass | |
| B10 draft form → link + copy + "The site will not email this"; same email + words → "Already drafted." with link and New link | pass | |
| B11 Sign out → signed-out page; a memory URL shows the signed-out page afterwards | pass | |
| B12 390 × 844 (emulated): no horizontal scroll on list, detail with a 9,879-character note and history; chips wrap to three rows; no tap target under 56 px | pass | `b12-list-390.jpg`, `b12-detail-390.jpg` |
| B13 1440 × 900: two columns, sticky rail scrolls independently; 2560 × 1440: three columns (440 / 1fr / 600) | pass | `b13-list-1440.jpg`, `b13-detail-2560.jpg` |
| B15 (final review) type new words, press Back to pending without saving, then Save → words intact through the status refresh, "Saved." with no stale banner, one revision with the note; a second save of another field is not stale | pass | |
| B14 replay of the `setStatus` POST without the cookie → `{"ok":false,"code":"unauthorized"}`; status unchanged; log shows only the POST line | pass | |

Findings fixed during the walk (commit `a823127`): the entry page now also reads a key from a fragment change on an already-open page; the back link and the title link meet the tap target; the two-column rule stops at 100rem so the three-column rule applies (the `wide` custom variant is emitted after the arbitrary `min-[…]` query and would otherwise win).
