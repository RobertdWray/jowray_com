# Privacy note

A small **Privacy** button in every page's footer opens Rob's plain-language note about the family alpha's recording and logging. It links visitors to `/how-it-was-built`.

**Status:** implemented and merged in [PR #61](https://github.com/RobertdWray/jowray_com/pull/61), `fffae58`, 2026-11-06 (verified from git). [Plan: Commit A](../plans/2026-11-06-privacy-note-and-diagram-viewer.md#commit-a-privacy-note). Local browser evidence is recorded; a note-specific preview or production check and use by real visitors are not recorded in the supplied sources.

## What we built

1. In the footer link row, **Privacy** follows **How this site was built**. It looks like a link but is a button, at least 44px tall. Each separator stays with the item after it when the row wraps on a phone.
2. Pressing it opens a centred note over a dimmed, inert page. Focus starts on the title. The exact rendered copy in `app/_components/privacy-note-client.tsx` matches Rob's approved copy (2026-11-06):

   **Privacy, the short version**

   "This website was vibe coded. We track everything to fix bugs. If you use the website, you accept that we record the screen, the logs and what you click and type, to make the site better."

   "This is just for family and friends, so I'm not doing a big nutso legal disclaimer that you have to click OK on. — Rob"

   "To see how this site works or read the source code, go to **How this site was built**."

3. **Close**, Esc, or a press and click both on the backdrop close it; native dialog behaviour returns focus to the element that had it when the note opened: **Privacy** in Chromium and when opened from the keyboard. After a mouse or touch open in Safari or macOS Firefox, which do not focus a clicked button, focus return is unverified (see **NOT RUN**). Clicking inside or on the border, or selecting text and releasing outside, keeps it open. The page behind cannot scroll or receive keyboard focus; Tab may reach browser chrome.
4. **How this site was built** closes the note before navigating to `/how-it-was-built`, including closing it on a modified click that opens a new tab. The footer survives client navigation.
5. The note is at most 560px wide, with 16px side gutters on the 390px phone check. On short screens, text scrolls above a separate Close row. The saved 375×480 and 844×390 checks show the focused link clear of that row.

## Why we built it

The [plan's Context A](../plans/2026-11-06-privacy-note-and-diagram-viewer.md#context) says the alpha's unmasked recordings were "disclosed only deep inside `/how-it-was-built`". The footer makes that disclosure reachable on every page. Rob's 2026-11-04 authorization is quoted in `lib/sentry/data-collection.ts` and [Sentry telemetry](./sentry-telemetry.md#why-we-built-it).

## Key decisions (Rob)

| Decision | Source |
|---|---|
| Placement: “the Privacy button goes in the footer link row, after "How this site was built". It does not float.” (Rob, 2026-11-06) | [Plan, Rob's decisions](../plans/2026-11-06-privacy-note-and-diagram-viewer.md#robs-decisions-2026-11-06) |
| Copy: “lightly tidied and signed "— Rob":”; title, three paragraphs and **Close** are reproduced verbatim above (Rob, 2026-11-06). | Same ruling |
| Agent's call 1, accepted at plan approval on 2026-11-06: "One branch, one PR, two commits" because both changes share the scroll lock and the design-rule exception. This is the only numbered "My calls" item concerning the note. | [Plan, My calls](../plans/2026-11-06-privacy-note-and-diagram-viewer.md#my-calls-say-if-any-are-wrong) |

## How it works

`SiteFooter` stays a Server Component; `PrivacyNote` owns the button and native `<dialog>`. The browser's `showModal()` supplies the top layer, inert page and Esc; the component focuses the title with `titleRef.current?.focus()` on a `tabIndex={-1}` heading, and the `html:has(dialog:modal)` CSS rule locks page scroll. `aria-labelledby` names it from the focused title; there is no `aria-describedby` for the multi-paragraph note. `open:flex` keeps the closed dialog hidden; the footer uses a wrapping `<div>`, since a `<p>` cannot contain the dialog's headings and paragraphs. [Plan citations C1–C15](../plans/2026-11-06-privacy-note-and-diagram-viewer.md#citations) record these choices. [Design §6](../../design/DESIGN.md#6-layout) records the 2026-11-06 exception to "no modals".

The note adds no storage, consent record or telemetry switch. Opening or closing it does not start or stop collection. "Everything" is Rob's wording: [Sentry's scrubber and accepted residuals](./sentry-telemetry.md#why-we-built-it) still apply to bearer secrets and protected headers.

### What the note says, and what the site does

| Data | What the site does | Covered by the note? / owning doc |
|---|---|---|
| Screen recordings | Sentry Session Replay is configured at 100%, with text, non-password inputs, media, placeholders, `title` and `aria-label` unmasked (`REPLAY_OPTIONS`, `maskAttributes: []`, D20). Password inputs stay masked. | Yes: "record the screen". [Sentry telemetry](./sentry-telemetry.md#what-we-built). |
| Logs | Pino no longer redacts contributor fields (R13, 2026-11-07); bearer values and protected headers remain redacted. Sentry receives logs and 100% traces under the alpha policy. | Yes: "the logs"; the rate and vendor are not named. [Sentry telemetry](./sentry-telemetry.md#how-it-works). |
| Clicks and typing | Replay captures interactions and unmasked input; same-origin request bodies are captured with scrubbing. | Yes: "what you click and type". [Sentry telemetry](./sentry-telemetry.md#how-it-works). |
| Page views to Vercel Analytics | The root layout mounts analytics with URL scrubbing and unsafe-route dropping; live intake is unverified. | Not explicit; Vercel page views are not named. [Analytics](./analytics.md). |
| Contributor email as Sentry identity | Email identifies the contributor on later events, replays and logs; name is user context too. | Typing is covered; using email as identity is not explicit. The linked page's "One honest note" mentions name and email. [Sentry telemetry](./sentry-telemetry.md#what-we-built). |
| Invitees | `Invite` stores first name, optional last name, normalized email, SHA-256 token hash, created time and optional revoked time, linked to the memorial. Authorized database operators can read these rows; anyone holding a valid personal link sees its greeting, name and email. The importer keeps raw share URLs in a private local ledger. Invitee names/emails may reach Sentry under R10; token/share-URL collection is forbidden apart from the accepted replay DOM URL and Vercel request-log residuals. Neon previews copy Invite rows (D17/F8). | Not explicit. [Invite links](./invite-links.md), [Sentry telemetry](./sentry-telemetry.md). |
| Photo GPS saved privately | The server reads the original and saves coordinates per photo, available through Rob's MCP tools, not site pages. Web copies strip GPS. | Not mentioned. [Media uploads §Photo GPS](./media-uploads.md#photo-gps). |
| Photo points sent to OpenStreetMap | With Nominatim enabled, uncached lookups send coordinates at 6 decimal places for a place name. On `/share`, this can happen when a photo is picked, before Send. Production enablement is unverified here. | Not mentioned. [Share form §Place suggestions](./share-form.md#place-suggestions-from-photos). |
| Public videos and voice recordings keep their metadata | On See memories a video or voice recording plays from its original file, so a visitor who saves it gets what the phone stored with it, which can include where and when it was recorded and which phone made it. Photos are still shown only from stripped copies. Rob's ruling, 2026-11-08 ([see-memories D16 as amended](../plans/2026-11-08-see-memories.md#rulings-log-what-why-cost-if-wrong), PR #94). | Not in the note. The privacy list on `/how-it-was-built` says it. [See memories §Public media](./see-memories.md#public-media). |
| Emails | SendGrid sends receipts with private links but no contributor text or pictures, and family alerts with contributor details and words but no links. Open/click tracking is off. Replies are forwarded through Cloudflare. | Not mentioned. [Email and cron](./email-and-cron.md#what-we-built), [Email replies and forwarding](./email-forwarding.md). |

### Replay masking and the server scrubber switch

D20 fixes SDK attribute masking: the SDK defaults star `placeholder`, `title` and `aria-label` even with `maskAllText: false`. `lib/sentry/replay-options.ts` sets `maskAttributes: []`; this is separate from server-side event filtering.

Under [notify plan R12 amended / §8.10](../plans/2026-11-07-notify-correspondents.md), the project's Data Scrubber and Default Scrubbers stayed on until PR-2 was live and its token checks passed. On 2026-11-08, with Rob's go-ahead, S1 turned both off, so ordinary story text is no longer replaced with `[Filtered]` ([evidence](../plans/evidence/2026-11-notify/post-merge.md)). The SDK scrubber is the token control. The accepted residuals include `/s/<token>` in replay DOM URLs (R5) and Vercel request logs (R11), alongside the existing claim-page and feedback-screenshot residuals.

## Operations and rollback

No setup, secrets or switches for the note. When alpha settings end, change its copy and the **One honest note** bullet in `app/how-it-was-built/page.tsx` **in the same commit as the settings**; update the bullet rather than deleting it. Both code comments require this ([plan C15](../plans/2026-11-06-privacy-note-and-diagram-viewer.md#c15--the-existing-alpha-telemetry-sync-note), [Sentry's M-F-11, ending the alpha](./sentry-telemetry.md#known-gaps-and-follow-ups)).

A note-only rollback removes its footer mount and component; it does not turn telemetry off. Keep the shared modal scroll rule for its other caller. After deployment, repeat the note checks below at desktop, phone and short-screen sizes. Broader rollback constraints live in [Admin](../admin.md#what-deleted-means).

## Key files

| Path | Role |
|---|---|
| **app** | |
| `app/_components/privacy-note-client.tsx` | Copy, focus, closing and navigation |
| `app/_components/site-footer.tsx`, `app/_components/field-classes.ts` | Placement, wrapping and 44px targets |
| `app/layout.tsx`, `app/global-error.tsx` | Footer on normal pages and the root error page |
| `app/globals.css`, `app/how-it-was-built/page.tsx` | Scroll lock; paired alpha disclosure |
| **scripts and docs** | |
| `scripts/privacy-diagrams-smoke.mjs`, `design/DESIGN.md` | Browser checks; modal exception |
| **Prisma** | None; no data model change |

## Tests and evidence

- [Evidence README](../plans/evidence/2026-11-06-privacy-and-diagrams/README.md) and [results](../plans/evidence/2026-11-06-privacy-and-diagrams/results.txt) record **57/57** checks for the whole PR, not 57 note checks. Git commit `c721d1f` records the final 16px-gutter fix and that result. The script drives headless Chrome against local `next dev` on `/obituary` and `/how-it-was-built`.
- Note checks cover footer placement/44px height, centring, title focus and labelling, scroll lock, Tab avoiding the inert page, Esc with focus return, backdrop/Close dismissal, interior/border/selection staying open, navigation closing the note, phone gutters, wrapping separators and short-screen Close/link visibility. Desktop and phone runs record no console errors. Close/backdrop checks assert dismissal; only the Esc check explicitly asserts note focus return.
- Screenshots in that evidence folder: **04/08** desktop/390px footer wrapping; **05/09** open notes; **11** Close visible at 375×553; **13/14** focused link clear of Close at 375×480 and 844×390. All seven were visually inspected for this document.
- [Plan Verification](../plans/2026-11-06-privacy-note-and-diagram-viewer.md#verification) requires `npm run validate`, `npm run test:run` and `npm run build:offline`, plus CI and a phone-width preview check. Merge commits `518ec85` and `8cb5ced` say checks were rerun, but give no command results or test count. The supplied plan/evidence contain no detailed npm or CI result; none is inferred from the merge.

**NOT RUN:** real iPhone/iPad Safari (focus return and scrolling text), Windows Firefox with classic scrollbars, and a recorded Vercel preview/production note check. The original note documentation recorded no npm rerun. The invite documentation checks are recorded in [Invite links](./invite-links.md#tests-and-evidence); they do not establish browser or production behaviour.

## Known gaps and follow-ups

- **Disclosure question, Low, Rob:** should the note explicitly cover provider names and sampling rates, Vercel page views, email used as Sentry identity, privately saved photo GPS, points sent to OpenStreetMap before Send, and email delivery/forwarding? These are not named in its text. This records coverage, not a proposed rewrite or a legal conclusion.
- **Plan follow-up "No real-device coverage yet", Medium:** the Safari and Windows Firefox checks above remain unrecorded.
- **Plan follow-up "Other links under DESIGN.md's 44px touch minimum", Low:** the footer email link remains outside the corrected link row; a wider touch-target pass is outstanding.
- **Plan follow-up "Safari with always-visible scrollbars shifts the page ~15px", Low:** recorded in Playwright WebKit; the CSS comment retains the limitation. Overlay scrollbars were unaffected in that record.
- **Plan/code differences:** copy agrees. Commit A's original `<p>` footer, target-only backdrop detection and whole-dialog scrolling are superseded by the implemented `<div>`, border-box check and separate text/Close regions. The latter two are recorded in the plan's review amendments; none is an outstanding fix.

## Related

- [Plan: Commit B: Diagram viewer](../plans/2026-11-06-privacy-note-and-diagram-viewer.md#commit-b-diagram-viewer) is the other half of PR #61 and is outside this document's scope.
- [README: Security and privacy, in one screen](../../README.md#-security-and-privacy-in-one-screen), [code layout](../code-layout.md), [domain](../domain.md), [environment](../environment.md), [dependencies](../dependencies.md), [admin](../admin.md).
