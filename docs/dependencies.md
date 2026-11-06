# Dependencies: overrides and accepted advisories

`npm audit` is not clean, on purpose. This page records why, so nobody runs `npm audit fix --force`: every "fix" it offers for the findings below is a **downgrade** (`@sendgrid/mail@6.5.2`, `@vercel/blob@2.4.0`, `eslint-config-next@15.5.29`).

Last checked 2026-11-06 (`npm audit`: 4 low, all the deepmerge chain below).

## Overrides in `package.json`

npm cannot carry comments in `package.json`, so each override is explained here. Remove one as soon as its removal condition holds; `npm ls <package>` shows whether upstream has caught up.

| Override | Advisory | Why it is safe | Remove when |
| --- | --- | --- | --- |
| `@vercel/cli-config` → `zod: "$zod"` | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), high: zod `< 4.6.6` can exhaust memory on oversized constrained collections | `@vercel/blob@2.8.2` (latest) needs `@vercel/oidc@^3`, whose latest 3.x pins `@vercel/cli-config@0.3.1`, which pins `zod@4.1.11`. `$zod` gives it the root `zod` (`^4.6.7`), a minor upgrade within zod 4, and it dedupes to the copy the app already uses. | `@vercel/blob` depends on `@vercel/oidc` ≥ 4.0.6 (which brings `@vercel/cli-config` ≥ 0.3.6 and `zod ^4.6.6`). |
| `@typescript-eslint/typescript-estree` → `minimatch: "^11.0.1"` | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), moderate: minimatch `7.0.0 – 11.0.0` DoS by globparts amplification; first patched release 11.0.1, no 10.x backport | Dev-only (ESLint). typescript-estree 8.72.1 asks for `^10.2.2` but calls only the top-level `minimatch(path, pattern, { dot: true })` (`useProgramFromProjectService.js`), which minimatch 11 keeps unchanged; 11 removed `makeRe`, `AST`, `debug` and internal methods it does not use. `npm run validate` passes with it. | `@typescript-eslint/typescript-estree` depends on `minimatch` ≥ 11.0.1. |

## Accepted, not fixable upstream

| Advisory | Path | Why it is accepted |
| --- | --- | --- |
| [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), low: deepmerge `mergeObject()` prototype poisoning | `@sendgrid/mail@8.1.6` → `@sendgrid/helpers@8.0.0` → `deepmerge@4.3.1` (all latest) | No patched deepmerge exists (affected range `>= 4.2.0, <= 4.3.1`, `first_patched_version: null`). SendGrid calls deepmerge only in `Personalization#deepMergeDynamicTemplateData`, which returns early when `dynamicTemplateData` is unset; `integrations/sendgrid/index.ts` never sets it (we send `subject`/`text`/`html`, not dynamic templates). Revisit if we ever adopt SendGrid dynamic templates, or when SendGrid ships a release without deepmerge. |
