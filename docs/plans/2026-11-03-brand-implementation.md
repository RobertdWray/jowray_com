# Plan: implement `design/DESIGN.md` § 2 (Phase 1 brand onto the app)

## 0. Cold start: read this first

- **Canonical copy of this plan:** `docs/plans/2026-11-03-brand-implementation.md` on branch `claude/zealous-allen-pxrdpu` (created in Step 0 from this file). After Step 0 the repo copy is the source of truth; this file under `/root/.claude/plans/` is only the draft Rob approved.
- **Progress ledger:** the `## Progress` checklist at the end of the repo copy. Every step ends with a commit that updates the checklist with the commit id and the check results. On resume: `git log --oneline -15`, open the repo copy, find the first unchecked step, and continue from its first unchecked box. Never redo a step whose box is checked; verify its commit exists instead.
- **Repository:** `RobertdWray/jowray_com`. Branch: `claude/zealous-allen-pxrdpu`. Design source: PR 14 (`design/phase1-brand-handoff`, commit `bc90805`). Base of this work: `main` at `3f5cbf4`.
- **Decisions already made by Rob (2026-11-03)** are in § 2. Do not re-ask them.
- **House rules** are in `AGENTS.md` (branch + PR, no `eslint-disable`, no band-aids, no secrets, TDD on critical paths, `npm run validate` / `test:run` / `build` green with no `.env` and no network).
- **Tools this plan relies on:** Node 22+ (CI uses 26), npm, git. For the favicon script (Step 3): Playwright with a Chromium binary (preinstalled in the cloud container; elsewhere `npx playwright install chromium` first). No Python, no ImageMagick.
- **Working-tree hygiene:** `next dev` rewrites the first block of `AGENTS.md`; never commit that hunk (see the note at the top of `AGENTS.md`).

## 1. Context

PR 14 delivered the Phase 1 brand: `design/DESIGN.md` (spec), `design/tokens.css` (Tailwind 4 `@theme` block and base rules), two static comps (`design/reference/home.html`, `thank-you.html`), the two heart marks and the hero photo. No app code changed. The app today is the `create-next-app` starter look: Geist font variables declared but unused (the body is Arial), black-on-white, a `prefers-color-scheme: dark` block, a one-paragraph landing page, an unstyled `/share` form and `/m/[claimToken]` claim page.

This change applies `DESIGN.md` § 2 steps 1–8 so every visitor-facing page matches the comps while keeping every field, name, validation rule and recovery path the Phase 1 team built (`DESIGN.md` § 2 step 6 requires that) `[C19]`. The reference HTML wins over the spec where they disagree `[C19]`; every place the app cannot follow the comp literally is listed in § 3 so screenshot reviewers know what is intentional.

## 2. Decisions from Rob (2026-11-03)

| Decision | Ruling |
|---|---|
| "Text us" card | **Dropped for Phase 1.** SMS collection is deferred in the ledger and nothing receives texts. Three cards; heading "Three ways to share. Pick the easiest one." |
| Recorder | **No time cap; add playback.** `recorder.ts` enforces no limit. Copy: "Take your time. You can listen back before you send it." An `<audio controls>` player shows the clip. |
| Branch base | **Merge PR 14's branch into this one.** The PR targets `main`; once PR 14 merges (the repo merges PRs with merge commits, see `git log --merges`), the diff shrinks to app changes. |
| Review triage | Bucket 1 and 2 items are folded into the steps below; Bucket 3 is § 4.3 (non-goals); Bucket 4 is § 4.4 (follow-ups). Both go into the PR body. |

## 3. Intentional differences from the comps (exceptions table)

| # | Comp says | App does | Why |
|---|---|---|---|
| E1 | Four cards incl. "Text us" (`sms:`) | Three cards | Rob, § 2 |
| E2 | "Up to 10 minutes…" | "Take your time. You can listen back before you send it." + player + "Remove recording" | Rob, § 2; no cap in `recorder.ts` |
| E3 | Form on the home page | Form on `/share`; home links to it (hero button, cards) | `DESIGN.md` § 2 steps 5–6 |
| E4 | Thank-you header shows "Back to the start" | Shared header on every page (wordmark → `/`, nav → `/share`, `/#story`) | one header component |
| E5 | Footer on home only | Footer on every page (root layout) | contact line should be reachable from `/share` and the claim page |
| E6 | No phone type overrides (fluid only) | Display 44px / h2 34px / thank-you h1 44px below the `sm` breakpoint (640px) | `DESIGN.md` § 4 "Phone: display 44, h2 34" |
| E7 | Pill label 16px | 17px | `DESIGN.md` § 4 17px floor |
| E8 | "Read the full obituary" links to itself | Omitted | `DESIGN.md` § 9: no placeholders |
| E9 | `<em>not</em>` and the closer in synthesized italic | True Fraunces italic (`standard-italic.css`) | the comp's Google Fonts link requested no italic |
| E10 | "Send this page to someone who knew Jo" → `home.html#ways` | Web Share on phones (`navigator.share`), else a `mailto:` link | the comp link only scrolls; this one sends |
| E11 | `.stitch-rule` (top only) and `.patchwork` classes | `border-y-[3px] border-dashed border-jo-red` utilities; `@utility patchwork` | the band needs both borders; utilities respect the cascade |
| E12 | `tokens.css` body has no `font-size` | `body { font-size: var(--text-body); line-height: var(--text-body--line-height) }` (20px / 1.5) | `DESIGN.md` § 4 body 20, floor 17 |
| E13 | "Phone or email" field | "Email *(optional · so we can say thank you and send your private link)*" | no phone field exists; the email also carries the claim link |
| E14 | No private link on the thank-you page | Claim-link block kept (link, "we have also emailed…", PENDING / FAILED notes, "Keep this link private") | Phase 1 recovery path |
| E15 | No claim page / error page comps | Same tokens, header, footer, buttons, field classes | `DESIGN.md` § 2 step 8 |
| E16 | Hero photo at `design/reference/jo-santa.jpg` | Moved to `public/photos/jo-santa.jpg`; `design/` references updated | `DESIGN.md` § 2 step 4 says move |

## 4. Review triage (Rob's friend's review, 2026-11-03, George 1–14 and Oscar 15–37)

Each finding was checked against the source it cites. Numbers refer to the review log.

### 4.1 Bucket 1, must do (all folded into the steps)

| Finding | Verdict | Where in this plan |
|---|---|---|
| G1 / O15 referrer leak | **Confirmed.** `app/m/[claimToken]/page.tsx:20` has `<meta name="referrer" content="same-origin">`, which sets the document policy and defeats the `no-referrer` header from `next.config.ts` `[C21]`. Dormant today (no links on the page); live the moment the header's links land there. | Step 8 |
| G2 / O16 fake offline proof | **Confirmed.** Node does not honour `HTTPS_PROXY`. Replaced by a committed preload script that blocks non-loopback sockets, with a negative control `[C24]`. | Step 1d, Verification V1 |
| G3 / O21 object-URL lifecycle | **Confirmed.** Exact state + ref pattern specified; no reads of refs during render; cleanup on replace, remove, reset, unmount. | Step 6c |
| G4 / O20 no discard control; file input enabled mid-recording | **Confirmed** (`share-form.tsx:161` disables only when a clip exists). "Remove recording" button added; `disabled={busy \|\| isRecording \|\| clip !== null}`; file input cleared when a clip is captured. | Step 6c |
| G5 / O27 base `a { color }` rule | **Confirmed.** Preflight sets `a { color: inherit }`; a base rule would recolour every link. Rule dropped; prose links get `text-jo-red-deep underline` explicitly. | Step 2 |
| G6 / O26 no body font-size; `text-sm` leftovers | **Confirmed** (`tokens.css` body sets no size; `share-form.tsx:127` and `claim/page.tsx:73` use `text-sm` = 14px). | Step 2, 6, 8 |
| G7 mailto underspecified | **Confirmed.** Exact copy; `window.location.origin` inside the done branch (already used for the claim link); plain `<a>`; `lib/site-url.ts` is `server-only` and must not be imported. | Step 7 |
| G8 / O33 heart props | **Confirmed.** `SolidHeart` gets a `label` prop: decorative (`aria-hidden`) without it, `role="img"` + `aria-label` with it; `stitch` and `fill` props per call site. | Step 5a |
| G9 / O23 merge strategy | **Partly.** Repo PRs are merge commits (`git log --merges`), so the clean case is expected; the squash case is documented with a recovery command. `git fetch` added. | Step 0 |
| G10 / O37 icon href | **Confirmed** (`/icon?<generated>`) `[C10]`. | V5 |
| G11 / O17 database used for verification | **Confirmed.** No `.env.local` exists in a fresh clone and an unidentified one is not a fixture. Thank-you and claim checks run on the PR's Vercel preview, whose Neon branch `preview/<branch>` is disposable by design (`.github/workflows/neon-cleanup.yml`) `[C27]`. | V4 |
| G12 / O28 / O29 CSS gaps | **Confirmed.** Full `@theme` modifier names, hover shadow tokens, both borders on the band, pill offset and shadow, responsive heading classes written out. | Step 2, 5 |
| G13 (2–5) footer, section nesting, `h-full`, placeholders, file label | **Confirmed.** Footer in the root layout; `<section id="form">` moves inside `ShareForm`; `global-error` html class; comp placeholders; label "Add a photo, video or voice recording (optional)". | Step 5, 6, 1c |
| G14 / O24 / O22 / O36 handoff and resume | **Confirmed.** § 0, Step 0 assertions, `## Step 7` restored, exact favicon script inline, AGENTS sentence written out, checklist + checkpoint commits, measured baselines instead of assumed counts. | § 0, Step 0, § Progress |
| O19 reset contract | **Confirmed.** `resetForm()` specified (recorder cancelled and released, clip revoked, `isRecording` false, phase idle; the form remounts with fresh defaults). | Step 7 |
| O25 ESLint client rule coverage | **Confirmed.** `app/_components/**` added to the client-component `files` list (one line, no rule disabled). | Step 5a |
| O30 shrink constraints, padding | **Confirmed.** `min-w-0` on every wrapping flex child; `px-[max(16px,5%)]`. | Step 5 |
| O31 exceptions table | **Confirmed.** § 3. | § 3 |
| O34 `retry` / `error: unknown` | **Confirmed** against the live `error.js` reference (`retry` stable since 16.3; `error` is `unknown`) `[C22]`. | Step 1c |
| O35 `--save-exact` | **Confirmed** `[C25]`; also the plan no longer claims "like the rest of package.json". | Step 1a |

