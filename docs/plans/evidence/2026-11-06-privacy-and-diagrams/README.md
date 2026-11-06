# Evidence: footer Privacy note and the diagram viewer (2026-11-06)

Plan: `docs/plans/2026-11-06-privacy-note-and-diagram-viewer.md`, verification step 2.

`verify.mjs` drives the installed Google Chrome (headless) through the repo's `playwright-core` against `next dev`, at
1280×900 and at 390×844 with touch. `results.txt` is its output on the final code: **33/33 checks passed**.

```sh
npx next dev -p 3107   # in the worktree
node docs/plans/evidence/2026-11-06-privacy-and-diagrams/verify.mjs "$PWD" http://localhost:3107 "$PWD/docs/plans/evidence/2026-11-06-privacy-and-diagrams"
```

| File | What it shows |
| --- | --- |
| `01-desktop-architecture-fitted.jpg` | Architecture diagram fitted to its card, with the toolbar; Zoom out disabled at fit size |
| `02-desktop-architecture-zoomed.jpg` | The same after Zoom in |
| `03-desktop-fullscreen.jpg` | Full-screen view at 1280px |
| `04-desktop-footer.jpg` | Footer row: Jo's obituary · How this site was built · Privacy |
| `05-desktop-privacy-note.jpg` | The Privacy note open, centred |
| `06-phone-architecture-fitted.jpg` | Architecture fitted at 390px (no sideways overflow) |
| `07-phone-fullscreen.jpg` | Full-screen view at 390px, with the arrow buttons |
| `08-phone-footer.jpg` | Footer at 390px: "Privacy" on its own line, no dangling dot |
| `09-phone-privacy-note.jpg` | The Privacy note at 390px |

Two things the checks caught while building, both fixed at the root:

1. **Ctrl/⌘ + wheel did not zoom.** react-zoom-pan-pinch treats a list of `activationKeys` as "all of these held"
   (`keys.every`), so `["Control", "Meta"]` needed both. The viewer now passes the function form
   (`keys.includes("Control") || keys.includes("Meta")`).
2. **The Tab check.** Tabbing past the note's last control leaves `document.activeElement` on `<body>`: Chrome moves
   focus to its own UI, which is native `<dialog>` behaviour. The check now asserts that focus never lands on the inert
   page behind the note, and it never does.

Not covered here: a real iPhone and iPad (Safari) pass, and the Vercel preview, which is checked after the PR opens.
