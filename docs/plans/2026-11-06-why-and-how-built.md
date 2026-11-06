# Why Rob built jowray.com, and how: home-page note, `/how-it-was-built` page, credit links, copy fixes

**Status:** approved by Rob 2026-11-06; in progress (see the ledger, §9). **Authority:** this file, `docs/plans/2026-11-06-why-and-how-built.md`, is authoritative; the draft it was copied from (`~/.claude/plans/1-please-think-of-sunny-mitten.md`) is not kept current. Update the ledger (§9) in the repo copy after every step. Evidence goes to `docs/plans/evidence/2026-11-06-why-and-how/`.

**If you are picking this up cold:** read §1 (rulings), §2 (cold start and resume), then the ledger (§9), and continue from the first step that is not `done`.

---

## 0. Context

Rob wants visitors to know why the site exists. At the military funeral of Jo's father Ivan (Rob's grandfather), at least 20 people never got to share their story, so Rob built this site for Jo. He also asked for:
- a technical "how it was built" section with diagrams and a link to the public GitHub repo;
- links on his and Tracy's names;
- Kay added to the footer credit;
- the home-page tagline Tracy dislikes, removed;
- light copy edits only.

---

## 1. Rulings (approved; do not re-ask)

| # | Date | Ruling | Source |
|---|---|---|---|
| R1 | 2026-11-06 | **Placement.** The Ivan story is a signed note on the home page, right after Jo's story. The technical details go on a new `/how-it-was-built` page, linked from the note and the footer. | AskUserQuestion |
| R2 | 2026-11-06 | **Telemetry disclosure.** Include one honest line about alpha error reports and session replays. | AskUserQuestion |
| R3 | 2026-11-06 | **Obituary names.** Link both "Robert Wray" and "Tracy Gold"; the words stay the same. | AskUserQuestion |
| R4 | 2026-11-06 | Rob's request: Kay goes in the footer: "Made with love by Richard, Kay, Rob, Tracy and Ava." | Rob's message, item 4 |
| R5 | 2026-11-06 | Rob's request: "surgically remove 'Hunt Valley, Maryland, by way of Reisterstown and a lot of summers on Lake George.' … Tracy doesn't like this." | Rob's message, item 6 |
| R6 | 2026-11-06 | Rob's request: "light editing only" | Rob's message, item 2 |
| R7 | 2026-11-06 | Review triage: do every Bucket 1 and Bucket 2 item that serves "world-class code … that will quickly pass a PR review"; Bucket 3 goes in Non-goals (§11), Bucket 4 in Follow-ups (§12); both also go in the PR body. | Rob's message |
| R8 | standing | Branch plus PR for every change. No `eslint-disable` without Rob's all-caps "YES". No band-aids, submodules or secrets. **Merge only when Rob says.** | AGENTS.md [C1] |
| R9 | 2026-11-06 | Rob's request: *"I'd like people to have a more detailed visual of how the system works and there is no reason we shouldn't re-use the mermaids from here"*. README.md's three Mermaid diagrams ("How a memory travels", "Architecture", "Data model") go on `/how-it-was-built` as a clearly secondary section, "The detailed version", after the plain-language sections; the HTML diagrams stay. Overrides N4 and N14 for these diagrams only. Built on `feat/detailed-diagrams`, to be merged into this PR's branch by the orchestrator. | Rob's message, relayed by the orchestrator |

**Copy status.** Every visitor-facing string below carries one of three tags:
- `[APPROVED]`: Rob's own words or rulings; ship as written.
- `[EDITED]`: Rob's text with the light edits listed; Rob reads it on the preview.
- `[PROPOSED]`: new copy; Rob reads it on the preview and may change it.

Copy is final only after Rob's preview read (ledger step 11).

---

## 2. Cold start and resume