### 4.2 Bucket 2, nice to do (accepted, folded in)

- **O18 (part):** on the preview, also run one photo upload (expect `READY`) and one claim-page edit + "add another file", not only a text memory. V4.
- **O32:** wait for `document.fonts.ready` before every screenshot, app and comp alike; capture the claim page and the error page too. V2, V4.
- **Recorder check without a microphone:** headless Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` so start / stop / play / remove can be exercised in this container `[C26]`. V3.
- **Committed offline guard:** `scripts/no-network.cjs` + `npm run build:offline`, referenced from `AGENTS.md` (replaces the private `.superpowers/no-network.cjs` the reviewer mentioned). Step 1d.
- **E10 Web Share:** `navigator.share` on click when available, `mailto:` otherwise. Step 7.
- **Ledger:** a `## Task 11 — Brand` section in `docs/plans/phase1-ledger.md` with checks and the PR, in the house format. Step 9.
- **README:** the one stale sentence about Geist / `next/font` is corrected (full rewrite is a follow-up, § 4.4). Step 1a.

### 4.3 Bucket 3, not doing (and why; copy into the PR body)

1. **Header "Leave a memory" on the thank-you screen is a same-URL link and does nothing (G13.1).** "Tell another one" is the reset and sits in the middle of that screen. Giving the thank-you its own URL would lose the claim link held in component state. Revisit only if visitors are seen trying it.
2. **Manual matrix of `PENDING` / `FAILED` / `REJECTED` / upload-exception / email branches (O18 rest).** That logic is untouched; `__tests__/features/*` covers it. Those branches' new markup is reviewed by reading plus one text memory and one `READY` upload on the preview.
3. **Per-field inline error messages like "We'll need a name so the family knows who to thank" (`DESIGN.md` § 5.4).** `name` is optional in `lib/validations/memory.ts` and the server returns one message per submit; validation copy is not part of this change. Existing messages are already kind in tone.
4. **A 10-minute recorder cap.** Rob chose no cap.
5. **"Text us" card and the obituary button.** § 2 and § 3 E8.
6. **`prefetch={false}` on links from the claim page.** With `no-referrer` in force (Step 8) prefetch requests carry no Referer; prefetching keeps navigation fast.
7. **Making `SecondaryLink` detect `mailto:`.** A plain `<a>` with the exported class string is simpler.
8. **Keeping `.stitch-rule` as dead CSS.** § 3 E11.
9. **Dark mode.** Removed on purpose: `DESIGN.md` § 2 step 2, one warm theme.
10. **Restyling emails or `/api` responses.** Not visitor-facing pages; out of `DESIGN.md` § 2.
11. **A Storybook or dev-only toggle to render the thank-you state without a database.** The preview deployment renders the real thing; a fake toggle would be a band-aid in production code.

### 4.4 Bucket 4, real but out of scope (copy into the PR body under "Follow-ups"; file as issues after merge)

| # | Severity | Follow-up | What a new agent needs |
|---|---|---|---|
| F1 | Medium | **Browser test harness.** No component or e2e tests exist; UI flows (share → thank-you → claim edit) regress silently. Add Playwright with the fake-media flags against a preview URL, run in CI. | `__tests__` is Vitest/node only; Playwright is not a devDependency; preview URLs need `VERCEL_AUTOMATION_BYPASS_SECRET` (ledger). |
| F2 | Medium | **Production referrer check after deploy.** Open a claim link on `www.jowray.com`, click every link, confirm no request carries `/m/<token>` in `Referer` (devtools Network). The meta fix lands in this PR; the live check is post-merge. | Step 8 of this plan; `next.config.ts` headers. |
| F3 | Low | **Run `npm run build:offline` in CI** so "the build downloads nothing" is enforced, not documented. | `.github/workflows/ci.yml`; `scripts/no-network.cjs` from Step 1d. |
| F4 | Low | **`design/tokens.css` and `app/globals.css` will drift.** Consider `@import "../design/tokens.css"` from `globals.css` with the `@layer` / `@utility` wrapping moved into the design file, so one copy exists. | § 3 E11–E12 list today's differences. |
| F5 | Low | **README is still the create-next-app starter.** Rewrite to describe the memorial site, the checks and the docs index. | Only the font sentence is fixed in this PR. |
| F6 | Low | **Favicon regeneration needs Playwright.** If the mark changes again, add `playwright` as a devDependency and commit the Step 3 script as `scripts/make-favicon.mjs`. | Script text is in Step 3 of the repo copy of this plan. |
| F7 | Medium | **iPhone checks still open (ledger Task 10):** HEIC, `.mov`, Safari recording. The new player and "Remove recording" belong in that pass. | `docs/plans/phase1-ledger.md` Task 10. |

## 5. Steps

Each step: do the work, run the checkpoint, tick the boxes in `## Progress` of the repo copy with the commit id, commit (`git add -A` minus the `AGENTS.md` dev hunk), push with `git push -u origin claude/zealous-allen-pxrdpu`.

### Step 0: branch, baseline, plan copy

```bash
cd /home/user/jowray_com   # or wherever the clone lives; everything below is relative to the repo root
git remote get-url origin   # must end in RobertdWray/jowray_com(.git)
git branch --show-current   # must print claude/zealous-allen-pxrdpu; if not: git checkout -B claude/zealous-allen-pxrdpu origin/main
git status --porcelain      # must be empty apart from the AGENTS.md dev hunk; stash anything else and note it in Progress
git fetch origin main design/phase1-brand-handoff
git merge --no-edit origin/design/phase1-brand-handoff
```

