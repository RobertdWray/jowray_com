# Evidence: footer Privacy note and the diagram viewer (2026-11-06)

Plan: `docs/plans/2026-11-06-privacy-note-and-diagram-viewer.md`, verification step 2.

`scripts/privacy-diagrams-smoke.mjs` drives the installed Google Chrome (headless) through the repo's `playwright-core` against `next dev`, at
1280×900, 390×844 with touch, and the review round's extra sizes (320/412/640px footers, an 844×390 landscape phone, a 375×553 short phone). `results.txt` is its output on the final code: **46/46 checks passed** (33 from the build, 13 added for the review round below).

```sh
npx next dev -p 3107   # in the worktree
node scripts/privacy-diagrams-smoke.mjs "$PWD" http://localhost:3107 "$PWD/docs/plans/evidence/2026-11-06-privacy-and-diagrams"
```

| File | What it shows |
| --- | --- |
| `01-desktop-architecture-fitted.jpg` | Architecture diagram fitted to its card, with the toolbar; Zoom out disabled at fit size |
| `02-desktop-architecture-zoomed.jpg` | The same after Zoom in |
| `03-desktop-fullscreen.jpg` | Full-screen view at 1280px |
| `04-desktop-footer.jpg` | Footer row: Jo's obituary · How this site was built · Privacy |
| `05-desktop-privacy-note.jpg` | The Privacy note open, centred |
| `06-phone-architecture-fitted.jpg` | Architecture fitted at 390px (no sideways overflow) |
| `07-phone-fullscreen.jpg` | Full-screen view at 390px: title and Close, then seven 44px icon controls in one row |
| `08-phone-footer.jpg` | Footer at 390px: each dot travels with the link after it |
| `09-phone-privacy-note.jpg` | The Privacy note at 390px |
| `10-landscape-fullscreen.jpg` | Full screen on an 844×390 landscape phone: one header row, a 307px-tall diagram area |
| `11-short-phone-privacy-note.jpg` | The note on a 375×553 phone: the text scrolls, Close stays pinned at the bottom |

Two things the checks caught while building, both fixed at the root:

1. **Ctrl/⌘ + wheel did not zoom.** react-zoom-pan-pinch treats a list of `activationKeys` as "all of these held"
   (`keys.every`), so `["Control", "Meta"]` needed both. The viewer now passes the function form
   (`keys.includes("Control") || keys.includes("Meta")`).
2. **The Tab check.** Tabbing past the note's last control leaves `document.activeElement` on `<body>`: Chrome moves
   focus to its own UI, which is native `<dialog>` behaviour. The check now asserts that focus never lands on the inert
   page behind the note, and it never does.

Not covered here: a real iPhone and iPad (Safari) pass, and the Vercel preview, which is checked after the PR opens.

## Independent review round 1 (before the PR opened)

A fresh reviewer found no critical defects; every point was fixed at the root and has a check in the script:

| # | Finding | Fix |
| --- | --- | --- |
| 1 | The dot before "Privacy" was hidden by screen width, not by where the row wraps (412–639px read as one link; 320px left a dangling dot) | Each dot is part of the item after it (a no-wrap pair), always shown |
| 2 | Zoom out disabled itself while focused, dropping focus to `<body>` | `aria-disabled` and a no-op click at fit size; focus stays |
| 3 | Landscape-phone full screen left a 155px-tall diagram area and a fixed 8× cap could not reach natural size | One header row from 640px up with 44px icon controls on narrow/short screens; the full-screen cap is `2 / fitted share`, recomputed by a ResizeObserver (10× for Data model at 844×390) |
| 4 | Selecting text in the note and releasing on the backdrop closed it | Closes only when the press and the click both land on the backdrop |
| 5 | Close fell below the fold on a 375×553 phone | Close row is sticky at the bottom of the scrolling note |
| 6 | The full-screen diagram area's focus ring was clipped | Ring drawn inside (`-outline-offset-4`) |
| 7 | `role="toolbar"` without arrow-key movement; instructions inside the `aria-label` | `role="group"`; the instructions moved to `aria-describedby` |
| 8 | Stale "scroller" comment in `detailed-diagrams.tsx` | Reworded |
| 9 | The page behind shifted when the dialog hid the scrollbar | `scrollbar-gutter: stable` while a modal dialog is open |
