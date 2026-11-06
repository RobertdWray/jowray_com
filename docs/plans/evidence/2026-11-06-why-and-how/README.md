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

## Hotfix E7: quiet links to Rob's and Tracy's sites (branch `hotfix/quiet-personal-links`)

Viewport `1280x900x2` (desktop, 2x for legibility), same server and browser as above.

| Check | Result | Evidence |
|---|---|---|
| Computed style of the three personal links on `/` (signature, footer Rob and Tracy) | text `rgb(46, 36, 32)` (walnut, same as the parent), `underline 1px rgb(138, 114, 89)` (wood), offset 4px; the site link "How this site was built" stays `rgb(165, 13, 38)` | — |
| Contrast (WCAG luminance) | walnut text 11.23:1 on the darkest gingham square, 13.22:1 muslin, 14.87:1 paper; wood underline 3.37:1 darkest gingham, 3.97:1 muslin, 4.46:1 paper | — |
| Lighthouse accessibility | 100, 0 failed audits on `/obituary` (desktop), `/` (mobile), `/how-it-was-built` (desktop) | — |
| Lighthouse "Agentic Browsing" on `/` mobile | CLS 0.168. Production `main` (`95f4df4`) scores the same 0.168, so it is pre-existing (plan §12 F7) | — |
| Checks | validate, test:run (1,214 passed, 7 skipped), build:offline all exit 0 | — |

Screenshots: `quiet-links-home-1280.jpeg` (note signature and footer), `quiet-links-obituary-1280.jpeg`.
