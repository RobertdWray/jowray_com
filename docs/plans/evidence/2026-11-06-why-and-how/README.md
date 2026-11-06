# Evidence: why and how the site was built (2026-11-06)

Plan: [`docs/plans/2026-11-06-why-and-how-built.md`](../../2026-11-06-why-and-how-built.md) (§8 lists the checks).

Browser: Chrome via chrome-devtools MCP, isolated context `why-built`, desktop Lighthouse. Server: `next dev -p 3106` in the worktree, Node 26.13.0.

## Baseline (before any edit), commit `95f4df4`

| File / check | URL | Viewport | Result |
|---|---|---|---|
| `baseline-home.json` (`#story` and footer `innerText`) | http://localhost:3106/ | default | saved |
| `baseline-obituary.json` (`main` and footer `innerText`) | http://localhost:3106/obituary | default | saved |
| Lighthouse accessibility | http://localhost:3106/ | desktop | 100, 0 failed audits (48 passed) |
| Lighthouse accessibility | http://localhost:3106/obituary | desktop | 100, 0 failed audits (47 passed) |
| Lighthouse accessibility | http://localhost:3106/share | desktop | 100, 0 failed audits (52 passed) |

No pre-existing accessibility findings, so any finding after the change is a regression (plan §8.7).

## After the change (branch `feat/why-and-how-built`, working tree on top of `66ee216`)

Same browser and server as the baseline. Viewports: `320x800x1,mobile`, `390x844x1,mobile`, `1280x900x1`, and `640x450x2` standing in for 1280 px at 200% zoom.

| Check (plan §8) | URL(s) | Result | Evidence |
|---|---|---|---|
| 8.2 `npm run validate`, `npm run test:run`, `npm run build:offline` | — | all exit 0; 1,221 tests (1,214 passed, 7 skipped: the DB integration suite without `TEST_DATABASE_URL`); build lists `○ /how-it-was-built` | ledger |
| 8.3 rendered-text diffs | `/`, `/obituary`, `/share` | obituary `main` identical; `#story` loses only the tagline; footer gains only "Kay, " and " · How this site was built" | `text-diffs.txt`, `after-*.json` |
| 8.4 no horizontal scroll | `/`, `/how-it-was-built`, `/obituary` at 320, 390, 640 (200% zoom), 1280 | `scrollWidth <= clientWidth` on every page and width; no text under 17px in `/how-it-was-built` `main` at 320 | screenshots below |
| 8.5 reading order | `/how-it-was-built` | h1, then h2 per section, h3 per diagram item; lists exposed with names and item counts 4, 5, 3, 4, 5; number badges and connectors absent from the tree | `a11y-tree-how-it-was-built*.txt` |
| 8.6 keyboard focus | `/how-it-was-built` | "Rob Wray" link and "See the code on GitHub" show `3px solid rgb(46, 36, 32)` (walnut), offset 2px, `:focus-visible` | `focus-github-1280.jpeg` |
| 8.7 Lighthouse accessibility | `/how-it-was-built` (desktop and mobile), `/`, `/obituary`, `/share` | 100 with 0 failed audits on each, same as the baseline: no regressions, nothing pre-existing to log (F5 not needed) | — |
| 8.8 footer smoke | `/share`, `/obituary`, `/how-it-was-built` | Kay, "Rob" → https://www.robwray.com, "Tracy" → https://tracycgold.com, both page links | `after-obituary.json`, a11y tree |
| 8.9 external links | robwray, tracycgold, GitHub repo | `HTTP/2 200`, no `location:` | — |

Screenshots: `how-it-was-built-320.jpeg` (full page), `how-it-was-built-390-trip.jpeg`, `how-it-was-built-390-stack.jpeg`, `how-it-was-built-1280-top.jpeg`, `how-it-was-built-1280-stack.jpeg`, `home-why-320.jpeg`, `home-why-320-actions.jpeg`, `home-why-390-actions.jpeg`, `home-why-1280.jpeg`, `home-story-1280.jpeg`, `focus-github-1280.jpeg`. The round "N" badge in the corner is the Next.js dev-mode indicator; it does not appear in production.

Not run by the agent: VoiceOver (plan N12); Rob's optional iPhone pass covers it.

## Detailed diagrams (R9), branch `feat/detailed-diagrams` on top of `d682edd`

Browser: Chrome via chrome-devtools MCP, isolated context `diagrams`. Server: `next dev -p 3107` in `/Users/rob/Documents/active_work/jowray_wt_diagrams`, Node 26.13.0. SVGs from `npx tsx scripts/make-readme-diagrams.ts` (Google Chrome 156, mermaid 12.2.0): `how-a-memory-travels.svg` 2174×1030, `architecture.svg` 2013×576, `data-model.svg` 1804×1542.

| Check | URL / viewport | Result | Evidence |
|---|---|---|---|
| `npm run validate`, `npm run test:run`, `npm run build:offline` | — | all exit 0; 1,237 tests (1,230 passed, 7 skipped); build lists `○ /how-it-was-built`; no Mermaid or Playwright code in `.next/static` or `.next/server` (the only hits are the package names in an inlined `package.json` list) | ledger steps 13–14 |
| Drift guard fails when it should | README "Architecture" label edited, test run, edit reverted | `× Architecture was rendered from the current README text`, with the regenerate command in the message | — |
| Natural size, no page scroll | `/how-it-was-built` at 320x800 mobile, 390x844 mobile, 640x450x2 (1280 at 200%), 1280x900 | `scrollWidth == clientWidth` at every width; each image renders at its natural size (e.g. 2174×1030) inside a region 345 px wide at 390; no text under 17px in `main` at 320 | `detailed-390-top.jpeg`, `detailed-390-architecture-scrolled.jpeg`, `detailed-320-data-model.jpeg`, `detailed-1280-top.jpeg`, `detailed-1280-data-model.jpeg` |
| Keyboard | 1280x900 | Shift+Tab from the first "Open … full size" link focuses the region "How a memory travels diagram, scrolls sideways"; `:focus-visible`, outline `rgb(46, 36, 32) solid 3px`, offset 2px; ArrowRight scrolls it (`scrollLeft` 0 → 80) | `detailed-1280-focus.jpeg` |
| Accessibility tree | 1280x900 | h2 "The detailed version", then per diagram: h3, description, region with its label, image with its `alt` as name and the description as `description`, the full-size link | `a11y-tree-detailed.txt` (taken before the sequence diagram's `alt` dropped "13", so a README edit cannot leave it stale) |
| Lighthouse accessibility | `/how-it-was-built`, desktop and mobile | 100, 0 failed (52 passed) on both; best practices and SEO 100 | — |
| Full-size link | `/diagrams/data-model.svg` | `200`, `Content-Type: image/svg+xml` | — |

Not run: Safari and a real iPhone (the SVGs use plain SVG text and embedded WOFF2, which Safari supports; Rob's preview pass covers it).