- If the merge conflicts, stop and ask Rob: PR 14 only adds `design/`, so a conflict means the branch moved.
- `npm ci`, then record baselines in `## Progress`: `npm run test:run` (count), `npm run validate`, `npm run build` (all with no `.env*` present; `ls -a .env*` must say none).
- Copy this plan to `docs/plans/2026-11-03-brand-implementation.md` (whole file, including § Citations and § Progress). Commit: `docs: brand implementation plan (DESIGN.md § 2)`.
- **Squash contingency (if PR 14 is squash-merged later):** `git fetch origin main && git rebase --onto origin/main origin/design/phase1-brand-handoff` so this branch's `design/` edits (Step 4) replay onto `main`'s copy; then `git push --force-with-lease`. With a merge commit (the repo's practice), a plain `git merge origin/main` is enough. Either way, confirm the PR "Files changed" list matches § 6 before asking for review. `[C19]`

### Step 1: fonts and the offline guard

**1a. Packages** `[C1, C25]`
```bash
npm uninstall geist
npm install --save-exact @fontsource-variable/fraunces@5.3.0 @fontsource/atkinson-hyperlegible@5.3.0
grep -rn "geist" --include=*.ts --include=*.tsx --include=*.css --include=*.md . | grep -v node_modules   # expect only docs/plans history
```
Check `package.json` shows the two exact versions and `package-lock.json` has no `geist` entry. Fix the README sentence that says the project uses `next/font` and Geist to: "Fonts are self-hosted from the Fontsource packages (Fraunces, Atkinson Hyperlegible); see `design/DESIGN.md`."

**1b. `app/layout.tsx`** `[C2, C3, C4, C13]`
```ts
import "@fontsource-variable/fraunces/standard.css";        // wght + opsz, normal
import "@fontsource-variable/fraunces/standard-italic.css"; // the italic closer, <em>not</em>
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "./globals.css";
```
Remove the two Geist imports. `<html lang="en" className="h-full antialiased">`; `<body className="min-h-full flex flex-col">{children}</body>` (header and footer are added in Step 5, after they exist). The package ships `standard.css`, `standard-italic.css`, `wght.css`, `opsz.css` and more (listed from the 5.3.0 tarball); `standard` carries weight + optical size, which `DESIGN.md` § 4 wants on.

**Risk and fallback:** `next.config.ts` runs `@tailwindcss/turbopack` on every `*.css`, including these package files. If `npm run build` or `next dev` fails on them, move the four lines into `app/globals.css` as `@import "@fontsource-variable/fraunces/standard.css";` etc. (Tailwind 4 bundles `@import`s) and record that in Progress. Both forms satisfy "the build downloads nothing".

**1c. `app/global-error.tsx`** `[C3, C8, C16, C22]`
- Add the same four font imports and `import "./globals.css"` (global-error renders its own document and gets no styles from the root layout).
- Props become `{ error, retry }: { error: unknown; retry: () => void }`; keep `useEffect(() => { Sentry.captureException(error); }, [error])` (it accepts `unknown`).
- `<html lang="en" className="h-full antialiased">`, `<body className="min-h-full flex flex-col items-center justify-center gap-6 px-[max(16px,5%)] py-12 text-center">`, React `<title>Jo Wray — Something went wrong</title>`, h1 "Something went wrong" (`font-display text-h2-sm sm:text-h2`), p "Your memory was not lost. Please try again in a moment." (`text-lead`), `PrimaryButton`-styled `<button type="button" onClick={() => retry()}>Try again</button>` using the class string from Step 5a (import with a relative path; `app/global-error.tsx` is a client file, so it must not import server modules).

**1d. `scripts/no-network.cjs` and `npm run build:offline`** `[C24]`
```js
// scripts/no-network.cjs — preload with NODE_OPTIONS="--require ./scripts/no-network.cjs".
// Refuses every socket to a non-loopback host so `npm run build:offline` proves the build downloads nothing.
"use strict";
const net = require("node:net");
const dns = require("node:dns");

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function refuse(host) {
  const error = new Error(`[no-network] blocked outbound connection to ${host}`);
  error.code = "ENETUNREACH";
  throw error;
}

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = first !== null && typeof first === "object" ? first : {};
  const host = typeof options.path === "string" ? "localhost" : String(options.host ?? args[1] ?? "localhost");
  if (!LOOPBACK.has(host)) {
    refuse(host);
  }
  return connect.apply(this, args);
};

const lookup = dns.lookup;
dns.lookup = function (hostname, ...rest) {
  if (!LOOPBACK.has(hostname)) {
    refuse(hostname);
  }
  return lookup.call(this, hostname, ...rest);
};
```
`package.json`: `"build:offline": "NODE_OPTIONS=--require=./scripts/no-network.cjs NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1 npm run build"`. `NODE_OPTIONS` reaches child processes, so the `prisma generate` and `next build` children are covered; Turbopack's native code makes no network calls during a build. Negative control (must print `blocked`):
```bash
node --require ./scripts/no-network.cjs -e "fetch('https://example.com').then(() => process.exit(1), (e) => console.log('blocked:', e.cause?.message ?? e.message))"
```
Update the **Checks** sentence in both `AGENTS.md` and `docs/code-layout.md` to: "`npm run validate` (= `next typegen && tsc --noEmit`, then `eslint`), `npm run test:run`, `npm run build:offline` (the build behind `scripts/no-network.cjs`, which refuses every non-loopback socket). All three pass with `DATABASE_URL` unset and no `.env*` file; fonts come from the Fontsource packages." `[C18]`

**Checkpoint:** `npm run validate && npm run test:run && npm run build:offline`. Commit: `feat(brand): self-hosted Fraunces and Atkinson Hyperlegible; offline build guard`.

### Step 2: tokens (`app/globals.css`, `design/tokens.css`)

Replace `app/globals.css` with the `@theme` block from `design/tokens.css` and the rules below. Delete the starter `:root`, `@theme inline` and `prefers-color-scheme: dark` blocks `[C5, C8]`.

Add inside `@theme` `[C5, C6]`:
```css
  --text-display-sm: 44px;
  --text-display-sm--line-height: 1.02;
  --text-display-sm--letter-spacing: -0.02em;
  --text-h2-sm: 34px;
  --text-h2-sm--line-height: 1.1;
  --text-h2-sm--letter-spacing: -0.015em;
  --text-thanks: 60px;              /* thank-you h1, desktop */
  --text-thanks--line-height: 1.05;
  --text-thanks--letter-spacing: -0.02em;
  --shadow-card-hover: 0 10px 0 #e9d9c0;
  --shadow-card-red-hover: 0 10px 0 #7d0a1e;
  --shadow-pill: 0 3px 0 #7d0a1e;
```
After `@theme` `[C7, C23]`:
```css
@layer base {
  body {
    background-color: var(--color-muslin);
    background-image:
      linear-gradient(rgb(91 125 177 / 0.08) 50%, transparent 50%),
      linear-gradient(90deg, rgb(91 125 177 / 0.08) 50%, transparent 50%);
    background-size: 36px 36px;
    color: var(--color-walnut);
    font-family: var(--font-body);
    font-size: var(--text-body);
    line-height: var(--text-body--line-height);
  }
  input::placeholder,
  textarea::placeholder {
    color: var(--color-wood);
  }
  :is(input, textarea, select, button, a):focus-visible {
    outline: 4px solid var(--color-goldenrod);
    outline-offset: 2px;
  }
}

/* Patchwork frame (hero photo, thank-you ring) */
@utility patchwork {
  background-color: var(--color-jo-red);
  background-image:
    linear-gradient(45deg, #5b7db1 25%, transparent 25%, transparent 75%, #5b7db1 75%),
    linear-gradient(45deg, #e8a317 25%, transparent 25%, transparent 75%, #e8a317 75%);
  background-size: 32px 32px;
  background-position: 0 0, 16px 16px;
}
```
- No global `a { color }` rule (E11 reasoning in § 4.1 G5): prose links carry `text-jo-red-deep underline hover:text-walnut` where they appear (footer, claim link, download links).
- No `.stitch-rule`; no `.way:hover` (the lift is `motion-safe:` on the cards, Step 5) `[C17, C20]`.
- Mirror the two body lines (`font-size`, `line-height`) into `design/tokens.css` so the handoff file stays truthful (E12); leave the rest of that file alone.

**Checkpoint:** `npm run validate && npm run build:offline` (the pages still use starter classes; that is fine until Step 5). Commit: `feat(brand): design tokens and base styles`.

### Step 3: metadata and icons

- `app/layout.tsx` `metadata`: `title: "Jo Wray — Leave a memory"`, `description: 'Tell us a Jo story. Her family is collecting memories of Velma Josephine "Jo" Wray — a voice recording, a photo, a video, or a few words.'` `[C9]`
- `cp design/reference/heart-solid.svg app/icon.svg` (unchanged) `[C10]`.
- Regenerate `app/favicon.ico` from it with this script (save as `/tmp/.../make-favicon.mjs` or any path outside the repo; it is not committed, see F6) `[C10, C26]`:
```js
// node make-favicon.mjs app/icon.svg app/favicon.ico  — renders the SVG at 16/32/48 px and writes a PNG-entry ICO.
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const [svgPath, outPath] = process.argv.slice(2);
const svg = readFileSync(svgPath, "utf8");
const sizes = [16, 32, 48];
const browser = await chromium.launch();
const pngs = [];
for (const size of sizes) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  pngs.push(await page.screenshot({ omitBackground: true, type: "png" }));
  await page.close();
}
await browser.close();

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((size, i) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size, 0);
  entry.writeUInt8(size, 1);
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngs[i].length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return entry;
});
writeFileSync(outPath, Buffer.concat([header, ...entries, ...pngs]));
```
Run: `node /path/to/make-favicon.mjs app/icon.svg app/favicon.ico` from the repo root (Playwright resolves from the container's global install; elsewhere run it inside a folder where `playwright` is installed). Check with `file app/favicon.ico` (reports "MS Windows icon resource - 3 icons").

**Checkpoint:** `npm run validate && npm run build:offline`; `grep -o '<link rel="icon"[^>]*>' .next/server/app/index.html` shows both the `/icon?…` and `/favicon.ico` links. Commit: `feat(brand): site metadata, heart icon and favicon`.

### Step 4: hero photo

- `git mv design/reference/jo-santa.jpg public/photos/jo-santa.jpg` `[C11]`.
- `design/DESIGN.md` table row → "`reference/jo-santa.jpg` | moved to `public/photos/jo-santa.jpg` (served by the app; the comp references it there)"; `design/reference/home.html` `<img src="../../public/photos/jo-santa.jpg" …>` `[C19]`.
- Record the measured dimensions in Progress (`node -e` with `sharp` is not available; use `identify` if present, else read them from the static import's type in the next step).

**Checkpoint:** `npm run validate`. Commit: `feat(brand): hero photo under public/photos`.

### Step 5: shared components and the home page

**5a. `app/_components/`** (private folder, not routable; imported from `app/**` with relative paths) `[C15, C18]`

| File | Exports |
|---|---|
| `hearts.tsx` | `SolidHeart({ size, fill = "#c8102e", stitch = true, stitchColor = "#f6efe3", label? })` and `StitchedHeart({ size, color = "#c8102e", label? })`. Without `label`: `aria-hidden="true"`, no role. With `label`: `role="img"`, `aria-label={label}`, no `aria-hidden`. Paths are the comp's. |
| `buttons.tsx` | class strings `primaryButtonClass`, `secondaryButtonClass`, `secondaryOnGreenClass`, `tertiaryButtonClass`; components `PrimaryLink`, `SecondaryLink` (wrap `next/link`), `PrimaryButton`, `SecondaryButton`, `TertiaryButton` (`<button type="button">` unless `type` is passed). Primary: `inline-flex items-center justify-center gap-3 min-h-tap-lg rounded-button bg-jo-red px-[30px] py-[14px] text-[22px] font-bold text-white shadow-button-red no-underline`. Secondary: `… min-h-tap-lg rounded-button border-[3px] border-dashed border-wood px-6 py-[14px] text-body font-bold text-walnut`. Tertiary: `… min-h-tap rounded-input bg-periwinkle-deep px-[22px] py-3 text-label font-bold text-white shadow-[0_5px_0_#26406a]`. Disabled: `disabled:opacity-60 disabled:shadow-none`. |
| `field-classes.ts` | `labelClass = "flex min-w-0 flex-col gap-2 text-label font-bold"`, `helperClass = "font-normal text-walnut-soft"`, `inputClass = "min-h-tap w-full rounded-input border-2 border-wood bg-white px-4 py-3 text-body text-walnut"`, `textareaClass = inputClass + " resize-y leading-[1.5]"`, `selectClass = inputClass`, `fileInputClass = "min-h-tap w-full rounded-input border-2 border-dashed border-wood bg-muslin px-4 py-3 text-[18px] text-walnut file:mr-3 file:rounded-input file:border-0 file:bg-paper file:px-3 file:py-2 file:text-label file:font-bold"`, `errorClass = "text-small text-jo-red-deep"`, `linkClass = "text-jo-red-deep underline hover:text-walnut break-all"`. |
| `site-header.tsx` | `SiteHeader` (server): `<header className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-x-8 gap-y-4 px-[max(16px,5%)] py-5">`; `<Link href="/" className="flex items-center gap-3 text-walnut no-underline">` with `SolidHeart size={44}` and `<span className="font-display text-[30px] font-bold tracking-[-0.01em]">Jo Wray</span>`; `<nav className="flex flex-wrap gap-x-7 gap-y-2 text-label font-bold">` with `<Link href="/share" className="py-[10px] text-walnut no-underline">Leave a memory</Link>` and `<Link href="/#story" …>Jo's story</Link>` `[C13, C14]`. |
| `site-footer.tsx` | `SiteFooter`: `<footer className="flex flex-col items-center gap-[14px] px-[max(16px,5%)] pb-12 pt-10 text-center">`, `StitchedHeart size={40}`, `<p className="font-display text-lead">Made with love by Richard, Rob, Tracy and Ava.</p>`, `<p className="text-[18px] text-walnut-soft">Questions, or a memory that won't fit in a box? Email <a href="mailto:robwray@gmail.com" className={linkClass}>robwray@gmail.com</a>.</p>`. |

`eslint.config.mjs`: add `"app/_components/**/*.{ts,tsx}"` to the client-component `files` list (the block with `noServerFromClient`) and extend its comment: "`app/_components/` is shared by Client Components, so it follows the same rule." No rule is disabled `[C18]`.

`AGENTS.md` and `docs/code-layout.md`, under **Layers and import direction**, add the bullet: "`app/_components/` holds shared visitor-facing UI (header, footer, hearts, buttons, field classes). It is a Next.js private folder (not a route), imported only from `app/**` with relative paths, and it never imports `@/server`, `@/integrations` or `server-only` because Client Components use it; `eslint.config.mjs` applies the client-component import rule to it." `[C15, C18]`

**5b. Root layout** `[C13]`: `app/layout.tsx` body becomes `<SiteHeader />{children}<SiteFooter />` (E4, E5).

**5c. `app/page.tsx`** (static server page; no `connection()` needed, it reads nothing dynamic) `[C12, C14, C17, C20]`. Container: `mx-auto w-full max-w-[1200px] px-[max(16px,5%)]`.

1. **Hero** `<section id="top" className="… flex flex-wrap items-center gap-x-16 gap-y-12 pb-[72px] pt-10">`
   - Text column `flex min-w-0 flex-[1_1_380px] flex-col gap-6`: eyebrow `<p className="text-body font-bold uppercase tracking-[0.08em] text-jo-red-deep">Velma Josephine "Jo" Wray, née Hart</p>`; `<h1 className="font-display text-display-sm font-extrabold sm:text-display">Tell us a <span className="text-jo-red">Jo</span> story.</h1>`; lead `<p className="max-w-[34em] text-lead">Teacher, quilter, bargain hunter, grandmother, and owner of a very cheeky giggle. Her family is gathering memories of her — from her students, her church friends, her neighbors, and anyone she ever teased. We'd love yours.</p>`; buttons row `flex flex-wrap items-center gap-4`: `<PrimaryLink href="/share"><StitchedHeart size={26} color="#fff" />Leave a memory of Jo</PrimaryLink>`, `<SecondaryLink href="#story">Read Jo's story</SecondaryLink>`.
   - Figure `<figure className="flex min-w-0 max-w-[560px] flex-[1_1_400px] -rotate-[1.5deg] flex-col items-center">`: `<div className="patchwork w-full rounded-[6px] p-4 shadow-photo">` → `<div className="flex flex-col gap-3 rounded-[3px] bg-paper px-[14px] pb-[18px] pt-[14px]">` → `<Image src={joSanta} alt="Jo in a red embroidered top, laughing beside her son Rob and her husband Richard in his full Santa beard and suit, at a restaurant table" sizes="(min-width: 900px) 560px, 100vw" preload className="block aspect-[4/3] w-full rounded-[3px] object-cover" />` with `import joSanta from "@/public/photos/jo-santa.jpg"`, and `<figcaption className="text-center font-display text-body leading-[1.35]">Jo, her son Rob, and Santa. You could call him Santa. You could <em>not</em> call her Mrs. Claus.</figcaption>`. Pill: `<span className="relative -top-7 inline-block rotate-[4deg] rounded-full bg-jo-red px-[14px] py-2 text-small font-bold text-paper shadow-pill">Christmas, Hunt Valley</span>` (E7).
2. **Ways band** `<section id="ways" className="border-y-[3px] border-dashed border-jo-red bg-paper px-[max(16px,5%)] py-16">` (E11), inner `mx-auto flex max-w-[1200px] flex-col gap-8`: `<h2 className="font-display text-h2-sm font-bold sm:text-h2">Three ways to share. Pick the easiest one.</h2>`, `<p className="max-w-[40em] text-body">A voice memo counts. A photo from a shoebox counts. Three sentences count. Jo kept every drawing a student ever gave her, so nothing is too small.</p>`. Cards row `flex flex-wrap gap-5`; each card is `<Link>` with `flex min-h-[220px] min-w-0 flex-[1_1_200px] flex-col justify-between gap-4 rounded-card p-6 no-underline motion-safe:transition-transform motion-safe:hover:-translate-y-[3px]`:
   - Record here (`href="/share#record"`): `bg-jo-red text-white shadow-card-red motion-safe:hover:shadow-card-red-hover`; mic icon stroke white; "Tap once, tell the story, tap again."
   - Upload a photo or video (`href="/share#form"`): `border-[3px] border-wood-light bg-muslin text-walnut shadow-card motion-safe:hover:shadow-card-hover`; photo icon stroke `#a50d26`; "From your phone or that shoebox."
   - Write a note (`href="/share#form"`): same light classes; pencil icon; "A sentence or a page. Spelling doesn't count."
   - Icons: the comp's inline 44px stroke SVGs (`stroke-width 1.8`, round caps), `aria-hidden="true"`. Title `font-display text-card-title font-bold`, line `text-[18px] leading-[1.4]`.
3. **Story band** `<section id="story" className="bg-lake-green px-[max(16px,5%)] py-[72px] text-[#fffdf8]">`, inner `mx-auto flex max-w-[1200px] flex-wrap items-start gap-x-16 gap-y-8`: left `flex min-w-0 flex-[1_1_280px] flex-col gap-[14px]` with `<h2 className="font-display text-h2-sm font-bold sm:text-h2">Jo's story</h2>` and `<p className="text-body text-[#e7f0e3]">Hunt Valley, Maryland, by way of Reisterstown and a lot of summers on Lake George.</p>` (no obituary button, E8); right `flex min-w-0 flex-[2_1_480px] flex-col gap-5 text-body leading-[1.6]` with the three comp paragraphs, the third as `<p className="rounded-[14px] bg-[rgb(255_253_248/0.12)] px-[22px] py-[18px] font-display text-[24px] leading-[1.4]">`.

**Checkpoint:** `npm run validate && npm run test:run && npm run build:offline`; `next dev` and screenshot `/` at 1280 and 390 (V2). Commit: `feat(brand): home page, header, footer and shared components`.

### Step 6: share page

**6a. `app/share/page.tsx`** `[C13]`: keep `export const maxDuration = 120`. Render `<main className="flex flex-1 flex-col"><ShareForm intro={<Intro />} /></main>` where `Intro` (server, in the same file) is `<h1 className="font-display text-h2-sm font-bold sm:text-h2">Write it down here.</h1>` and `<p className="text-body">Tell us who you are and roughly when the memory is from — "her classroom, 1970s" or "Christmas 2019" is plenty. Then tell the story the way you'd tell it at her kitchen table.</p>`. The section wrapper moves into `ShareForm` so the thank-you state can own the full height (G13.3).

**6b. `app/share/share-form.tsx`, form branch** (logic unchanged: `Phase`, `createMemory`, `upload`, `finalizeUpload`, every error branch) `[C19]`:
- `<section id="form" className="mx-auto flex w-full max-w-[1200px] flex-wrap items-start gap-x-16 gap-y-10 px-[max(16px,5%)] py-[72px]">`; left column `flex min-w-0 flex-[1_1_300px] flex-col gap-[18px]` = `{intro}` + recorder box; `<form className="flex min-w-0 flex-[1_1_440px] flex-col gap-[22px] rounded-form border-[3px] border-wood-light bg-paper p-8 shadow-form" aria-busy={busy}>`.
- Fields, in order, with `labelClass` / `inputClass` and the existing `name`, `maxLength`, `autoComplete`, `type` attributes:
  1. Row `flex flex-wrap gap-5`: `name` "Your name" (`placeholder="Kay Bartholomew"`); `email` "Email <span className={helperClass}>(optional · so we can say thank you and send your private link)</span>" (E13).
  2. `relationship` "How you knew Jo" (`placeholder="former student · church friend · neighbor · family"`).
  3. `approxDateText` "When is this memory from? <span className={helperClass}>(roughly is fine)</span>" (`placeholder="Summer 1985 · Lake George, late 90s · her classroom"`).
  4. `place` "Where? <span className={helperClass}>(optional)</span>" (`placeholder="her classroom · Lake George · Broadmead"`).
  5. `note` "Your memory of Jo" (`rows={7}`, `placeholder="She once…"`, `textareaClass`).
  6. File: `<label className={labelClass}>Add a photo, video or voice recording <span className={helperClass}>(optional)</span><input ref={fileInputRef} name="file" type="file" accept={ACCEPT_ATTRIBUTE} className={fileInputClass} disabled={busy || isRecording || clip !== null} /></label>` (G4).
  7. `visibility` "Who can see this?" `<select className={selectClass}>` with the three existing options.
  8. `<PrimaryButton type="submit" disabled={busy || isRecording}><SolidHeart size={24} fill="#fff" stitch={false} />{busy ? (phase.progress ? \`Uploading… ${phase.progress}%\` : "Sending…") : "Send this to Jo's family"}</PrimaryButton>`.
  9. `<p className="text-small text-walnut-soft">Memories go to Richard, Rob and Tracy first. Later, with your okay, they'll join a shared collection the whole family can read.</p>`, then `<label className="flex items-start gap-3 text-small"><input name="contactOptIn" type="checkbox" className="mt-1 size-6 accent-jo-red" /><span>{CONTACT_OPT_IN_LABEL}</span></label>`, then `<p className="text-small text-walnut-soft">{IMPLICIT_CONSENT_NOTE}</p>` (both constants from `lib/consent`, unchanged).
  - Error paragraph stays `role="alert"`, class `errorClass`, with the claim link in `linkClass` when present.

**6c. Recorder box** (inside the left column, after `{intro}`) `[C19]`
`<div id="record" className="flex flex-col gap-[10px] rounded-2xl border-[3px] border-dashed border-periwinkle bg-paper px-[22px] py-5">` with `<span className="font-display text-lead font-bold">Rather say it than type it?</span>`.
- State: `const [clip, setClip] = useState<{ recording: Recording; url: string } | null>(null)`, `const clipUrlRef = useRef<string | null>(null)`, `const fileInputRef = useRef<HTMLInputElement>(null)`; keep `isRecording`, `recorderRef`, `canRecord` (`useSyncExternalStore`) as they are.
- `function replaceClip(next)`: revoke `clipUrlRef.current` if set, set `clipUrlRef.current = next?.url ?? null`, `setClip(next)`. The URL is created only here, from event handlers; nothing reads a ref during render (eslint `react-hooks/refs`) and no state is set inside an effect (`react-hooks/set-state-in-effect`).
- `toggleRecording`: when stopping, `const result = await recorder.stop(); replaceClip({ recording: result, url: URL.createObjectURL(result.blob) }); if (fileInputRef.current) fileInputRef.current.value = "";` When starting, `replaceClip(null)` first, then `start()`. A `stop()` that resolves after unmount cannot leak: the unmount cleanup calls `cancel()`, which rejects the pending promise before any URL is made.
- Unmount effect: `useEffect(() => () => { recorderRef.current?.cancel(); recorderRef.current = null; if (clipUrlRef.current) { URL.revokeObjectURL(clipUrlRef.current); clipUrlRef.current = null; } }, [])`.
- UI: when `canRecord`: `<TertiaryButton onClick={toggleRecording} disabled={busy}>` with the mic SVG and `isRecording ? "Stop recording" : clip ? "Record again" : "Start recording"`; when `clip`: `<audio controls src={clip.url} className="w-full min-w-0" />`, `<span className="text-small text-walnut-soft">Recorded {formatDuration(clip.recording.durationMs)}</span>` and `<SecondaryButton onClick={() => replaceClip(null)} disabled={busy || isRecording} className="min-h-tap text-label">Remove recording</SecondaryButton>`; line `<span className="text-small text-walnut-soft">Take your time. You can listen back before you send it.</span>`. When `!canRecord`: the box stays (so `#record` resolves) with only the title and "Recording isn't available in this browser. You can attach a voice memo with the file field instead."
- `onSubmit`: `const file = clip?.recording.file ?? (picked …)` replaces `recording?.file`.

**6d. `lib/format-duration.ts` + `__tests__/lib/format-duration.test.ts`** (test first) `[C18]`: `formatDuration(ms: number): string` → `m:ss` (`0` → `"0:00"`, `42_000` → `"0:42"`, `605_000` → `"10:05"`, `59_999` → `"0:59"`, negative or `NaN` → `"0:00"`).

**Checkpoint:** `npm run validate && npm run test:run && npm run build:offline`; `next dev` screenshot `/share` at 1280 and 390; recorder check V3. Commit: `feat(brand): share page with recorder playback`.

### Step 7: thank-you state (`app/share/share-form.tsx`, done branch) `[C2, C19]`

When `phase.kind === "done"` render, instead of the section above:
`<section className="flex flex-1 flex-col items-center justify-center px-[max(16px,5%)] pb-20 pt-10">` → `<div className="flex w-full max-w-[760px] flex-col items-center gap-7 text-center">`:
1. `<div className="patchwork rounded-full p-[14px] shadow-[0_12px_26px_rgb(46_36_32/0.18)]"><div className="flex size-[150px] items-center justify-center rounded-full bg-paper"><SolidHeart size={96} stitchColor="#fffdf8" label="A stitched red heart" /></div></div>` (named-image mode, G8).
2. `<h1 className="font-display text-display-sm font-extrabold sm:text-thanks">Jo would have loved this.</h1>`.
3. `<p className="max-w-[30em] text-lead">Thank you. Your memory is on its way to Richard, Rob and Tracy. We read every single one, usually more than once.</p>`.
4. Buttons `flex flex-wrap justify-center gap-4`: `<PrimaryButton onClick={resetForm}>Tell another one</PrimaryButton>` and `<a href={mailto} onClick={share} className={secondaryButtonClass}>Send this page to someone who knew Jo</a>` where, inside this branch only, `const origin = window.location.origin;` (already used for the claim link), `const mailto = \`mailto:?subject=${encodeURIComponent("Tell a Jo story")}&body=${encodeURIComponent(\`Jo's family is collecting memories of her. If you knew Jo, tell yours here: ${origin}/\`)}\`` and `share(event)` does `if (typeof navigator.share === "function") { event.preventDefault(); void navigator.share({ title: "Tell us a Jo story", text: "Jo's family is collecting memories of her.", url: \`${origin}/\` }).catch(() => {}); }` (E10).
5. Claim-link block, kept in content (E14): `<div className="flex flex-col gap-3 text-body">` with "Your private link to see, correct or add to this memory:" + `<a className={linkClass} href={phase.claimLink}>`, the `emailed` line, the `PENDING` / `FAILED` notes, and `<p className="text-small text-walnut-soft">Keep this link private: anyone who has it can edit this memory.</p>` (17px, replaces `text-sm`, G6).
6. `<p className="font-display text-body italic text-walnut-soft">Spelling, as promised, did not count.</p>`.

`resetForm()`: `recorderRef.current?.cancel(); recorderRef.current = null; setIsRecording(false); replaceClip(null); setPhase({ kind: "idle" })`. The form branch remounts, so every uncontrolled input starts empty and the file input is enabled (O19). Two submissions in a row produce two memories without carrying the first attachment forward (V4 checks it).

**Checkpoint:** `npm run validate && npm run test:run && npm run build:offline`. Commit: `feat(brand): thank-you state`.

### Step 8: claim page (`app/m/[claimToken]/page.tsx`, `claim-form.tsx`) `[C13, C14, C21]`

Keep `connection()`, `headers()`, `notFound()`, the unoptimized `<Image>`, the token-gated media URLs and both Server Function flows exactly as they are.

- **Referrer (G1):** change line 20 to `<meta name="referrer" content="no-referrer" />` and the comment above it to: "`Referrer-Policy: no-referrer` comes from `next.config.ts` for `/m/*`; this meta repeats it for the document so no later rule can widen it. The header links and prefetches below must never carry the token." `[C21]`
- Page: `<main className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-6 px-[max(16px,5%)] py-10">`; `<h1 className="font-display text-h2-sm font-bold sm:text-h2">Your memory</h1>`; `<Suspense fallback={<p className="text-body text-walnut-soft">Loading…</p>}>`; the note as `<blockquote className="whitespace-pre-wrap rounded-card border-[3px] border-wood-light bg-paper p-6 text-body shadow-card">`; empty state `<p className="text-body text-walnut-soft">No file has been received yet.</p>`; media wrapped in `rounded-card border-[3px] border-wood-light bg-paper p-3`; download links `linkClass`; "Keep this link private…" → `text-small text-walnut-soft` (G6).
- `claim-form.tsx`: `labelClass` / `inputClass` / `textareaClass` / `selectClass` on the six fields, `<PrimaryButton type="submit" disabled={busy}>Save changes</PrimaryButton>`, the add-file input with `fileInputClass`, `<p role="status" className="text-body">`. Keep `router.refresh()` and `event.target.value = ""`.

**Checkpoint:** `npm run validate && npm run test:run && npm run build:offline`. Commit: `feat(brand): claim page; close the referrer gap for header links`.

### Step 9: docs, ledger, PR

- `docs/plans/phase1-ledger.md`: append `## Task 11 — Brand (DESIGN.md § 2)` with Status, Branch/PR, Checks passed (copied from Progress), and Rob's decisions from § 2.
- Update the repo copy of this plan: Progress complete, measured numbers filled in.
- Open the PR against `main` (title `feat: Phase 1 brand on every visitor page (DESIGN.md § 2)`), body = § 2, § 3, § 4.3 as "Not doing", § 4.4 as "Follow-ups", the V-results table, and the four screenshots. Note it stacks on PR 14 until that merges. Do not merge.

## 6. Files touched

| Path | Change |
|---|---|
| `package.json`, `package-lock.json` | Fontsource packages (exact), `geist` removed, `build:offline` script `[C1, C24, C25]` |
| `scripts/no-network.cjs` (new) | offline guard `[C24]` |
| `README.md` | one sentence (fonts) |
| `app/layout.tsx` | font imports, metadata, header + footer `[C2, C3, C4, C9, C13]` |
| `app/global-error.tsx` | CSS + fonts, `retry` / `unknown`, brand styling `[C3, C8, C16, C22]` |
| `app/globals.css`, `design/tokens.css` | tokens, `@layer base`, `@utility patchwork`; body size mirrored `[C5, C6, C7, C8, C23]` |
| `app/icon.svg` (new), `app/favicon.ico` (regenerated) | `[C10, C26]` |
| `public/photos/jo-santa.jpg` (moved), `design/DESIGN.md`, `design/reference/home.html` | `[C11, C19]` |
| `app/page.tsx` | rebuilt `[C12, C14, C17, C20]` |
| `app/_components/{hearts,buttons,site-header,site-footer}.tsx`, `field-classes.ts` (new) | `[C15, C18]` |
| `eslint.config.mjs` | `app/_components/**` in the client-component pattern `[C18]` |
| `app/share/page.tsx`, `app/share/share-form.tsx` | restyle, playback, remove, thank-you `[C13, C19]` |
| `lib/format-duration.ts`, `__tests__/lib/format-duration.test.ts` (new) | `[C18]` |
| `app/m/[claimToken]/page.tsx`, `claim-form.tsx` | restyle, referrer meta `[C13, C14, C21]` |
| `AGENTS.md`, `docs/code-layout.md` | Checks sentence, `app/_components/` bullet `[C18]` |
| `docs/plans/2026-11-03-brand-implementation.md` (new), `docs/plans/phase1-ledger.md` | plan copy, ledger section `[C18]` |

Not touched: `features/`, `services/`, `integrations/`, `server/`, `lib/validations`, `lib/consent`, `lib/site-url.ts`, `app/share/recorder.ts`, `app/share/actions.ts`, `app/api/**`, `next.config.ts`, `prisma/`.

## 7. Verification

| # | Check | Where | Pass condition |
|---|---|---|---|
| V1 | `npm run validate`, `npm run test:run`, `npm run build:offline` with no `.env*` file | container | all green; test count ≥ baseline + 5; the negative-control command prints `blocked:` |
| V2 | Screenshots of `/`, `/share`, `/m/<preview token>` and the comps at 1280 and 390 (`deviceScaleFactor: 2`, after `await page.evaluate(() => document.fonts.ready)`) | container (`next dev`) for `/` and `/share`; preview for the rest | no horizontal scroll at 390; cards and columns wrap; figure rotates; goldenrod ring on Tab; `/share#record` and `/share#form` land on their targets; computed colour of the wordmark and light cards is `rgb(46, 36, 32)` |
| V3 | Recorder with fake media: `chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] })` `[C26]` | container | Start → Stop shows the player and "Recorded m:ss"; Remove recording clears it and re-enables the file input; Record again replaces the clip; `URL.revokeObjectURL` call count equals clips replaced + removed (spy via `page.addInitScript`) |
| V4 | On the PR's Vercel preview (Neon branch `preview/claude/zealous-allen-pxrdpu`, deleted on PR close `[C27]`): text-only memory with email blank → thank-you screen, claim link; "Tell another one" → empty form; photo memory → `READY` on the claim page; claim edit → "Saved."; add another file → `READY` | preview | each state screenshot at 390 and 1280; no email sent (field blank) |
| V5 | `view-source:/` on the preview | preview | `<title>Jo Wray — Leave a memory</title>`; `<link rel="icon" href="/icon?…" type="image/svg+xml" sizes="any">` and the `/favicon.ico` link; fetching both returns the heart `[C10]` |
| V6 | Referrer: on the preview, open a claim link, click "Jo Wray", "Leave a memory", "Jo's story" with devtools Network open | preview | no request shows `/m/` in its `Referer`; response header `referrer-policy: no-referrer` on `/m/*` `[C21]` |
| V7 | Error page: temporarily throw in `app/layout.tsx` under `next dev`, screenshot, revert before commit | container | muslin ground, display heading, "Try again" button styled; Sentry capture call still present |
| V8 | PR "Files changed" matches § 6 | GitHub | nothing extra, nothing missing |

Record each V result (date, pass/fail, note) in Progress.

## Progress

- [ ] Step 0: branch asserted, merged PR 14 branch, `npm ci`, baselines recorded (tests: __, validate: __, build: __), plan copied to `docs/plans/`, commit __
- [ ] Step 1: fonts, global-error, offline guard; checkpoint green; commit __
- [ ] Step 2: tokens; checkpoint green; commit __ (fallback used for font imports? yes/no)
- [ ] Step 3: metadata, icon, favicon; checkpoint green; commit __
- [ ] Step 4: photo moved (dimensions: __); commit __
- [ ] Step 5: components, layout, home; checkpoint green; V2 home screenshots; commit __
- [ ] Step 6: share page; checkpoint green; V2 share screenshots; V3; commit __
- [ ] Step 7: thank-you; checkpoint green; commit __
- [ ] Step 8: claim page + referrer; checkpoint green; commit __
- [ ] Step 9: ledger, plan copy final, PR opened (url __); V4–V8 recorded

---

## Citations

### [C1] — Fontsource: install and import self-hosted font packages

- **Relevant File(s):** `package.json`, `app/layout.tsx`
- **Change Summary:** Replace Geist with Fontsource packages that bundle the font files with the app, so the build fetches nothing.
- **Source URL:** https://fontsource.org/docs/getting-started/install#setup
- **Verbatim Quote:**
  > "Fontsource packages let you bundle and self-host fonts with your web application. When a family supports variable fonts, start with its variable package. It provides a continuous range of weights and often needs fewer files than several static faces."
  > "Import only the weights and styles the project uses. Each import adds one fixed face."
- **Justification:** Fraunces has a variable package (`@fontsource-variable/fraunces`), so it is installed as such; Atkinson Hyperlegible is static, so only the `400.css` and `700.css` faces the spec uses are imported.

### [C2] — Fontsource: variable axes and the `standard` / `standard-italic` files

- **Relevant File(s):** `app/layout.tsx`, `app/global-error.tsx`, `app/share/share-form.tsx` (italic closer)
- **Change Summary:** Import `standard.css` (weight + optical size) and `standard-italic.css` instead of the bare package import.
- **Source URL:** https://fontsource.org/docs/getting-started/variable#standard-axes
- **Verbatim Quote:**
  > "The standard axes consist of a small subset of the most commonly used axes, including `[wght, wdth, slnt, opsz, ital]`."
  > "However, if you want to import multiple standard axes, it is recommended to use the `standard` CSS file instead:"
  > "**Note:** Each import includes the `wght` axis as multiple imports of different axes are not supported. Therefore, you must use a single import when importing variable fonts."
- **Justification:** `DESIGN.md` § 4 wants Fraunces weight 700–800 with optical size on, and one italic line. That is two axes (`wght`, `opsz`) in one file, which is the `standard` file; the italic style is its own `standard-italic` file, which the docs pair with it.

### [C3] — Next.js: external package stylesheets can be imported in `app/`

- **Relevant File(s):** `app/layout.tsx`, `app/global-error.tsx`
- **Change Summary:** Import the Fontsource CSS files directly from TypeScript in the root layout and in the global error boundary.
- **Source URL:** https://nextjs.org/docs/app/getting-started/css#external-stylesheets
- **Verbatim Quote:**
  > "Stylesheets published by external packages can be imported anywhere in the `app` directory, including colocated components:"
- **Justification:** The four `import "@fontsource…/….css"` lines are package stylesheets; this is the documented way to load them, and it works in `global-error.tsx` too since that file is inside `app/`.

### [C4] — Next.js: fonts applied in the Root Layout cover the whole app

- **Relevant File(s):** `app/layout.tsx`
- **Change Summary:** Remove the Geist `className` variables from `<html>`; fonts come from the global CSS loaded by the root layout instead.
- **Source URL:** https://nextjs.org/docs/app/getting-started/fonts
- **Verbatim Quote:**
  > "Fonts are scoped to the component they're used in. To apply a font to your entire application, add it to the Root Layout."
- **Justification:** The only consumer of `GeistSans.variable` / `GeistMono.variable` was the root `<html>` class; after this change the root layout imports the font CSS and the `body { font-family: var(--font-body) }` base rule applies site-wide, so `className="h-full antialiased"` is all that remains.

### [C5] — Tailwind CSS v4: `@theme` variables create utilities per namespace

- **Relevant File(s):** `app/globals.css`, every `app/**/*.tsx`
- **Change Summary:** Paste the `@theme` block from `design/tokens.css` and use `bg-jo-red`, `font-display`, `rounded-button`, `shadow-form`, `min-h-tap`, etc. in markup.
- **Source URL:** https://tailwindcss.com/docs/theme#theme-variable-namespaces
- **Verbatim Quote:**
  > "Theme variables are defined in _namespaces_ and each namespace corresponds to one or more utility class or variant APIs."
  > "| `--color-*` | Color utilities like `bg-red-500`, `text-sky-300`, and many more |" … "| `--font-*` | Font family utilities like `font-sans` |" … "| `--spacing-*` | Spacing and sizing utilities like `px-4`, `max-h-16`, and many more |" … "| `--radius-*` | Border radius utilities like `rounded-sm` |" … "| `--shadow-*` | Box shadow utilities like `shadow-md` |"
- **Justification:** Every token in `tokens.css` sits in one of these namespaces (`--color-jo-red`, `--font-display`, `--spacing-tap`, `--radius-button`, `--shadow-button-red`), so the pages can be written with named utilities instead of arbitrary hex values, which is how the spec's "red leads, no greys" rules stay enforceable.

### [C6] — Tailwind CSS v4: font-size tokens with default line-height and letter-spacing

- **Relevant File(s):** `app/globals.css`
- **Change Summary:** Keep the `--text-display--line-height` style modifiers from `tokens.css` and add `--text-display-sm`, `--text-h2-sm` and `--text-thanks` with their own modifiers.
- **Source URL:** https://tailwindcss.com/docs/font-size#customizing-your-theme
- **Verbatim Quote:**
  > "You can also provide default `line-height`, `letter-spacing`, and `font-weight` values for a font size:"
  > "@theme {  --text-tiny: 0.625rem;  --text-tiny--line-height: 1.5rem;   --text-tiny--letter-spacing: 0.125rem;   --text-tiny--font-weight: 500; }"
- **Justification:** The modifier key is `--text-<name>--line-height`, written out in full in Step 2; `text-display-sm sm:text-display` then carries the right leading and tracking at both sizes without extra `leading-*` classes.

### [C7] — Tailwind CSS v4: custom CSS and `@layer base` for element defaults

- **Relevant File(s):** `app/globals.css`
- **Change Summary:** Put the `body`, placeholder and `:focus-visible` rules in `@layer base` so utilities can still override them.
- **Source URL:** https://tailwindcss.com/docs/adding-custom-styles#adding-base-styles
- **Verbatim Quote:**
  > "While Tailwind is designed to handle the bulk of your styling needs, there is nothing stopping you from just writing plain CSS when you need to:"
  > "If you want to add your own default base styles for specific HTML elements, use the `@layer` directive to add those styles to Tailwind's `base` layer:"
- **Justification:** The gingham ground, body type size and focus ring are element defaults; in the `base` layer they lose to any utility on a specific element, which is the cascade order the review asked to make explicit (O28).

### [C8] — Next.js: global CSS imported in the root layout applies to every route

- **Relevant File(s):** `app/globals.css`, `app/layout.tsx`, `app/global-error.tsx`
- **Change Summary:** `globals.css` stays the single global stylesheet; `global-error.tsx` imports it too because it renders outside the root layout.
- **Source URL:** https://nextjs.org/docs/app/getting-started/css#global-css
- **Verbatim Quote:**
  > "Create a `app/global.css` file and import it in the root layout to apply the styles to **every route** in your application:"
  > "Global styles can be imported into any layout, page, or component inside the `app` directory."
- **Justification:** The tokens and base rules must reach `/`, `/share` and `/m/[claimToken]` (root layout import) and the global error page, which replaces the root layout and therefore needs its own import, which the second sentence permits.

### [C9] — Next.js: static `metadata` object with `title` and `description`

- **Relevant File(s):** `app/layout.tsx`
- **Change Summary:** Set the site title and description from `DESIGN.md` § 2 step 3.
- **Source URL:** https://nextjs.org/docs/app/api-reference/functions/generate-metadata#the-metadata-object
- **Verbatim Quote:**
  > "To define static metadata, export a [`Metadata` object](https://nextjs.org/docs/app/api-reference/functions/generate-metadata#metadata-fields) from a `layout.js` or `page.js` file."
  > "The `title` attribute is used to set the title of the document. It can be defined as a simple [string](…) or an optional [template object](…)."
- **Justification:** The existing `export const metadata: Metadata` in the root layout is the right place; only the two string values change.

### [C10] — Next.js: `icon.svg` and `favicon.ico` file conventions and the generated `<link>`

- **Relevant File(s):** `app/icon.svg`, `app/favicon.ico`
- **Change Summary:** Add the solid heart as `app/icon.svg`, keep a regenerated `app/favicon.ico` as the fallback, and verify the emitted `/icon?…` link rather than `/icon.svg`.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons#image-files-ico-jpg-png
- **Verbatim Quote:**
  > "Use an image file to set an app icon by placing a `favicon`, `icon`, or `apple-icon` image file within your `/app` directory. The `favicon` image can only be located in the top level of `app/`."
  > "| [`icon`](…) | `.ico`, `.jpg`, `.jpeg`, `.png`, `.svg` | `app/**/*` |"
  > "<link rel=\"icon\" href=\"/icon?<generated>\" type=\"image/<generated>\" sizes=\"<generated>\" />"
  > "`sizes=\"any\"` is added to icons when the extension is `.svg` or the image size of the file is not determined."
- **Justification:** `.svg` is a supported `icon` type and Next generates its `<link>` automatically with an `/icon?<generated>` href, which is what V5 checks; `favicon.ico` must stay at `app/` root and is kept for browsers that ignore SVG icons.

### [C11] — Next.js: static files under `public/` are served from `/`

- **Relevant File(s):** `public/photos/jo-santa.jpg`
- **Change Summary:** Move the hero photo to `public/photos/` so it is a servable static asset.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/public-folder
- **Verbatim Quote:**
  > "Next.js can serve static files, like images, under a folder called `public` in the root directory. Files inside `public` can then be referenced by your code starting from the base URL (`/`)."
- **Justification:** `design/reference/` is not served; `public/photos/` is, and the static import in `[C12]` resolves from this path.

### [C12] — Next.js `<Image>`: static import, `sizes`, and `preload` replacing `priority`

- **Relevant File(s):** `app/page.tsx`
- **Change Summary:** Render the hero with a static import, the `sizes` string from the spec, and `preload` since it is the above-the-fold image.
- **Source URL:** https://nextjs.org/docs/app/api-reference/components/image#responsive-images-with-a-static-export (static import), https://nextjs.org/docs/app/api-reference/components/image#sizes, https://nextjs.org/docs/app/api-reference/components/image#preload
- **Verbatim Quote:**
  > "When you import a static image, Next.js automatically sets its width and height based on the file."
  > "If `sizes` is missing, the browser assumes the image will be as wide as the viewport (`100vw`). This can cause unnecessarily large images to be downloaded."
  > "Starting with Next.js 16, the `priority` property has been deprecated in favor of the [`preload`](…) property in order to make the behavior clear."
  > "**When to use it:** … The image is above the fold, typically the hero image."
- **Justification:** The static import removes hand-typed dimensions and gives the aspect ratio for layout; `sizes="(min-width: 900px) 560px, 100vw"` is the exact string from `DESIGN.md` step 4; `preload` is the non-deprecated flag for the one hero image.

### [C13] — Next.js: the root layout defines `<html>`, `<body>` and globally shared UI; `LayoutProps`

- **Relevant File(s):** `app/layout.tsx`, `app/page.tsx`, `app/share/page.tsx`, `app/m/[claimToken]/page.tsx`
- **Change Summary:** Put `SiteHeader` and `SiteFooter` in the root layout; pages render only their own sections.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/layout#root-layout
- **Verbatim Quote:**
  > "A **root layout** is the top-most layout in the root `app` directory. It is used to define the `<html>` and `<body>` tags and other globally shared UI."
  > "The root layout **must** define `<html>` and `<body>` tags."
  > "You can type layouts with `LayoutProps` to get a strongly typed `params` and named slots inferred from your directory structure. `LayoutProps` is a globally available helper."
- **Justification:** The header appears on every comp page and the footer's contact line must be reachable from every page (E4, E5), so both are "globally shared UI" and belong in `app/layout.tsx`; the existing `LayoutProps<"/">` typing is kept.

### [C14] — Next.js `<Link>`: renders an `<a>`, supports hash targets, passes `className`

- **Relevant File(s):** `app/page.tsx`, `app/_components/site-header.tsx`, `app/_components/buttons.tsx`, `app/m/[claimToken]/claim-form.tsx`
- **Change Summary:** Internal navigation (`/share`, `/share#record`, `/share#form`, `/#story`) uses `next/link`; the cards are `<Link>` elements so they are keyboard reachable.
- **Source URL:** https://nextjs.org/docs/app/api-reference/components/link#scrolling-to-an-id
- **Verbatim Quote:**
  > "If you'd like to scroll to a specific `id` on navigation, you can append your URL with a `#` hash link or just pass a hash link to the `href` prop. This is possible since `<Link>` renders to an `<a>` element."
  > "`<a>` tag attributes such as `className` or `target=\"_blank\"` can be added to `<Link>` as props and will be passed to the underlying `<a>` element."
- **Justification:** `DESIGN.md` § 5.3 requires the cards to be real `<a href>` with hash targets on the share page, and § 8 requires real anchors everywhere; `<Link>` satisfies both while giving prefetching, and `className` passes through for the token utilities.

### [C15] — Next.js: private `_folder` for non-routable shared UI

- **Relevant File(s):** `app/_components/hearts.tsx`, `buttons.tsx`, `site-header.tsx`, `site-footer.tsx`, `field-classes.ts`
- **Change Summary:** Put the shared header, footer, hearts, buttons and field classes in `app/_components/`.
- **Source URL:** https://nextjs.org/docs/app/getting-started/project-structure#private-folders
- **Verbatim Quote:**
  > "Private folders can be created by prefixing a folder with an underscore: `_folderName`"
  > "This indicates the folder is a private implementation detail and should not be considered by the routing system, thereby **opting the folder and all its subfolders** out of routing."
  > "| `app/blog/_components/Post.tsx` | — | Not routable; safe place for UI utilities |"
- **Justification:** The house layering has no UI-components layer and forbids lower layers from importing `app/`; a private folder inside `app/` keeps the components next to their only consumers without creating a route or a new layer.

### [C16] — Sentry for Next.js: `app/global-error.tsx` captures render errors

- **Relevant File(s):** `app/global-error.tsx`
- **Change Summary:** Keep the Sentry capture effect while restyling the component and adopting the Next 16 props.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#capture-react-render-errors
- **Verbatim Quote:**
  > "Create `app/global-error.tsx` to capture errors that occur anywhere in your App Router application."
  > "useEffect(() => {    Sentry.captureException(error);  }, [error]);  return (    <html>      <body>"
- **Justification:** The `captureException` effect and the own `<html>/<body>` are the parts Sentry needs; everything else in the file is presentation and may change.

### [C17] — MDN: `prefers-reduced-motion: no-preference`

- **Relevant File(s):** `app/page.tsx` (ways cards)
- **Change Summary:** The only animation (the 3px card lift) runs only when the user has not asked for reduced motion.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion#syntax
- **Verbatim Quote:**
  > "`no-preference` Indicates that a user has made no preference known on the device. This keyword value evaluates as false."
  > "`reduce` Indicates that a user has enabled the setting on their device for reduced motion."
- **Justification:** `DESIGN.md` § 8 says to wrap the lift in `@media (prefers-reduced-motion: no-preference)`; Tailwind's `motion-safe:` variant (`[C20]`) compiles to exactly that query.

### [C18] — Project house rules: layers, client-component conventions, checks, TDD

- **Relevant File(s):** `AGENTS.md`, `docs/code-layout.md`, `eslint.config.mjs`, `app/_components/*`, `lib/format-duration.ts`, `__tests__/lib/format-duration.test.ts`, `docs/plans/*`
- **Change Summary:** Keep `app/` thin and importing downward only, extend the client-component ESLint pattern to `app/_components/**`, update the Checks sentence, add the duration helper to `lib/` with a test first, keep the plan and ledger in `docs/plans/`.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/main/docs/code-layout.md
- **Verbatim Quote:**
  > "`app/ → features/ → services/ → integrations/`. A layer imports only from layers below it plus `lib/` and `server/`. Nothing imports from `app/`."
  > "Client Components (by convention `*-form.tsx`, `*-client.tsx`, `recorder.ts`, `app/global-error.tsx`, `instrumentation-client.ts`) never import `@/server` or `@/integrations`; they call Server Functions."
  > "`npm run validate` (= `next typegen && tsc --noEmit`, then `eslint`), `npm run test:run`, `npm run build`. All three pass with `DATABASE_URL` unset and the network disabled; the build downloads nothing (fonts come from the `geist` package)."
  > "TDD for critical paths (upload tickets, finalize, confirmation, cron)."
- **Justification:** `app/_components/` is imported only by files in `app/` (relative paths), so nothing below `app/` depends on it, and adding it to the client-component ESLint pattern makes the rule hold mechanically; the Checks sentence changes because the font source and the offline command change; the one new pure function gets its test first; the plan copy and ledger section follow the `docs/plans/` practice already used for Phase 1.

### [C19] — `design/DESIGN.md`: the spec and its precedence rule

- **Relevant File(s):** `app/page.tsx`, `app/share/share-form.tsx`, `design/DESIGN.md`, `design/reference/home.html`
- **Change Summary:** Copy, sizes, field mapping and the thank-you headline come from the spec and the comps; where they conflict the comp wins; every intentional departure is listed in § 3.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/design/phase1-brand-handoff/design/DESIGN.md
- **Verbatim Quote:**
  > "**Source of truth for look and feel.** When this file and the current code disagree, this file wins. When this file and `reference/home.html` disagree, the reference HTML wins (it is the comp, exported from the design canvas)."
  > "**Share page** (`app/share/page.tsx`, `share-form.tsx`): restyle with the same tokens and the field styling in § 5.4. **Keep every existing field, name and validation** — the comp shows a simplified field set only to establish the look."
  > "Phone-in voicemail (there is no \"Call\" card — removed 2026-11-03), the obituary page, the memory wall, tag cloud, search, seasonal/Christmas variant. Don't build placeholders for them."
- **Justification:** These three sentences decide the field list (kept intact), the self-linking obituary button (omitted as a placeholder), and why the comp's values are copied into JSX; § 3 records each case where the app departs and why.

### [C20] — Tailwind CSS v4: `motion-safe` variant

- **Relevant File(s):** `app/page.tsx`
- **Change Summary:** Use `motion-safe:hover:-translate-y-[3px]`, `motion-safe:transition-transform` and the hover shadow tokens on the ways cards instead of a custom `.way:hover` rule.
- **Source URL:** https://tailwindcss.com/docs/hover-focus-and-other-states#prefers-reduced-motion
- **Verbatim Quote:**
  > "Tailwind also includes a `motion-safe` variant that only adds styles when the user has _not_ requested reduced motion. This can be useful when using the `motion-reduce` helper would mean having to \"undo\" a lot of styles:"
- **Justification:** The spec's lift is a hover-only transform that must vanish under reduced motion; `motion-safe:` applies it only under `prefers-reduced-motion: no-preference`, which is the exact media query `DESIGN.md` § 8 names, with no CSS outside the component.

### [C21] — MDN: `Referrer-Policy`, the `<meta name="referrer">` element and `no-referrer`

- **Relevant File(s):** `app/m/[claimToken]/page.tsx`
- **Change Summary:** Change the document meta from `same-origin` to `no-referrer` so the header links added by the root layout never send the claim token in `Referer`.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy#integration_with_html and https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy#no-referrer
- **Verbatim Quote:**
  > "You can also set referrer policies inside HTML. For example, you can set the referrer policy for the entire document with a [`<meta>`](…) element with a [name](…) of `referrer`:"
  > "`no-referrer` The [`Referer`](…) header will be omitted: sent requests do not include any referrer information."
  > "`same-origin` Send the [origin](…), path, and query string for [same-origin](…) requests. Don't send the [`Referer`](…) header for cross-origin requests."
- **Justification:** The existing meta sets the document policy to `same-origin`, which sends the full path (`/m/<token>`) on every same-origin navigation and prefetch, which is exactly what `next.config.ts` tries to prevent with its `no-referrer` header; with header links on the page, the meta must say `no-referrer` too.

### [C22] — Next.js `error.js` reference: `global-error` renders its own document; `retry`; `error: unknown`

- **Relevant File(s):** `app/global-error.tsx`
- **Change Summary:** Import global styles and fonts into `global-error.tsx`, type `error` as `unknown`, use `retry()` for "Try again", and set the title with React `<title>`.
- **Source URL:** https://nextjs.org/docs/app/api-reference/file-conventions/error#global-error and https://nextjs.org/docs/app/api-reference/file-conventions/error#retry
- **Verbatim Quote:**
  > "Global error UI must define its own `<html>` and `<body>` tags, global styles, fonts, or other dependencies that your error page requires. This file replaces the root layout or template when active."
  > "`global-error` and the built-in 500 page render their own document and do **not** include your global styles, so an app-level theme toggle (a class or `data-theme` attribute) won't reach them."
  > "In most cases, you should use [`retry()`](…) instead. However, if you have a specific reason to clear the error state and re-render the error boundary's children without re-fetching the contents, you can use the `reset()` function."
  > "The value that was thrown, forwarded to the `error.js` Client Component. Errors from Server Components arrive as an [`Error`](…) instance, while a value thrown in a Client Component is passed as-is and may not be an `Error`."
  > "| `v16.3.0` | `retry` prop became stable. |"
- **Justification:** The styles and fonts must be imported in the file itself (first two quotes); `retry` is the recommended recovery API on the pinned 16.4.4 and `error` is typed `unknown`, which `Sentry.captureException` accepts.

### [C23] — Tailwind CSS v4: `@utility` for custom utilities

- **Relevant File(s):** `app/globals.css`, `app/page.tsx`, `app/share/share-form.tsx`
- **Change Summary:** Define the patchwork frame as `@utility patchwork` instead of a plain class.
- **Source URL:** https://tailwindcss.com/docs/adding-custom-styles#adding-custom-utilities
- **Verbatim Quote:**
  > "Use the `@utility` directive to add a custom utility to your project:"
  > "Custom utilities are automatically inserted into the `utilities` layer along with all of the built-in utilities in the framework."
- **Justification:** As a utility, `patchwork` sits in the utilities layer with a predictable cascade and works with variants, which answers the review's point about unlayered rules overriding utilities (O28).

### [C24] — Node.js: `--require` preload and `NODE_OPTIONS`

- **Relevant File(s):** `scripts/no-network.cjs`, `package.json` (`build:offline`), `AGENTS.md`, `docs/code-layout.md`
- **Change Summary:** Prove the build makes no network calls by preloading a module that refuses non-loopback sockets into every Node process of the build.
- **Source URL:** https://nodejs.org/api/cli.html#-r---require-module and https://nodejs.org/api/cli.html#node_optionsoptions
- **Verbatim Quote:**
  > "Preload the specified module at startup."
  > "Modules are preloaded into the main thread as well as any worker threads, forked processes, or clustered processes."
  > "A space-separated list of command-line options. `options...` are interpreted before command-line options, so command-line options will override or compound after anything in `options...`."
- **Justification:** `NODE_OPTIONS=--require=./scripts/no-network.cjs` reaches `npm run build`'s children (`prisma generate`, `next build` and its workers), so any attempted download fails loudly; the `HTTPS_PROXY` trick the first draft used has no such guarantee.

### [C25] — npm: `--save-exact`

- **Relevant File(s):** `package.json`, `package-lock.json`
- **Change Summary:** Install the two font packages pinned to exact versions.
- **Source URL:** https://docs.npmjs.com/cli/v10/commands/npm-install#save-exact (the site returned HTTP 503 at fetch time; the quote is from the installed npm 10.9.9 documentation file `docs/content/commands/npm-install.md`, same text)
- **Verbatim Quote:**
  > "Dependencies saved to package.json will be configured with an exact version"
- **Justification:** Without the flag npm saves a caret range; the fonts are brand assets whose metrics must not drift under a minor update.

### [C26] — Playwright: `browserType.launch` `args`

- **Relevant File(s):** verification only (V3, favicon script in Step 3)
- **Change Summary:** Launch Chromium with the fake-media flags so the recorder can be exercised without a microphone, and render the favicon PNGs headlessly.
- **Source URL:** https://playwright.dev/docs/api/class-browsertype#browser-type-launch-option-args
- **Verbatim Quote:**
  > "`args` Array<string> _(optional)_ … Additional arguments to pass to the browser instance."
- **Justification:** `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` are Chromium arguments passed through this option; they make `getUserMedia` resolve with a synthetic track so start, stop, playback and remove can be verified in the container.

### [C27] — Repository CI: preview Neon branches are disposable

- **Relevant File(s):** verification only (V4)
- **Change Summary:** Run the database-backed checks on the PR's Vercel preview, whose Neon branch is deleted automatically when the PR closes.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/main/.github/workflows/neon-cleanup.yml
- **Verbatim Quote:**
  > "# Deletes the Neon branch that the Vercel–Neon integration created for a"
  > "# pull request's preview deployment (preview/<head branch>) once the PR closes."
- **Justification:** Test rows written on the preview live on `preview/claude/zealous-allen-pxrdpu`, not on `dev` or production, and vanish with the branch, so no cleanup step and no unidentified `.env.local` is needed.

**Source notes.** All external pages were fetched live on 2026-11-03. The EmpathIQ docs URL from the citation brief returns 404 (as the Phase 1 plan also recorded); the house conventions are cited from this repository's `docs/code-layout.md` instead. Auth.js and BAML are not involved in this change. The npm docs site was down (503) at fetch time; `[C25]` quotes the installed npm's own copy of the same page.