| Item | Value |
|---|---|
| Repo | `/Users/rob/Documents/active_work/jowray_com`, remote `origin https://github.com/RobertdWray/jowray_com.git` (public since 2026-11-05) |
| Baseline | `origin/main` at `95f4df4c42280952688048c16f1195a9c3e1685b` (2026-11-06) |
| Worktree | `/Users/rob/Documents/active_work/jowray_wt_why-built`, branch `feat/why-and-how-built` |
| Toolchain | Node 26, then `npm ci` in the worktree [C2]. On Rob's Mac the default `node` is nvm's v22; Homebrew's is v26.13.0, so prefix every command with `export PATH=/opt/homebrew/bin:$PATH` (2026-11-06). npm 11 skips dependency install scripts; the root `postinstall` (`prisma generate`) still runs, which is all the checks need |
| Not needed | database, `.env`, migrations, new dependencies, production credentials, `vercel` CLI commands |
| Read first | `AGENTS.md` [C1]; `docs/code-layout.md`; `design/DESIGN.md` §3–§8 (but §8's "goldenrod focus ring" is stale, see Step 7); in the installed Next.js 16.4.4 docs under `node_modules/next/dist/docs/01-app/`: `01-getting-started/14-metadata-and-og-images.md` [C3], `01-getting-started/05-server-and-client-components.md` [C4], `02-guides/public-static-pages.md` [C5] |

**Resume rules (check before creating anything):**
1. `git -C /Users/rob/Documents/active_work/jowray_com worktree list`, `git branch -a | grep why-and-how`, `gh pr list --repo RobertdWray/jowray_com --head feat/why-and-how-built --state all`, and `git -C <worktree> status`.
2. If the worktree, branch or PR exists, reuse it and continue from the ledger. Never reset, force-push, or delete and recreate a branch, worktree or PR.
3. Leave `docs/memory-drafter.md` in the main checkout untouched. It is someone else's untracked work.
4. If `origin/main` has moved: `git fetch && git merge origin/main` into the branch (no rebase once pushed). Re-run §7. Re-check every fact in §6 whose source file changed.
5. `next dev` may re-add the generated block in `AGENTS.md`. If it shows in the diff, commit it with the work (AGENTS.md says so).

---

## 3. Shared constants: new `app/_components/external-links.ts` [C1][C6]

Exports `ROB_URL = "https://www.robwray.com"`, `TRACY_URL = "https://tracycgold.com"` and `REPO_URL = "https://github.com/RobertdWray/jowray_com"`. These are the final hosts; `curl -I` on 2026-11-06 showed robwray.com 308 → www and www.tracycgold.com 301 → the apex. The file is plain constants with no imports, so Client Components may import it (`_components` lint rule). External links use plain `<a href>` in the same tab, with no `target` (N10).

## 4. Home page: `app/page.tsx` [C6][C7]

**4a. Remove the tagline** `[APPROVED]` (R5). Delete the whole `<p className="text-body text-paper">` at `app/page.tsx:155-157`. Its only content is the tagline, so the left column keeps just the "Jo's story" `<h2>`. No other word in the band changes (N7).

**4b. New section** after `#story`: `<section id="why" aria-labelledby="why-heading" className="px-[max(16px,5%)] py-[72px]">` on the muslin ground.
- Inside it, a centered card: `mx-auto max-w-[760px] rounded-card border-[3px] border-dashed border-periwinkle bg-paper p-6 shadow-card sm:p-10`.
- Contents, in order: an uppercase `text-jo-red-deep` eyebrow, `<h2 id="why-heading">` in `font-display`, paragraphs at `text-body leading-[1.6]`, the signature in `font-display`, then the action row.
- Action row: `PrimaryLink` (`app/_components/buttons.tsx`) with `StitchedHeart color="#fff"` (`app/_components/hearts`), plus a text link styled with `linkClass` (`app/_components/field-classes.ts:14`).
- This is a static Server Component. No new Client Components [C4].

Copy:

> `[APPROVED]` **A note from Rob** *(eyebrow)* · **Why I built this** *(h2)*
>
> `[EDITED]` Many of you know that Jo's father, Ivan, was a Baptist minister and a chaplain in the Army. When he retired from the clergy, he never really stopped being a minister. It wasn't clear to me how much he was loved until his funeral, when we had a line out the door of people wanting to share how Ivan had changed their lives. We had a military funeral, and if memory serves, at least 20 people weren't able to share a story they had about Ivan.
>
> `[EDITED]` So I built this website for Mom, to make sure we capture her stories: to help cheer up Dad, to tell Ava who Grandma was when she is older, and, hopefully, to help all of us heal as we share with one another the love Mom brought us all.
>
> `[APPROVED]` [Rob Wray](ROB_URL), Jo's son
>
> [♥ Leave a memory of Jo] → `/share` · [How this site was built](/how-it-was-built)

Light edits to Rob's text (the full list):
1. "chaplain in the army" → "a chaplain in the Army" (capital A, as in the obituary)
2. "changed their life" → "changed their lives"
3. A comma after "We had a military funeral"
4. A paragraph break before "So I built"
5. Mom, Dad and Grandma capitalized, because they are used as names
6. "capture stories" → "capture her stories" (otherwise it can read as Ivan's stories)
7. "to" repeated through the list ("to help… to tell… to help"), and commas around "hopefully"
8. "share the love with one another that mom brought us all" → "share with one another the love Mom brought us all"

## 5. Footer, obituary, new page

### 5a. Footer: `app/_components/site-footer.tsx` [C6]
- Credit line, `[APPROVED]` (R4): `Made with love by Richard, Kay, <a href={ROB_URL}>Rob</a>, <a href={TRACY_URL}>Tracy</a> and Ava.`, with `linkClass` on both links. Put `{" "}` wherever a JSX line break would otherwise drop a space; Step 9's text diff checks this.
- Links line: `Jo's obituary · How this site was built`, with the middle dot in `<span aria-hidden="true">`.

### 5b. Obituary: `app/obituary/page.tsx:33` [C6]
- Wrap "Robert Wray" in `<a href={ROB_URL} className={linkClass}>` and "Tracy Gold" in `<a href={TRACY_URL} className={linkClass}>` (R3).
- The rendered text must be byte-identical to the baseline (Step 9).
- Edit the code comment at `:13-15` to read: words verbatim; two name links added at Rob's request on 2026-11-06.

### 5c. New page: `app/how-it-was-built/page.tsx` + `app/how-it-was-built/diagrams.tsx` [C3][C4][C5][C8][C9]
- **Rendering.** A Server Component with `export const metadata` and no request-time data. It stays fully static under Cache Components: the build lists it as `○ (Static)`. It adds no new Client Components and no diagram runtime; the site-wide Sentry browser instrumentation still runs on it, as on every page. No header nav entry (N5).
- **Metadata** `[PROPOSED]`: title "How this site was built — Jo Wray"; description "Why Rob Wray built jowray.com for his mom, Jo, and how it works: the trip a memory takes, what runs where, and how it was built with AI in three days."
- **Diagrams are HTML lists, not SVG or Mermaid** (N4). A scaled SVG's labels drop below the site's 17px text floor at 390px [C8], and Mermaid would need client JS. Each diagram is a `<figure>` holding a list of real text, with a `<figcaption>`.
  - `StitchedSteps({ label, steps })`
    - Markup: an `<ol role="list">` styled `list-none`. The explicit role keeps list semantics in Safari/VoiceOver once the markers are removed [C9].
    - Number badges: each step shows its number in a `jo-red` circle with `aria-hidden="true"`. The `<ol>` already gives the position, so the number is not announced twice.
    - The "stitched thread": a dashed `border-periwinkle` line joining the badges, drawn as an `aria-hidden` element.
    - Cards sit on `paper` with `walnut` text, at most 760px wide, in one vertical column at every width.
    - Used for diagrams 1 and 3.
  - `StackDiagram({ tiers })`
    - Three tiers in a `<ul role="list">`, joined by dashed `aria-hidden` connectors.
    - The last tier is a nested list of four cards: one column below 640px, two at 640px and up, four at 1024px and up.
- **Layout.** `main` is `mx-auto w-full max-w-[1200px] px-[max(16px,5%)] py-10`, with text blocks at `max-w-[40em]`. Body text never goes below 17px (DESIGN.md §4 [C8]). No horizontal scroll at 320px [C10].
- **Stale-copy markers.** Code comments flag two lines (F3, F4):
  - "Nothing you share is public yet": update it when the Phase 2 gallery ships.
  - The telemetry line: **update** it, not remove it, in the commit that ends the alpha settings. Plan §13 keeps sampled replay after the alpha [C11].

Page copy (every line `[PROPOSED]` unless tagged; the bracketed `F#` refers to §6):

> **Behind the scenes** *(eyebrow)*
> # How this site was built
> Jo's family wanted one place where everyone who knew her could leave a memory without making an account, installing anything, or being good with computers. Many of the people sharing are over 70 and on a phone, so every choice starts there. [F1]
>
> By [Rob Wray](ROB_URL), Jo's son. [Why I built it](/#why). · [See the code on GitHub] *(`<a>` with `secondaryButtonClass` → REPO_URL)*
>
> **Stat row (4 tiles):** **3 days** to build the first version, November 2–4, 2026 [F2] · **37** pull requests in those three days [F3] · **1,200+** automated tests [F4] · **0** accounts to make [F5]
>
> ## The trip a memory takes *(StitchedSteps)*
> 1. **You share.** Type a few words, record your voice, or pick photos and videos. No account needed. [F5]
> 2. **Your words are saved.** Your name, your words and when you sent them go into the family's database. [F6]
> 3. **Files go straight to private storage.** Photos, videos and recordings travel directly from your phone to a private store. Each file is checked to make sure it really is a photo, video or recording, and photos get a web-sized copy with the location data removed. [F7]
> 4. **You get a private link.** It's on the thank-you screen and in an email, so you can come back to fix a typo or add a photo. [F8]
> 5. **The family reads it.** Jo's family gets a note that a memory arrived and reads it on their private page. [F9]
> *Caption:* Every ten minutes, a background job looks for uploads that reached storage but still need finishing, and for emails that need another try. If an upload is interrupted, you may need to send that file again. [F10]
>
> ## What runs where *(StackDiagram)*
> - **Your phone or computer:** the share page, the recorder and the uploads, all in your web browser.
> - **The website, on Vercel:** Next.js 16 and React 19: the pages, the code that saves memories, the upload and media routes, and the ten-minute background job. [F11]
> - **Neon Postgres:** memories, names and their edit history. · **Vercel Blob:** photos, videos and recordings, kept private; uploads arrive here straight from your browser. · **SendGrid:** your receipt and the family's alert. · **Sentry:** error reports and recordings of visits, so problems get fixed fast. [F6][F7][F12]
> *Caption:* Inside, the code is layered so each part only talks to the ones below it: pages, then features, then services, then the outside vendors. A linter enforces it. [F13]
>
> ## How Rob and AI built it *(StitchedSteps)*
> The first version took three days and 37 pull requests. Rob decided what to build and made every call about Jo. AI coding agents, mostly Anthropic's Claude with OpenAI's Codex on some features, planned, built, tested and documented the work, and independent AI reviewers checked it. [F2][F3][F14]
> 1. **Rob decides.** What the site should do, how it should feel, and every call about Jo.
> 2. **A written plan.** An agent writes a plan with Rob's decisions quoted word for word, plus a "premortem": imagine it failed, then ask why. [F15]
> 3. **Built on its own branch.** Every change, even an urgent fix, gets its own branch, with tests written first for the risky parts like uploads and email. [F15]
> 4. **Reviewed.** A fresh AI reviewer reads the whole change, and for bigger changes two more AI models, Google's Gemini and OpenAI's Codex, review it independently. [F15]
> 5. **Rob approves, and it ships.** Automated checks must pass before anything reaches the live site. [F16]
> *Caption:* Then around again. You can read the plans, decisions and review notes in the repository. [F17]
>
> ## Made for Jo's people
> - Large text in Atkinson Hyperlegible, a typeface made for low-vision readers. [F18]
> - Big buttons, and nothing hidden behind a hover. [F19]
> - iPhone photos work as they are, including Apple's HEIC format. [F20]
> - The heart is the logo because Jo's maiden name was Hart. [F21]
>
> ## Built with
> Chips: Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Prisma 7 · Neon Postgres 18 · Vercel (hosting, Blob storage, cron) · SendGrid · Sentry · sharp and heic-decode (libheif in WebAssembly) · Vitest · Claude Code [F22]
>
> ## Privacy, in plain words
> - Your private link lets you see, correct or add to your memory. The site keeps a scrambled fingerprint of the link, never the link itself. Jo's family can also make corrections from their private page. [F23]
> - Files sit in private storage. Photos are shown from a copy with the location data removed. [F7]
> - Nothing you share is public yet. The family reads every memory first. [F24]
> - `[R2]` One honest note: during this early version, Rob uses detailed error reports and recordings of visits, including what people type and the photos on screen, to find and fix problems. Reports can include your name and email address. The family approved this. Some recordings, and screenshots sent with a problem report, can include private links. [F25]
>
> **The code is open.** The code, the plans and the decisions are [on GitHub](REPO_URL). [F17]
> [♥ Leave a memory of Jo] *(PrimaryLink → /share)*

## 6. Fact check (each claim, its source, verified 2026-11-06 at `95f4df4`)

Re-check any row whose source file changes before merge (§2 rule 4). "Exec" means: fill the value in at execution and record the commit.

| # | Claim in copy | Source and evidence | Verdict |
|---|---|---|---|
| F1 | Contributors are often over 70 and on a phone | README "What this is": "Most of the people sharing are over 70 and on an iPhone"; the copy softens "Most" to "Many" because no one has measured it | ok as softened |
| F2 | First version took 3 days, Nov 2–4, 2026 | First commit `f0cd5aa` 2026-11-02 14:40 −0500. README: "PR #1 on 2026-11-02 to PR #40 on 2026-11-04" | ok |
| F3 | 37 pull requests in those three days | `gh pr list --repo RobertdWray/jowray_com --state merged --limit 200 --json number,mergedAt --jq '[.[] \| select(.mergedAt >= "2026-11-02T05:00:00Z" and .mergedAt < "2026-11-05T05:00:00Z")] \| length'` → **37** (Eastern days). The same query with UTC days gives 35. PR numbers 1–40 share their sequence with issues, so "40" overcounts | ok, ET query recorded |
| F4 | 1,200+ automated tests (1,221 at `95f4df4`, 2026-11-06: 1,214 passed, 7 skipped) | **Done (was exec):** take the "Tests" count from Step 8's `npm run test:run` summary, round down to the nearest 100, and record the commit. README's "~1200" is not a source | exec |
| F5 | No account needed | No sign-in exists in Phase 1; README roadmap puts Auth.js in Phase 3 | ok |
| F6 | Name, words and time are saved; edit history kept | `lib/validations/memory.ts:69` (email, name); `features/memories/media-state.ts:42-48`: revisions keep "the first one … and the latest MAX_REVISIONS_PER_MEMORY − 1" (200). So the copy says "edit history", **not** "every edit" | ok as worded |
| F7 | Files go straight to private storage, are checked by type, and photos get a web copy without location data | README Security table: "Bytes never pass through our servers"; "A file becomes `READY` only once its first bytes match an allowed type"; "Photos are shown from a derived copy with EXIF and GPS stripped". The **15-minute** figure is left out: `lib/upload-ticket.ts:15-25` gives 15 min to *start* an upload and a 1 h Blob token for the transfer | ok, no duration |
| F8 | Link on the thank-you screen and by email | `app/share/thank-you-client.tsx:71` "Your private link to see, correct or add to this memory"; email is required (`lib/validations/memory.ts:59-63`) | ok |
| F9 | Family is told and reads on a private page | `ADMIN_NEW_MEMORY` alert (README Email row); `/admin` | ok |
| F10 | Ten-minute job; interrupted uploads may need resending | `app/api/cron/reconcile-uploads/route.ts:186`: rechecks `PENDING` media older than an hour, and can only find bytes that reached storage | ok as narrowed |
| F11 | Next.js 16, React 19 on Vercel | `package.json`: next 16.4.4, react 19.3.0; README Operations | ok |
| F12 | Sentry: reports and recordings | `instrumentation-client.ts:39-47` (`replaysSessionSampleRate: 1.0`, unmasked) | ok |
| F13 | Layered code, enforced by a linter | AGENTS.md "Layers and import direction … `eslint.config.mjs` enforces this with `no-restricted-imports`" [C1] | ok |
| F14 | Mostly Claude, Codex on some features | `git log` commits "(Astra implementation)" (e.g. `64603da`, `7c31909`), PR #15 branch `astra-work/…`; Astra workers run through Codex CLI | ok |
| F15 | Plans with verbatim rulings and premortems, branches, test-first on risky paths, fresh review plus Gemini/Codex review on bigger changes | README "How this was built" bullets; AGENTS.md "TDD for critical paths"; skills `george` (Gemini) and `oscar` (Codex). "Bigger changes" because not every PR got Team Code Review | ok as softened |
| F16 | Automated checks before live | Memory note "main ruleset blocks direct push": PR + `ci` required; production deploys from `main` | ok |
| F17 | Plans, decisions and review notes in the repo | `docs/plans/*` (e.g. `2026-11-04-share-form-quick-fixes.md` records Team Code Review triage). Not "every" plan or review | ok as narrowed |
| F18 | Atkinson Hyperlegible is for low-vision readers | Braille Institute [C12]. The "nothing under 17px" promise is dropped: Sentry's feedback widget is 16px (`app/globals.css:129-134`, F-up F1) | ok as narrowed |
| F19 | Big buttons, nothing behind a hover | `min-h-tap-lg` buttons (`buttons.tsx:5`); DESIGN.md §6 "no hover-only interactions". "No pop-ups" is dropped because the feedback form and the crash dialog exist (`instrumentation-client.ts:49-59`, `app/global-error.tsx`) | ok as narrowed |
| F20 | HEIC works | README Security "HEIC is decoded by libheif compiled to WebAssembly" | ok |
| F21 | Heart because of Hart | README "Jo's maiden name was Hart, so the heart is the mark" | ok |
| F22 | Stack chips | `package.json`: `@prisma/client` ^7.10.1, `tailwindcss` ^4, `typescript` ^5, `vitest` ^5.1.0, `sharp` 0.35.5, `heic-decode` ^2.1.0, `@vercel/blob`, `@sendgrid/mail`, `@sentry/nextjs` ^11.10.0; `.github/workflows/ci.yml:24` `postgres:18-alpine` | ok |
| F23 | Link edits; only a hash is stored; family can correct | README "The 32-byte token is hashed before storage"; `app/admin/actions.ts:53-58` `saveMemory` → `updateMemoryAsAdmin` | ok |
| F24 | Nothing public yet; the family reads first | No public memory pages exist in Phase 1 (README: "Nothing is shown publicly yet"); new memories arrive `PENDING` for admin review | ok until Phase 2 (F-up F4) |
| F25 | Unmasked replays, name and email in reports, private links can appear in replays and screenshots | `instrumentation-client.ts:20-26` (residuals: "the `/m/<token>` page URL inside replay DOM recordings … and user-taken feedback screenshots") and `:42-47` (`maskAllText: false`, `maskAllInputs: false`, `blockAllMedia: false`); AGENTS.md "contributor email and name as user context"; family approval in AGENTS.md [C1] | ok |
| F26 | R9 descriptions: Send saves the memory in Neon Postgres, files go straight to private Blob and are checked before they count, one receipt with every private link and a family alert with none; Server Functions, upload routes and the ten-minute job use Neon, Blob, SendGrid and Sentry, uploads never pass through the site's servers; only a SHA-256 of each private link is stored; User is for Phase 3 logins | README "How a memory travels" and "Architecture" blocks and the Security table ("Bytes never pass through our servers"); `prisma/schema.prisma:92` (`User`, "Phase 3 fills this in"); F7, F9, F10, F23. The README sequence label "issueUploadTicket (HMAC, 15 min)" shows the 15 minutes F7 leaves out of the plain copy; it is accurate for the ticket itself (`lib/upload-ticket.ts:15-25`), so it stays. The README ER line `Media o\|--o\| Media : replaces` understates the schema, which is one-to-many (`prisma/schema.prisma:178`, `replacements Media[]`); flagged to the orchestrator, README unchanged | ok; one README cardinality to decide |

## 7. Docs [C8]

- `design/DESIGN.md`
  - §5.7: Kay and the two name links in the footer line, and the second footer link.
  - §5.9: the two name links in the obituary.
  - New §5.10, "Note from Rob" (home `#why`).
  - New §5.11, `/how-it-was-built`: the two diagram patterns, why they are HTML (the 17px floor), the `role="list"` and `aria-hidden` rules, and the two lines that will go stale.
  - **Bucket 2:** fix §8's stale line "Visible goldenrod focus ring on everything focusable" to "Visible 3px walnut focus outline on everything focusable (goldenrod fails contrast)". `app/globals.css:111-114` sets the walnut outline and `:31` says goldenrod is "not the focus ring (contrast)".
- `README.md`
  - Add "**How it was built:** [/how-it-was-built](https://www.jowray.com/how-it-was-built)" to the Live line.
  - In "🤝 How this was built", add one sentence pointing at the page.
  - **Bucket 2:** in the same section, change "through 40 pull requests" to "through 37 merged pull requests" (F3).
- `docs/plans/2026-11-06-why-and-how-built.md`: this plan, kept current (Step 1).

## 8. Verification

Every result goes into the ledger and the evidence folder. Each screenshot or audit is recorded with its URL, viewport, browser, and commit SHA in `docs/plans/evidence/2026-11-06-why-and-how/README.md`.

1. **Baseline first** (Step 1, before any edit): start `npm run dev` in the worktree at `95f4df4` and save:
   - the `innerText` of `/obituary` `main`, of `/` `#story`, and of the footer, to `baseline-*.json`;
   - Lighthouse accessibility results for `/`, `/obituary` and `/share`.
2. **Checks:** `npm run validate`, `npm run test:run`, `npm run build:offline` [C2]. The build output must list `○ /how-it-was-built`. Record the test count (F4).
3. **Rendered-text diffs** against the baseline:
   - `/obituary` `main`: **identical** (links don't change `innerText`).
   - `#story`: only the tagline line is removed.
   - Footer: only "Kay, " is added, plus " · How this site was built".
   - This catches JSX whitespace mistakes. Save the diffs.
4. **Reflow and zoom** at 320, 390 and 1280 px wide, plus 1280 with the browser zoomed to 200% [C10]:
   - `document.documentElement.scrollWidth <= document.documentElement.clientWidth` on `/`, `/how-it-was-built` and `/obituary`;
   - one screenshot per page per width.
5. **Reading order:** take an accessibility-tree snapshot of `/how-it-was-built`.
   - Headings run h1 → h2 in order.
   - Each diagram is a list with the expected item count, and badges and connectors are absent from the tree.
   - The new links have readable names.
6. **Keyboard:** Tab through every new link. Each shows the 3px walnut outline (`app/globals.css:111-114`), not goldenrod.
7. **Lighthouse accessibility** on `/`, `/how-it-was-built`, `/obituary` and `/share`:
   - A finding on an element this PR added or changed is a regression. Fix it at the root.
   - A finding that is also in the Step 1 baseline is pre-existing. Log it in §12 (F5); do not fix it here.
8. **Footer smoke:** on `/share`, `/obituary` and `/how-it-was-built` the footer shows Kay, both name links and both page links.
9. **External links:** `curl -sI` each of `ROB_URL`, `TRACY_URL` and `REPO_URL` returns `200`, with no `location:` header.
10. **Tooling fallback:** use chrome-devtools MCP (isolated context) first, then the claude-in-chrome tools. If neither works, mark steps 4–7 `outstanding` in the ledger, ask Rob to check the preview, and do not mark the work done.

## 9. Ledger (update after every step)

| Step | What | Done when | Status | Commit | Evidence / notes |
|---|---|---|---|---|---|
| 0 | Plan triage after the outside review | This file revised; Rob's bucket rules applied | done 2026-11-06 | — | §10–§12 |
| 1 | Worktree, `npm ci`, plan copied to `docs/plans/2026-11-06-why-and-how-built.md`, baseline captured (§8.1) | Plan committed; `baseline-*.json` saved | done 2026-11-06 | `66ee216` | `baseline-home.json`, `baseline-obituary.json`; Lighthouse a11y 100 with 0 failures on `/`, `/obituary`, `/share` (evidence README) |
| 2 | `external-links.ts` | File exists; `npm run validate` passes | done 2026-11-06 | `146786f` | validate exit 0 |
| 3 | Home: tagline removed, `#why` note | §8.3 `#story` diff shows only the tagline gone | done 2026-11-06 | `146786f` | `text-diffs.txt`; ruling E2 |
| 4 | Footer | §8.3 footer diff as specified | done 2026-11-06 | `146786f` | `text-diffs.txt` |
| 5 | Obituary name links | §8.3 `/obituary` diff identical | done 2026-11-06 | `146786f` | `text-diffs.txt`: IDENTICAL |
| 6 | `/how-it-was-built` + diagrams | Builds as `○`; every §6 row still holds | done 2026-11-06 | `146786f` | F4 count: 1,221 tests at `95f4df4` → tile "1,200+"; rulings E1, E4 |
| 7 | DESIGN.md, README | Sections in §7 updated | done 2026-11-06 | `146786f` | ruling E3 |
| 8 | Checks | §8.2 all green | done 2026-11-06 | `146786f` | validate, test:run (1,214 passed, 7 skipped), build:offline all exit 0; `○ /how-it-was-built` |
| 9 | Browser verification | §8.3–§8.9 recorded in the evidence README | done 2026-11-06 | `146786f` | evidence README "After the change"; Lighthouse 100 / 0 failures on all four pages |
| 10 | Push, PR, preview | PR open with §11 and §12 in its body; preview URL and deployed SHA recorded here | done 2026-11-06 | `146786f` | PR #53; `ci` pass (2m29s); preview https://jowraycom-git-feat-why-and-how-built-rob-wrays-projects.vercel.app (deployment protection: 302 to Vercel login unless signed in) |
| 11 | Rob reads the copy on the preview (Rob) | Rob's changes applied, or "approved" recorded | pending | | |
| 12 | Merge (Rob's word only) | Rob says merge; `ci` green | pending | | |
| 13 | R9: detailed diagrams on branch `feat/detailed-diagrams` (from `d682edd`): generator `scripts/make-readme-diagrams.ts`, `public/diagrams/*.svg`, manifest `app/how-it-was-built/readme-diagrams.ts`, section in `detailed-diagrams.tsx`, drift test | SVGs match README (test green); section after "Privacy, in plain words"; DESIGN.md §5.11/§8 updated | done 2026-11-06 | `7483398` | rulings E7–E12; fact row F26 |
| 14 | R9 checks | `validate`, `test:run`, `build:offline` exit 0; `○ /how-it-was-built`; no horizontal page scroll at 320/390/640@2x/1280; Lighthouse a11y 100 | done 2026-11-06 | `7483398` | 1,237 tests (1,230 passed, 7 skipped); Lighthouse a11y 100 / 0 failed (52 passed) desktop and mobile; evidence README "Detailed diagrams (R9)" |
| 15 | R9 review and merge into `feat/why-and-how-built` (orchestrator) | Review subagent's findings handled; orchestrator merges | in progress: round 1 fixed (step 16) | | |
| 16 | R9 review round 1 ("do not approve yet"): CSP on `/diagrams/*`, allowlist safety check with 18 attack fixtures, source hash in each SVG header, AGENTS.md layout line synced (orchestrator authorized), deterministic re-render, all fences tracked, README-on-GitHub links | Every item in E13–E19 done; validate, test:run, build:offline green; no page scroll at 320/1280 | done 2026-11-06 | `7ec7ca8` | 1,260 tests (1,253 passed, 7 skipped); `○ /how-it-was-built`; Lighthouse a11y 100 / 0 failed (desktop); `/diagrams/*` headers and CSP behaviour in the evidence README |

**Done** means: steps 1–10 are `done`, every §6 row holds, the evidence is saved, and the PR plus preview link are with Rob. **Rollback:** revert the merge through a new branch and PR (`git revert -m 1 <merge-sha>`). No data, schema or environment changes are involved.

## 9a. Execution rulings (what changed while building, why, and the cost if wrong)

| # | What | Why | Cost if wrong |
|---|---|---|---|
| E1 | `/how-it-was-built` puts the side padding on `<main>` and the 1200px cap on an inner box (not one box, as §5c first said) | On one box the 5% resolves against the whole window, so the content started 40px right of the header logo at 1280px; the header already solved this the same way (`app/_components/site-header.tsx` comment). Logo and h1 now both sit at x=64 | None found: 320–1280px reflow and Lighthouse unchanged |
| E2 | The note's "Leave a memory of Jo" button is full width, centered and `text-balance` on phones; the card padding is `p-5` there (`sm:p-10`) | Inside the card the label must wrap below 640px; left-aligned it left "Jo" alone on the last line, which looked broken. Balanced, it reads "Leave a / memory of Jo" | Cosmetic only; `sm:w-auto` restores the desktop look |
| E3 | README: "a team of Claude agents" and "Claude agents planned, built…" now say "AI agents (mostly Claude)" / "mostly Claude with OpenAI's Codex on some features", next to the planned 40 → 37 fix | Same overstatement fact F14 corrects on the page; leaving it would make the README contradict the site | None: wording only |
| E4 | The test tile reads "1,200+" | 1,221 tests at `95f4df4`; "1,200+" stays true as tests are added, while "About 1,200" would drift | Low: if tests were ever deleted below 1,200, update the tile |
| E5 | "The code is open" is an h2, not a bold line | Every other section is an h2; a heading keeps the screen-reader outline consistent | None |
| E6 | Node: Homebrew's v26.13.0 via `PATH`, since the shell defaults to nvm's v22 (added to §2) | The repo targets Node 26 | None |
| E7 | R9 diagrams are **pre-rendered at development time** to committed SVG (`npx tsx scripts/make-readme-diagrams.ts`), not rendered in the browser | TrayVerify's investor site has no Mermaid renderer to reuse: its live architecture slide is React Flow, and Mermaid there is *generated text* for the deck export (`scripts/generate-deck-snapshot.ts`, `src/app/api/export-deck/extract-diagrams.ts`) committed under `diagrams/generated/` with "do not edit by hand; regenerate with …". We reuse that convention (generated, committed, regenerate command) and this repo's `scripts/make-email-assets.ts` precedent. Mermaid needs a real browser to measure text, so the script drives the installed Chrome; the build only serves files: no Mermaid JS for 70+ visitors on old iPhones, no network, the page stays `○`, and an `<img>` SVG cannot run script. A DOM-free renderer (`beautiful-mermaid` 1.1.3) was tried and rejected: hard-coded 11–13px text, a Google Fonts `@import` in its output, and text widths estimated for Inter | Regenerating needs Google Chrome on the developer's machine (or `CHROME_PATH`); the drift test makes a forgotten run fail `ci` |
| E8 | devDependencies `mermaid` 12.2.0 and `playwright-core` 1.64.1, exact pins, deliberately one release back (12.3.0 was 3 days old, 1.65.0 one day old) | Supply-chain caution; both are used only by the script. `npm audit`: the 20 findings are all pre-existing (none in either package's tree) | Larger `npm ci` (mermaid ≈128 MB on disk); no runtime cost |
| E9 | The script lifts two Mermaid sizes the config cannot reach: `autonumber` badges (hard-coded 12px digits, 6px radius → 17px bold, 13px radius) and ER relationship labels (`.edgeLabel .label` 14px → 18px via `themeCSS`); `flowchart.wrappingWidth` 400 so labels break only at README's `<br/>` | DESIGN.md §4's 17px floor at natural size. The script measures every text node's computed size and refuses to write an SVG with anything under 17px, so a Mermaid upgrade that moves these fails loudly | If a Mermaid upgrade renames `.sequenceNumber`, the floor check fails the run; adjust the script |
| E10 | The global `:focus-visible` rule in `app/globals.css` now also covers `[tabindex="0"]` | The scroll regions must be focusable (Lighthouse `scrollable-region-focusable`, keyboard scrolling) and show the site's 3px walnut ring; a site-wide rule is the root fix rather than per-element classes. No existing element used `tabIndex={0}` | None found |
| E11 | Images go through `next/image` with `unoptimized`, served from `public/diagrams/` | A plain `<img>` trips `@next/next/no-img-element`; `next/image` is already on the home page. `public/` gives a stable "Open … full size" URL | The image component's client chunk now loads on this page too (shared with the home page) |
| E12 | Each SVG embeds the Atkinson Hyperlegible weights it uses (latin, 400 and 700) as data: URLs | An SVG in `<img>` or opened on its own can load no outside fonts; without them the measured layout would not fit the fallback font | ≈ 23–46 KB per file; the files are 69–129 KB and lazy-loaded |
| E13 | `/diagrams/:path*` gets `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:` and `X-Content-Type-Options: nosniff` (`next.config.ts`, covered by `__tests__/next-config.test.ts`) | "Open … full size" serves each SVG as a same-origin document. The SVGs need only their inline `<style>` and data: fonts; `img-src data:` is kept for a future data: image. Verified in Chrome: the opened SVG loads both embedded weights with no console violations, and `Document-Policy: js-profiling` is still sent (rules add up). The page itself gets no CSP | If a future SVG needs another source, the opened file shows it unstyled; the page's `<img>` is unaffected |
| E14 | The SVG check is now `findUnsafeSvg` (`lib/readme-diagrams.ts`): a strict tokenizer (no DOCTYPE, CDATA, processing instructions or single-quoted attributes), entities decoded before any check, an allowlist of exactly the elements and attributes mermaid 12.2.0 emits here, `href`/`url()` only to `#id` or `data:`, at-rules only `@font-face`/`@keyframes`, no CSS escapes, no `on*`, no `<set>`/`<animate*>` on handlers or hrefs. The generator runs it before writing; the test runs it on every committed SVG and on 18 payloads spliced into a real SVG, each of which must be rejected for its stated reason | The review showed the old pattern test passing four payloads (entity-encoded `javascript:`, outside `<image>`, `@import`, `<set attributeName="onmouseover">`); an allowlist fails closed. It proves what the file contains, not how every browser parses it, so the CSP stays the second layer | A Mermaid upgrade that emits a new element or attribute fails the generator until someone reviews and widens the allowlist |
| E15 | Each SVG's first line records `source sha256 <hex>` of its README block; the test checks it against README.md as well as the manifest | Ties every committed file, not just the manifest, to the README text it shows | None |
| E16 | `handDrawnSeed: 1` | ER shapes go through rough.js even in the classic look, and its default seed is random, so `data-model.svg` changed on every run. Two runs on an unchanged README now give byte-identical SVGs and manifest (checked with `cmp`) | None |
| E17 | The README parser tracks every CommonMark fence (backticks or tildes, any length) | A `## ` line inside a bash code block, or a mermaid fence inside a tilde-fenced block, was misread; both are now test cases | None |
| E18 | Each figure links to its README section on GitHub ("Read … in the README on GitHub", `linkClass`), as its long description; the two links stack on phones (no dangling separator) | Anchors are GitHub's heading ids, read from the repository page on 2026-11-06: `-how-a-memory-travels`, `\uFE0F-architecture`, `\uFE0F-data-model` (the variation selector survives). `githubHeadingAnchor` reproduces github-slugger and is tested against those ids; the manifest stores them, ASCII-escaped. Not worded "as text": GitHub draws the block as a picture, and the Mermaid source is on README.md's Code view | A retitled heading fails the drift test until the script is re-run |
| E19 | Not done (optional): starting the data-model scroller on its content | The drawing's bounding box is already tight (the "replaces" label sits at the left edge); the empty area is the layout's top-left quadrant, and scrolling the region on load would need client JS | Cosmetic |

## 10. Outside review triage (2026-11-06)

All suggestions were checked against the source at `95f4df4`. **Bucket 1, applied above:**
- the privacy and telemetry line rewritten for the replay residuals, unmasked capture, and name and email in reports (F25);
- "update, not remove" the disclosure after the alpha [C11];
- the cron promise narrowed (F10);
- the 15-minute figure dropped (F7);
- "only way to edit" → the family can also correct (F23);
- "every edit" → "edit history" (F6);
- the 17px promise and stat tile dropped (F18);
- "no pop-ups" dropped (F19);
- 40 → 37 PRs, with the ET query recorded (F3);
- "every plan, review" narrowed (F17);
- the focus-ring check corrected (§8.6);
- the static and client-JS wording corrected (§5c);
- the fact table (§6);
- the added verification: text diffs, 320px and zoom, the accessibility tree, the footer smoke, and baseline vs. regression;
- the plan made durable in the repo;
- the cold-start appendix;
- the copy-status tags.

Added from my own checks:
- "AI agents (Claude)" → "mostly Claude, with Codex on some features" (F14);
- the link is also on the thank-you screen and email is required (F8);
- reports include name and email (F25);
- `role="list"` and `aria-hidden` badges [C9];
- this Citations section.

**Bucket 2, applied:** DESIGN.md §8 focus-ring line; the README PR count; Rob's optional VoiceOver pass on an iPhone during his preview read.

## 11. Non-goals (Bucket 3): what this PR deliberately does not do, and why

Raised in review or considered and rejected on 2026-11-06. Re-raise only with new evidence. (Written by a subagent that checked each reason against the source at `95f4df4`.)

| # | We are not… | Why | Source |
|---|---|---|---|
| N1 | Writing "dozens of pull requests" instead of a number | A precise, sourced count can be checked. 37 is the merged-PR count for November 2–4, 2026 in Eastern time; a reviewer's 35 used UTC day bounds (both re-run 2026-11-06). | plan §6 F3 |
| N2 | Changing the alpha telemetry settings (sampling, masking, replay) | Rob's 2026-11-04 ruling authorizes them, and the family approved them. This PR only describes them honestly. | AGENTS.md § Sentry; `instrumentation-client.ts:6-30` (ruling verbatim at `:12-18`) |
| N3 | Fixing the Sentry feedback widget's 16px text in this PR | It is a third-party widget and needs its own visual check of the open form. Tracked as follow-up F1. | `app/globals.css:129-134` (`#sentry-feedback`, `--font-size: 16px`); plan §12 F1 |
| N4 | Drawing the diagrams in SVG or Mermaid | A scaled SVG's labels fall under the 17px type floor on a phone, and Mermaid adds client JS. HTML lists reflow and are read as lists. **Superseded for the detailed diagrams by R9 (2026-11-06):** README.md's Mermaid diagrams are added as pre-rendered static SVG, never scaled down (text 17px or more), in sideways-scrolling regions, with no Mermaid client JS (E7). The three plain-language diagrams stay HTML lists, as this row says. | `design/DESIGN.md` §4; plan §5c |
| N5 | Adding `/how-it-was-built` to the header nav | It follows the obituary pattern: reached from text links and the footer only. The nav stays on the two visitor jobs, "Leave a memory" and "Jo's story". | `design/DESIGN.md` §5.9 ("no nav entry"); `app/_components/site-header.tsx` |
| N6 | Linking names anywhere else: the hero caption ("her son Rob"), the share form, the thank-you page, the claim page, or Richard, Kay and Ava anywhere | Rob asked for links on his and Tracy's names; they go in the note's signature, the footer and the obituary. Links inside the share flow pull people away mid-task, and Richard, Kay and Ava have no sites to link. | Rob's request, item 3 (plan §0); `app/page.tsx:49`; `app/share/share-form.tsx:589` and `app/share/thank-you-client.tsx:58` ("Richard, Rob and Tracy") |
| N7 | Light-editing the existing story band or other existing copy | That text is the family's, drawn from the obituary. "Light editing" (R6) applies to Rob's new note only. | `app/page.tsx:151-199` (`#story`); `design/DESIGN.md` §5.9, 2026-11-04 note |
| N8 | Changing any obituary words, including "of Hunt Valley, Maryland" | The obituary is the family's verbatim text, and R5 targets only the home-page tagline. Only the two name links are added (R3). | `app/obituary/page.tsx:13-15` (comment), `:10` and `:29` |
| N9 | Updating the design mockup or older plans that quote the old tagline | They are historical snapshots and are already recorded as such. | `docs/2026-11-04-debt-catalog.md:1604`; `design/reference/home.html:138`; `docs/plans/2026-11-03-brand-implementation.md:374` |
| N10 | Opening external links in a new tab | Older readers lose track of new tabs, so these are plain same-tab links. | plan §3 |
| N11 | Adding Vitest render tests for these pages | The repo has no page render tests: Vitest runs in a Node environment on `.test.ts` files, and these pages are static Server Components. Rendered-text diffs, the build and browser checks cover the text; TDD is reserved for critical paths (upload tickets, finalize, confirmation, cron). | `vitest.config.ts`; `__tests__/` (no page tests); AGENTS.md "TDD for critical paths"; plan §8.3 |
| N12 | Having the agent run VoiceOver itself | The agent cannot reliably drive VoiceOver, so the accessibility-tree snapshot stands in for it. Rob's optional iPhone pass covers the real thing. | plan §8.5; plan §10 Bucket 2 |
| N13 | A site-wide accessibility cleanup | Only regressions on elements this PR adds or changes are fixed. Findings already in the baseline are logged as follow-up F5. | plan §8.7; plan §12 F5 |
| N14 | Adding dependencies, database migrations, environment variables or secrets | None are needed for static copy and layout. **Superseded for the detailed diagrams by R9 (2026-11-06):** two exact-pinned devDependencies, `mermaid` 12.2.0 and `playwright-core` 1.64.1, run only in `scripts/make-readme-diagrams.ts` at development time (E8). No runtime dependency, migration, environment variable or secret. | plan §2 ("Not needed") |
| N15 | Removing the telemetry disclosure when the alpha ends | Replays continue at 10% after the alpha, so the line is reworded, not deleted (follow-up F3). | `docs/plans/2026-11-04-sentry-full-telemetry.md` §13 [C11]; plan §12 F3 |
| N16 | Repeating the Ivan story on `/how-it-was-built` | Ruling R1 places it on the home page; the tech page links to `/#why`. | plan §1 R1; plan §5c |
| N17 | Keeping a heavier ledger (separate per-step records, per-file evidence logs) | One ledger table with done-checks fits a copy-and-layout change of this size. | plan §9 |

## 12. Follow-ups (Bucket 4): real, out of scope; candidate GitHub issues

Copy these into the PR body. After merge, Rob decides which to file at https://github.com/RobertdWray/jowray_com/issues.

| # | Severity | Problem | Where | What a fix needs |
|---|---|---|---|---|
| F1 | Low | The Sentry "Report a problem" widget uses 16px text, under the site's 17px floor | `app/globals.css:129-134` (`#sentry-feedback { --font-size: 16px; }`); DESIGN.md §4 | Set `17px`, then screenshot the open widget at 390px in Chrome and Safari to confirm its form still fits |
| F2 | Medium (Rob's decision) | The telemetry rationale says "only family will be using it", but the home page invites "her students, her church friends, her neighbors". The 100-person launch reaches people who never approved unmasked replays | AGENTS.md Sentry section; `app/page.tsx` hero; issues #38/#43 | Rob decides one: add a short notice at the point of sharing (`lib/consent`, with a CONSENT_VERSION bump), or end the alpha settings before the wide launch (telemetry plan §13) |
| F3 | Low | The `/how-it-was-built` privacy line must change when the alpha settings end | `app/how-it-was-built/page.tsx` (code comment); telemetry plan §13 | In the same commit as §13: say replays are sampled and masked; keep the screenshot residual if still true |
| F4 | Low | "Nothing you share is public yet" goes stale when the Phase 2 gallery ships | `app/how-it-was-built/page.tsx` (code comment); issue #37 | Reword it in the gallery PR; add a checkbox to #37 |
| F5 | Not needed (2026-11-06) | Any accessibility finding Step 9 shows was already in the baseline. The baseline and after runs were both 100 with 0 failures, so there is nothing to file | Evidence README | One issue that lists the findings with their Lighthouse IDs and URLs |

## Citations

**[C1]**
- **Relevant files:** `app/_components/external-links.ts`, `app/how-it-was-built/page.tsx`, all steps
- **Change summary:** the process rules and alpha data policy the copy describes
- **Source URL:** `/Users/rob/Documents/active_work/jowray_com/AGENTS.md` (§ Project rules; § Sentry)
- **Verbatim quote:** "Never add an ESLint suppression (`eslint-disable…`) unless Rob approves with an all-caps "YES" after being asked." / "Allowed in Sentry: contributor email and name as user context, Server Function inputs and outputs, headers, Prisma query data, stack-frame locals, unmasked replays."
- **Justification:** sets R8, and backs F25's "Reports can include your name and email address".

**[C2]**
- **Relevant files:** worktree setup; §8.2
- **Change summary:** toolchain and the three checks
- **Source URL:** `/Users/rob/Documents/active_work/jowray_com/README.md` (§ Getting started)
- **Verbatim quote:** "**Prerequisites:** Node 26, npm. No database or `.env` is needed to run the checks; all three pass with `DATABASE_URL` unset."
- **Justification:** the cold start needs no database or secrets.

**[C3]**
- **Relevant files:** `app/how-it-was-built/page.tsx`
- **Change summary:** static `metadata` export
- **Source URL:** `node_modules/next/dist/docs/01-app/01-getting-started/14-metadata-and-og-images.md` (§ Static metadata, Next 16.4.4)
- **Verbatim quote:** "To define static metadata, export a [`Metadata` object](/docs/app/api-reference/functions/generate-metadata#metadata-object) from a static [`layout.js`](/docs/app/api-reference/file-conventions/layout) or [`page.js`](/docs/app/api-reference/file-conventions/page) file."
- **Justification:** the page exports `metadata`, exactly as `/obituary` does.

**[C4]**
- **Relevant files:** `app/page.tsx`, `app/how-it-was-built/*`
- **Change summary:** no new Client Components
- **Source URL:** `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` (line 188)
- **Verbatim quote:** "To reduce the size of your client JavaScript bundles, add `'use client'` at the top of the files that define your interactive components instead of marking large parts of your UI as Client Components."
- **Justification:** the diagrams and the note are not interactive, so they stay Server Components.

**[C5]**
- **Relevant files:** `app/how-it-was-built/page.tsx`; §8.2
- **Change summary:** the page prerenders as static
- **Source URL:** `node_modules/next/dist/docs/01-app/02-guides/public-static-pages.md` (line 54)
- **Verbatim quote:** "Since its output never changes and can be determined ahead of time, this kind of component is called a **static** component. With no reason to wait for a request, Next.js can safely **prerender** the page at [build time](/docs/app/glossary#build-time)."
- **Justification:** this is why the build must list `○ /how-it-was-built`, and why no `connection()` call is needed.

**[C6]**
- **Relevant files:** `app/_components/external-links.ts`, `site-footer.tsx`, `app/page.tsx`, `app/obituary/page.tsx`
- **Change summary:** where shared UI and constants live
- **Source URL:** `/Users/rob/Documents/active_work/jowray_com/AGENTS.md` (§ Layers)
- **Verbatim quote:** "`app/_components/` holds shared visitor-facing UI (header, footer, hearts, buttons, field classes). It is a Next.js private folder (not a route), imported only from `app/**` with relative paths, and it never imports `@/server`, `@/integrations` or `server-only` because Client Components use it"
- **Justification:** the link constants are app-only and import nothing, so `_components` is the right home.

**[C7]**
- **Relevant files:** `app/page.tsx`
- **Change summary:** the tagline to remove
- **Source URL:** `app/page.tsx:155-157` at `95f4df4`
- **Verbatim quote:** "Hunt Valley, Maryland, by way of Reisterstown and a lot of summers on Lake George."
- **Justification:** it is the entire content of that `<p>`, so removing the element whole is the surgical cut R5 asks for.

**[C8]**
- **Relevant files:** `app/how-it-was-built/diagrams.tsx`, `design/DESIGN.md`
- **Change summary:** HTML diagrams; type floor
- **Source URL:** `/Users/rob/Documents/active_work/jowray_com/design/DESIGN.md` (§4 Type)
- **Verbatim quote:** "**17px is the floor** — nothing on the site is smaller, including helper text and the footer."
- **Justification:** an SVG scaled to a 390px screen would shrink its labels below this, so the diagrams are HTML text.

**[C9]**
- **Relevant files:** `app/how-it-was-built/diagrams.tsx`
- **Change summary:** `role="list"` on unstyled lists
- **Source URL:** https://www.scottohara.me/blog/2019/01/12/lists-and-safari.html
- **Verbatim quote:** "If you want to override this heuristic for accessibility, you can always add an explicit ARIA role=”list”."
- **Justification:** the diagrams remove list markers, so they add `role="list"` to keep the steps announced as a list in VoiceOver. `eslint.config.mjs` has no `jsx-a11y/no-redundant-roles` rule, so this needs no suppression.

**[C10]**
- **Relevant files:** §8.4, `app/how-it-was-built/*`
- **Change summary:** the 320px reflow check
- **Source URL:** https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
- **Verbatim quote:** "Content can be presented without loss of information or functionality, and without requiring scrolling in two dimensions for: Vertical scrolling content at a width equivalent to 320 CSS pixels"
- **Justification:** sets the narrowest width checked and the no-horizontal-scroll test.

**[C11]**
- **Relevant files:** `app/how-it-was-built/page.tsx` (telemetry comment); §12 F3
- **Change summary:** update, not remove, the disclosure after the alpha
- **Source URL:** `/Users/rob/Documents/active_work/jowray_com/docs/plans/2026-11-04-sentry-full-telemetry.md` (§13)
- **Verbatim quote:** "restore `lib/sentry/data-collection.ts` to the Phase 1 values (all `false`/`[]`), set `replaysSessionSampleRate: 0.1`, `replaysOnErrorSampleRate: 1.0`, remove `maskAllText/maskAllInputs/blockAllMedia: false`, `tracesSampleRate: 0.2`."
- **Justification:** replays continue at 10% after the alpha, so the line must be reworded, not deleted.

**[C12]**
- **Relevant files:** `app/how-it-was-built/page.tsx` ("Made for Jo's people")
- **Change summary:** the typeface claim
- **Source URL:** https://www.brailleinstitute.org/freefont/
- **Verbatim quote:** "Atkinson Hyperlegible is the first font originally developed in 2019 for low vision readers."
- **Justification:** backs "a typeface made for low-vision readers" (F18).
