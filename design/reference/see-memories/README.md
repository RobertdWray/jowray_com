# See memories: design reference

Rob's canvas "See memories" (exported 2026-11-07 as a single self-contained `See memories.html` bundle), unpacked here so the implementation can be compared with it. This is reference material only: nothing in `app/` imports it. The plan is `docs/plans/2026-11-08-see-memories.md`.

| Artboard | Source | Picture | Size |
|---|---|---|---|
| Explore: everything, filtered by place, time and tag | `Main.dc.html` | `Main.png` | 1280 × 2720 |
| Map view | `Map.dc.html` | `Map.png` | 1280 × 2150 |
| Timeline view | `Timeline.dc.html` | `Timeline.png` | 1280 × 2720 |
| Tag view | `Tags.dc.html` | `Tags.png` | 1280 × 2300 |
| One memory | `Memory.dc.html` | `Memory.png` | 1280 × 2050 |
| Phone: explore | `Phone-Explore.dc.html` | `Phone-Explore.png` | 390 × 2250 |
| Phone: map | `Phone-Map.dc.html` | `Phone-Map.png` | 390 × 1780 |
| Phone: timeline | `Phone-Timeline.dc.html` | `Phone-Timeline.png` | 390 × 2250 |
| Phone: one memory | `Phone-Memory.dc.html` | `Phone-Memory.png` | 390 × 1900 |
| Explore on large displays: three panes, no dead margins | `Main-XL.dc.html` | `Main-XL.png` | 2400 × 2000 |

- `*.dc.html` are the artboard sources exactly as the bundle held them, except that the two script references now name `dc-runtime.js` and `data/memories.js` instead of the bundle's internal ids. The design-canvas runtime (`dc-runtime.js`) and the fonts under `ds/jo-wray/fonts/` are not committed, so the sources do not run from this folder; read them for sizes, colours and copy, and use the PNGs for the look.
- `data/memories.js` is the canvas's seed data. Its first line says every contributor and memory in it is invented; none of it is a real memory.
- `ds/jo-wray/tokens.json` lists the design-system variables each artboard carries. They are the same tokens as the `@theme` block in `app/globals.css`.
- The PNGs were rendered with headless Chrome at each artboard's own size from the exported bundle, with the Fraunces and Atkinson Hyperlegible fonts from this repo's Fontsource packages.
- The copy about Jo's life (the eras, the hero sentences) comes from these artboards; Rob confirms the facts in review (plan decision D14).
