# Evidence: footer Privacy note and the diagram viewer (2026-11-06)

Plan: `docs/plans/2026-11-06-privacy-note-and-diagram-viewer.md`, verification step 2.

`scripts/privacy-diagrams-smoke.mjs` drives the installed Google Chrome (headless) through the repo's `playwright-core` against `next dev`, at
1280×900, 390×844 with touch, and the review rounds' extra sizes (320/412/640px footers, an 844×390 landscape phone, 375×553 and 375×480 short phones). One check runs in Playwright's WebKit instead (`npx playwright-core install webkit` if it is missing), because Chrome 145+ subtracts a reserved scrollbar gutter from `100vw` and so cannot show that bug. `results.txt` is its output on the final code: **56/56 checks passed** (33 from the build, 13 from review round 1, 10 from the Team Code Review round).

```sh
npx next dev -p 3107   # in the worktree
node scripts/privacy-diagrams-smoke.mjs "$PWD" http://localhost:3107 "$PWD/docs/plans/evidence/2026-11-06-privacy-and-diagrams"
```

| File | What it shows |
| --- | --- |
| `01-desktop-architecture-fitted.jpg` | Architecture diagram fitted to its card, with the toolbar in one row; Zoom out, Fit and the four arrows are dimmed (`aria-disabled`) at fit size |
| `02-desktop-architecture-zoomed.jpg` | The same after Zoom in |
| `03-desktop-fullscreen.jpg` | Full-screen view at 1280px |
| `04-desktop-footer.jpg` | Footer row: Jo's obituary · How this site was built · Privacy |
| `05-desktop-privacy-note.jpg` | The Privacy note open, centred |
| `06-phone-architecture-fitted.jpg` | Architecture fitted at 390px (no sideways overflow); the toolbar wraps to Zoom in and Zoom out, then Fit and the four arrows together, then Full screen |
| `07-phone-fullscreen.jpg` | Full-screen view at 390px: title and Close, then seven 44px icon controls in one row |
| `08-phone-footer.jpg` | Footer at 390px: each dot travels with the link after it; both lines are 44px tall |
| `09-phone-privacy-note.jpg` | The Privacy note at 390px |
| `10-landscape-fullscreen.jpg` | Full screen on an 844×390 landscape phone: one header row, a 307px-tall diagram area |
| `11-short-phone-privacy-note.jpg` | The note on a 375×553 phone: the text scrolls in its own area, and Close sits in a row below it |
| `12-desktop-architecture-panned.jpg` | Architecture zoomed in and moved with the inline → button |
| `13-short-phone-privacy-note-link-focused.jpg` | 375×480: "How this site was built" focused with Tab, inside the scrolling text and clear of Close |
| `14-landscape-privacy-note-link-focused.jpg` | The same on an 844×390 landscape phone |

Two things the checks caught while building, both fixed at the root:

1. **Ctrl/⌘ + wheel did not zoom.** react-zoom-pan-pinch treats a list of `activationKeys` as "all of these held"
   (`keys.every`), so `["Control", "Meta"]` needed both. The viewer now passes the function form
   (`keys.includes("Control") || keys.includes("Meta")`).
2. **The Tab check.** Tabbing past the note's last control leaves `document.activeElement` on `<body>`: Chrome moves
   focus to its own UI, which is native `<dialog>` behaviour. The check now asserts that focus never lands on the inert
   page behind the note, and it never does.

Not covered here: a real iPhone and iPad (Safari) pass, Windows Firefox with classic scrollbars, and the Vercel preview, which is checked after the PR opens.

## Independent review round 1 (before the PR opened)

A fresh reviewer found no critical defects; every point was fixed at the root and has a check in the script:

| # | Finding | Fix |
| --- | --- | --- |
| 1 | The dot before "Privacy" was hidden by screen width, not by where the row wraps (412–639px read as one link; 320px left a dangling dot) | Each dot is part of the item after it (a no-wrap pair), always shown |
| 2 | Zoom out disabled itself while focused, dropping focus to `<body>` | `aria-disabled` and a no-op click at fit size; focus stays |
| 3 | Landscape-phone full screen left a 155px-tall diagram area and a fixed 8× cap could not reach natural size | One header row from 640px up with 44px icon controls on narrow/short screens; the full-screen cap is `2 / fitted share`, recomputed by a ResizeObserver (10× for Data model at 844×390) |
| 4 | Selecting text in the note and releasing on the backdrop closed it | Closes only when the press and the click both land on the backdrop |
| 5 | Close fell below the fold on a 375×553 phone | Close row is sticky at the bottom of the scrolling note (replaced in the Team Code Review round: Close now sits outside the scrolling text) |
| 6 | The full-screen diagram area's focus ring was clipped | Ring drawn inside (`-outline-offset-4`) |
| 7 | `role="toolbar"` without arrow-key movement; instructions inside the `aria-label` | `role="group"`; the instructions moved to `aria-describedby` |
| 8 | Stale "scroller" comment in `detailed-diagrams.tsx` | Reworded |
| 9 | The page behind shifted when the dialog hid the scrollbar | `scrollbar-gutter: stable` while a modal dialog is open |

## Team Code Review round (after the PR opened)

George (Gemini) and Oscar (Codex) reviewed PR #61 at 2000e13. Each of the ten new checks failed on 2000e13 and passes now. What was not changed, and why, is in the plan's "Non-goals (Team Code Review round)".

| Finding | Fix | Check |
| --- | --- | --- |
| A press and release on the note's 3px border closed it (George 4, Oscar 4) | The backdrop is everything outside the dialog's border box: the press and the click must both be there | A border click keeps the note open; a backdrop click closes it |
| The full-screen dialog's `w-screen` (100vw) includes a classic scrollbar in Safari and Firefox, so Close could be clipped by about 15px (George 2, Oscar 3) | `w-full`: a modal dialog is `position: fixed`, so 100% is the window without the scrollbar | WebKit with a 15px scrollbar: the dialog (1265px) and Close fit the usable width (it was 1280px) |
| Zoomed inline, dragging was the only way to pan (George 5a) | ← ↑ ↓ → inline as well, always shown, 44px icon-only buttons everywhere | Four arrows, `aria-disabled` and inert at fit size; enabled and panning after Zoom in |
| The sticky Close row could sit over the focused link on a short screen (George 3, Oscar 2) | The text scrolls in its own area; Close is in a row below it. The dialog is `open:flex`, so the closed note stays hidden | 375×480 and 844×390: the focused link is inside the scrolling text, and the Close row starts below it (two checks) |
| Fit looked active at fit size, where it does nothing (George 6) | `aria-disabled` and a no-op press at fit size, like Zoom out | Fit is `aria-disabled` at fit size |
| An accidental double-tap while scrolling zoomed the card and made the next swipes pan it (George 5b) | Inline `doubleClick={{ disabled: true }}`; full screen keeps it | A desktop double-click and a phone double-tap leave the fitted diagram at scale 1 (two checks) |
| The obituary and how-it-was-built footer links were 27px tall beside the 44px Privacy button (George 7) | A shared `footerLinkClass` (44px, `inline-flex items-center`) for all three | Both links are ≥44px tall |

While writing the WebKit check: a scrollbar style added after load does not restyle WebKit's existing root scrollbar, and one placed directly in `<html>` is removed by React's hydration, so the check adds it to `<head>` on `DOMContentLoaded`.
