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
