# Design spec — jowray.com, Phase 1 (collect memories)

**Source of truth for look and feel.** When this file and the current code
disagree, this file wins. When this file and `reference/home.html` disagree,
the reference HTML wins (it is the comp, exported from the design canvas).

What's in this folder:

| File | What it is |
|---|---|
| `DESIGN.md` | This spec: rules, tokens, components, copy, accessibility |
| `tokens.css` | Tailwind 4 `@theme` block + base rules, ready for `app/globals.css` |
| `reference/home.html` | The home page comp (desktop 1280, fluid to 390). Open it in a browser. |
| `reference/thank-you.html` | The post-submit state |
| `reference/jo-santa.jpg` | moved to `public/photos/jo-santa.jpg` (served by the app; the comp references it there) |
| `reference/heart-stitched.svg` | The mark: running-stitch outline heart |
| `reference/heart-solid.svg` | Solid calico heart (favicon / avatar / thank-you) |

## 1. Direction in one line

**A celebration of Jo, not a memorial of her.** Warm, bright, handmade, a
little cheeky. If a screen would look at home on a funeral-home website, it's
wrong. Think a quilt on a porch swing, a kindergarten classroom wall, a
Christmas Eve living room.

Jo's maiden name was Hart. **The heart is the mark.** Always red, always
handmade-looking (stitched outline or solid "calico" with a stitch inside),
never a glossy icon or emoji.

## 2. Implementation plan (do these in order)

1. **Fonts.** The build must download nothing (see `AGENTS.md` § Checks), so
   do not use `next/font/google`. Add the self-hosted packages and import them
   in `app/layout.tsx`:
   ```
   npm i @fontsource-variable/fraunces @fontsource/atkinson-hyperlegible
   ```
   ```ts
   import "@fontsource-variable/fraunces";          // display
   import "@fontsource/atkinson-hyperlegible/400.css";
   import "@fontsource/atkinson-hyperlegible/700.css";
   ```
   Remove the Geist imports and classes from `app/layout.tsx`; Geist is not
   part of this brand. Set `className="h-full antialiased"` only.
2. **Tokens.** Replace the starter `@theme inline` block and body rule in
   `app/globals.css` with the contents of `design/tokens.css`. Delete the
   `prefers-color-scheme: dark` block: the site has one warm theme.
3. **Metadata.** `title: "Jo Wray — Leave a memory"`, description
   `"Tell us a Jo story. Her family is collecting memories of Velma Josephine
   \"Jo\" Wray — a voice recording, a photo, a video, or a few words."`
   Favicon: `reference/heart-solid.svg` rendered to `app/icon.svg` (Next
   picks it up) — keep `app/favicon.ico` as the fallback, regenerated from it.
4. **Hero photo.** Move `reference/jo-santa.jpg` to `public/photos/jo-santa.jpg`
   and render it with `next/image` (`sizes="(min-width: 900px) 560px, 100vw"`).
   Alt text is in the reference HTML; keep it.
5. **Home page** (`app/page.tsx`): rebuild to match `reference/home.html`
   section for section (§ 5 below). Keep it a static page; it links to `/share`.
6. **Share page** (`app/share/page.tsx`, `share-form.tsx`): restyle with the
   same tokens and the field styling in § 5.4. **Keep every existing field,
   name and validation** — the comp shows a simplified field set only to
   establish the look. Map as follows:
   - `name` → "Your name" (placeholder: *Jane Doe*; required since 2026-11-04)
   - `relationship` → "How you knew Jo (optional)" (placeholder: *former student*)
   - `email` → "Email" (placeholder: *your@email.com*; required since 2026-11-04: it is where the private link goes)
   - Each memory card opens with one helper line under its heading, `text-small` in the helper style:
     "Add at least one: a photo, a video, a voice recording or a few words. Everything else is optional."
     (Rob, 2026-11-06: a memory needs at least one of the four; the server refuses a card with neither files nor words.)
   - `approxDateText` → "When is this memory from? (optional, roughly is fine)" (placeholder: *Summer 1985*)
   - `place` → "Where? (optional)" (placeholder: *her classroom*)
   Placeholders are one short example each, never a sentence: they vanish on focus and a long one is cropped or read as entered text.
   - `note` → "Your memory of Jo (optional with a photo, video or voice recording)"
   - `file` + recorder → labelled "Add a photo, video or voice recording" (no "(optional)": the helper line says
     what a card needs), then the "Rather say it than type it?" periwinkle box, then the dashed file field
   - `visibility` → keep as a labelled select, styled like an input, below the file field
   - `contactOptIn` → the checkbox under the submit button, with the sentence from the comp ("Memories go to Richard, Rob and Tracy first…") as its surrounding copy
   - Submit button → "Send this to Jo's family" with the solid heart icon
7. **Thank-you state** (wherever the form's success currently renders): match
   `reference/thank-you.html`. The headline is **"Jo would have loved this."**
8. **`/m/[claimToken]`** and any other visitor-facing page: same ground, type
   and buttons. No page in the app keeps black-on-white Geist.

Run `npm run validate`, `npm run test:run`, `npm run build` as usual.

## 3. Color

Hex values and names are in `tokens.css`. Usage rules:

- **Red leads; everything else supports.** One red primary action per screen.
  Hearts are always `jo-red`.
- **Warm neutrals only.** Ground is `muslin` with the faint periwinkle gingham
  (`body` rule in `tokens.css`). Cards and the form sit on `paper`. No white
  (#fff) surfaces except the inside of inputs. No greys of any kind.
- **Text is `walnut`**, secondary text `walnut-soft`. Never black.
- **Small red text uses `jo-red-deep`**, not `jo-red` (contrast). Red at
  ≥24px bold may use `jo-red`.
- `periwinkle`, `goldenrod`, `lake-green` at their base values are **decor
  and grounds only** (patchwork, dashed borders, the story band, the focus
  ring). As text or a button they must use the `-deep` variants.
- Pastels only as tints of these colors, never as a base.
- **Never:** dove grey, lavender, navy-and-gold, gradients used as washes,
  black-and-white photo treatments.

Contrast checked: walnut on muslin 13:1, white on jo-red 5.5:1, jo-red-deep
on muslin 6.1:1, periwinkle-deep on muslin 5.6:1, white on lake-green 5.3:1,
walnut-soft on muslin 7.2:1.

## 4. Type

- **Display:** Fraunces (variable), weight 700–800, optical size on. Used for
  h1, h2, card titles, the photo caption, the pull-quote, and the footer line.
  Tight tracking (−0.015 to −0.02em) at display sizes only.
- **Body:** Atkinson Hyperlegible 400/700 for everything else, including
  labels, buttons and inputs. It was designed for low-vision readers; the
  audience is largely 70+.
- **Scale (desktop):** display 68 · h2 44 · card title 28 · lead 22 · body 20
  · label 19 · small 17. **17px is the floor** — nothing on the site is
  smaller, including helper text and the footer.
- **Phone:** display 44, h2 34; everything else unchanged.
- Line-height 1.5 for body, 1.02–1.1 for display.
- **No script or cursive fonts anywhere.** No italic Fraunces except the one
  closing line on the thank-you page.

## 5. Components (see `reference/home.html` for exact values)

### 5.1 Header
Stitched-heart mark (44px solid heart with the inner stitch) + "Jo Wray"
wordmark in Fraunces 700 30px. Right: text links at 19px 700, 44px tall
hit area. Wraps under the wordmark on phones.

### 5.2 Hero
Two columns that wrap (text `flex: 1 1 380px`, photo `flex: 1 1 400px`,
max 560px). Eyebrow in `jo-red-deep` 20px uppercase, tracking 0.08em:
"Velma Josephine "Jo" Wray, née Hart". H1: *Tell us a **Jo** story.* with
"Jo" in `jo-red`. Lead paragraph. Primary button + dashed secondary button.

**Photo treatment:** the photo sits in a `.patchwork` frame (16px padding,
6px radius, soft shadow) with a `paper` inner mount (14px padding), a
Fraunces caption underneath, the whole figure rotated −1.5°, and a red pill
"label" overlapping the bottom edge rotated +4°. This is the house photo
treatment for every photo on the site; never vignettes, never desaturation.

### 5.3 "Four ways to share" band
`paper` ground, 3px dashed `jo-red` rule top and bottom. Four cards in a
wrapping flex row (`flex: 1 1 200px`, min-height 220px, radius 18px, 24px
padding). The first (Record here) is the red card: `jo-red` ground, white
text, `shadow-card-red`. The other three: `muslin` ground, 3px `wood-light`
border, `shadow-card`. Each card: 44px stroke icon (inline SVG, 1.8 stroke,
round caps, `jo-red-deep` on light cards / white on red), Fraunces 28px
title, 18px line. Hover lifts 3px; the card is an `<a>` so it is keyboard
reachable. Cards link to the share page (`/share`, with `#record` for the
recorder).

Icons are hand-drawn stroke SVGs in the reference; there is no icon library.
Keep them inline and `aria-hidden="true"`.

### 5.4 Form
`paper` ground, 20px radius, 3px `wood-light` border, `shadow-form`, 32px
padding, 22px gap. Labels 19px 700 above the input, helper text 400
`walnut-soft` inline in the label. Inputs: 56px min height, 20px text at
regular weight (400; form controls inherit the label's 700 unless told
otherwise), 2px `wood` border, 12px radius, white inside, placeholder `wood`
(4.53:1 on white, the AA floor, so it is never lightened). Invalid, only after
a failed Send: 2px `jo-red-deep` border plus a 4px `jo-red-deep` ring at 40%,
cleared as soon as the person types in that field. Textarea 7 rows. File input on `muslin` with a 2px dashed `wood` border. Focus:
4px `goldenrod` outline. Submit: primary button (below). Errors: `jo-red-deep`
text at 17px under the field, kind in tone ("We'll need a name so the family
knows who to thank").

The recorder lives in a `paper` box with a 3px dashed `periwinkle` border,
16px radius, titled "Rather say it than type it?", with a `periwinkle-deep`
56px "Start recording" button and a 17px line "Up to 10 minutes. You can
listen back before you send it." (adjust the limit to whatever
`recorder.ts` enforces).

### 5.5 Buttons
- **Primary:** `jo-red` ground, white 22px 700 text, 64px min height, 14px
  radius, 30px side padding, `shadow-button-red` (a flat 5px offset — the
  "stitched-on" look; no blur), optional stitched-heart icon at left.
- **Secondary:** transparent, 3px dashed `wood` border, `walnut` 20px 700
  text, 64px min height, 14px radius. On the green band the dash and text
  are `#E7F0E3`.
- **Tertiary (periwinkle):** `periwinkle-deep` ground, white text, 56px.
- No hover-only affordances. Hover may darken the shadow; focus must be
  the goldenrod ring.

### 5.6 Story band
`lake-green` ground, `#FFFDF8` text, `#E7F0E3` secondary text. Two columns
that wrap. The Mrs. Claus paragraph is a pull-quote: Fraunces 24px on a
`rgb(255 253 248 / 0.12)` panel, 14px radius, no left border.

### 5.7 Footer
Centered: stitched-heart outline (40px), Fraunces 22px "Made with love by
Richard, Kay, Rob, Tracy and Ava." ("Rob" links to robwray.com and "Tracy" to
tracycgold.com as quiet links, added 2026-11-06; see §7a), 18px contact line, then the 18px links line
"Jo's obituary · How this site was built".

### 5.8 Thank-you
Centered, min full viewport height. 96px solid heart inside a 150px `paper`
circle inside a round `.patchwork` ring. H1 60px "Jo would have loved
this.", 22px lead, primary "Tell another one" + dashed secondary, and the
italic closer "Spelling, as promised, did not count."

### 5.9 Obituary page (`/obituary`, added 2026-11-03)
Rob asked for the obituary on the site but not prominent. One quiet column,
760px max, the stitched heart (40px) above an uppercase "Obituary" eyebrow and
the h1 'Velma Josephine "Jo" Wray', then the family's text verbatim at body size
(the church in the donations line links to tifumc.com). One dashed secondary
"Leave a memory of Jo" below. Reached only from a plain text link at the end
of the story band and the footer line "Jo's obituary"; no nav entry, no red
button. Links keep their resting color on hover (hover thickens the underline);
#E7F0E3 on lake green is 4.22:1 and fails AA for 20px regular text (see E17).
2026-11-04: the family's longer text (childhood, Girls in Action, Towson and the
blind date, the 1971 wedding) replaced the first draft; the story band now opens
with two short paragraphs drawn from it, and its pull-quote starts at "Jo loved
Christmas" so the wedding is told once.
2026-11-06: the words are unchanged, but "Robert Wray" links to robwray.com and
"Tracy Gold" to tracycgold.com (Rob's request), as quiet links (§7a). The story band's tagline under
"Jo's story" was removed the same day (Tracy didn't like it); the heading stands
alone.

### 5.10 Note from Rob (home `#why`, added 2026-11-06)
After the story band, on the muslin ground: one centered `paper` card, 760px
max, 3px dashed `periwinkle` border, `shadow-card`. Uppercase red-deep eyebrow
"A note from Rob", h2 "Why I built this", Rob's two paragraphs about Ivan's
funeral (his words, lightly edited), a Fraunces signature with "Rob Wray" as a
quiet link to robwray.com (§7a), then the primary "Leave a memory of Jo" (full width and
balanced-wrap on phones, so the label never leaves "Jo" alone on a line) and a
text link to `/how-it-was-built`.

### 5.11 How this site was built (`/how-it-was-built`, added 2026-11-06)
For curious visitors and the GitHub crowd; reached from the note and the footer,
no nav entry. Padding sits on `main` and the 1200px cap on the box inside it
(as in the header). Sections: intro with a dashed secondary "See the code on
GitHub", four stat tiles, three diagrams, "Made for Jo's people", "Built with"
chips, "Privacy, in plain words", "The detailed version" (added 2026-11-06, see
below), and a closing primary "Leave a memory of Jo".

- **The plain-language diagrams are HTML lists, never SVG or Mermaid.** A scaled
  SVG shrinks its labels under the 17px floor on a phone. They stay the
  accessible summary for everyone. `StitchedSteps` is a numbered vertical timeline (red 48px badges joined by a
  dashed periwinkle "thread", `paper` cards); `StackDiagram` stacks tiers with
  dashed connectors and ends in a row of service cards (1, 2 or 4 columns).
- Unstyled lists carry `role="list"` (Safari/VoiceOver drops list semantics
  without markers). Number badges and connectors are `aria-hidden`; step titles
  are h3 under each section's h2.
- Every sentence is checked against the code in the plan's fact table
  (`docs/plans/2026-11-06-why-and-how-built.md` §6). Two lines will go stale
  and carry code comments: "The family reads every memory before it appears on
  See memories." (update if the review/publishing policy changes)
  and the alpha telemetry note (update it, don't delete it, when the alpha
  settings end; replays continue at 10%).
- **"The detailed version"** (Rob, 2026-11-06, plan ruling R9): README.md's three
  Mermaid diagrams ("How a memory travels", "Architecture", "Data model") for
  technical readers, after the privacy section under a walnut-soft eyebrow "For
  the technically curious". `detailed-diagrams.tsx` gives each a `<figure>`: a
  figcaption with an h3 (the README heading) and a one-sentence description,
  then the image, then two links: "Open … full size" (the SVG) and "Read … in
  the README on GitHub" (the README section, its long description; GitHub's
  heading ids keep an emoji's U+FE0F, so two anchors start with it).
  - **Rendering.** `scripts/make-readme-diagrams.ts` renders the README blocks
    once, at development time, with real Mermaid in the installed Google Chrome
    (playwright-core), and writes `public/diagrams/<slug>.svg` plus the manifest
    `app/how-it-was-built/readme-diagrams.ts` (sizes and source hashes). The
    build only serves the committed files: no Mermaid in any bundle, no network,
    the page stays `○`. Shown through `next/image` with `unoptimized`, an SVG
    cannot run script. Opened full size, `/diagrams/*` is served with
    `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline';
    font-src data:; sandbox; frame-ancestors 'none'` and `nosniff`
    (`next.config.ts`): an opened SVG gets an opaque origin and no other site
    can frame it. Fixed ids, `handDrawnSeed: 1` and the pinned `look: "neo"`
    and `layout: "elk"` make a re-run on an unchanged README byte-identical on
    the same OS and Chrome version (the local Chrome measures the text). The
    script renders and checks every diagram before it writes any file.
  - **Theme.** Mermaid `base` theme from the tokens: paper ground, muslin shapes
    with `periwinkle-deep` borders, dashed `periwinkle` groups, `walnut` text
    and lines, `wood` lifelines, `wood-light` loop and note labels, walnut
    autonumber badges with paper digits. Atkinson Hyperlegible 18px, embedded in
    each SVG as a data: URL (an `<img>` SVG can load no outside font).
  - **17px floor.** At natural size: the script fails if any text computes
    under 17px. Two Mermaid sizes are not configurable and are lifted in the
    script: the `autonumber` digits (12px → 17px bold in a 13px-radius circle)
    and ER relationship labels (14px → 18px, via `themeCSS`).
  - **Fit, zoom and pan** (Rob, 2026-11-06; replaces R9's natural-size
    scroller). Each image fits its card, so the page never scrolls sideways,
    and Zoom or Full screen brings back the natural size. Above it, a toolbar:
    Zoom in, Zoom out, Fit, ← ↑ ↓ → and Full screen, at least 44px each; Zoom
    out, Fit and the arrows are `aria-disabled` at fit size. Dragging pans
    once zoomed in, the arrows pan without dragging (WCAG 2.5.7), and a plain
    wheel or swipe still scrolls the page. Full screen is a full-window
    `<dialog>` with the same controls, every gesture and the keyboard
    (`diagram-viewer-client.tsx`; plan
    `docs/plans/2026-11-06-privacy-note-and-diagram-viewer.md`).
  - **Text alternative.** `alt` names the diagram type and its parts;
    `aria-describedby` points at the visible description.
  - **Drift guard.** `__tests__/lib/readme-diagrams.test.ts` fails when a README
    block's SHA-256 differs from the one in the manifest or in the SVG's first
    line, or when a block is added, removed or retitled. Fix: run
    `npx tsx scripts/make-readme-diagrams.ts` and commit.
  - **Safety check.** `findUnsafeSvg` (`lib/readme-diagrams.ts`) runs in the
    script before any file is written and in the test on every committed SVG.
    It tokenizes the file strictly (no DOCTYPE, CDATA or processing
    instructions), decodes entities, then allows only the elements and
    attributes the generator emits; `xmlns` only on the root and only SVG's;
    no repeated attribute; `href` only to `#id`; CSS `url()` only to `#id` or
    an embedded WOFF2 font; CSS at-rules only `@font-face` and `@keyframes`;
    no CSS escapes, no CSS comments and no XML comments inside `<svg>`.
    Twenty-six attack payloads (encoded `javascript:`, outside `<image>`,
    `@import`, `<set>` on an event handler, an XHTML namespace, a `url()`
    split by a comment, and more) are spliced into a real SVG in the test and
    each must be rejected for its reason. It proves what
    the files contain, not how a browser parses them; the CSP above is the
    second layer.

### 5.12 See memories (`/memories`, added 2026-11-08)
Implemented on branch `see-memories`, not merged or deployed; the launch flag
keeps the pages dark until Rob's inventory sign-off. Explore (`/memories`),
Map (`/memories/map`), Timeline (`/memories/timeline`), Tags (`/memories/tags`)
and one memory (`/memories/<id>`) use the shared header, footer, hearts and
buttons. The [artboard spec](reference/see-memories/SPEC.md) and ten adjacent
PNGs are the design reference; this section describes the components as built
in `app/memories/_components/`.

- **Frame and bands.** `chips.ts` provides `bandClass` (5% side gutter, at
  least 16px), `innerClass` (1200px cap), `eyebrowClass` (bold red-deep
  uppercase), `paperBandClass` and `paperBandBothClass` (paper with 3px dashed
  red rules). Muslin/gingham ground, Fraunces headings and Atkinson body type
  continue the house style. Explore ends in the lake-green `ShareBand`.
- **View pills.** `ViewNav` offers Everything, By place, By year and By what
  she loved (“What she loved” on phones). The row scrolls horizontally on
  phones and wraps from `sm`; Explore adds decorative icons. `pillOnClass`
  is periwinkle-deep with white text and a 4px dark-blue shadow;
  `pillOffClass` is paper/walnut with a 3px dashed periwinkle edge. Both are
  rounded-full, 52px minimum on phones and `min-h-tap` from `sm`.
  The current link has `aria-current="page"`.
- **Chips and rows.** `CountChip` uses `chipOnClass` / `chipOffClass`: 48px
  minimum, rounded-full, bold label and `chipCountClass`'s normal-weight
  count. Off is dashed periwinkle on paper; on is a solid periwinkle-deep
  edge/fill with white text and the same 4px shadow. Selection is
  `aria-current="true"`; these are URL links, not toggle buttons. Place
  rows use `rowOnClass` / `rowOffClass`, `rounded-input`, a name and count;
  off has a wood-light border/shadow. `SearchForm` sits beside or below the
  view pills, with GET submission and a 400 ms typing enhancement.
- **Memory cards.** `MemoryCard` uses `cardClass`: paper, 3px wood-light
  border, `rounded-card`, `p-5`, `shadow-card`, with a 3px lift and deeper
  shadow only under `motion-safe`. The whole card is one link. PHOTO has a
  slightly tilted `patchwork-sm` frame and 4:3 lazy thumbnail over a
  placeholder; `FallbackImage` hides a failed image. VOICE has a dashed
  periwinkle box, decorative play circle/bars and duration. VIDEO has a
  dashed wood 16:9 tile, stitched red play badge and duration pill. TEXT
  uses a Fraunces quote clamped to six lines on phones, seven from `sm`;
  other excerpts use three. Name, relationship/date/place and patches
  follow; patches are labels (`cardTagClass`, or filled `cardTagOnClass`),
  never nested links. `CompactCard` uses a `KindBadge` and four-line excerpt
  for related memories and the phone map's short list. Audio/video only
  play on the individual page; `PhotoFigure` has the larger patchwork frame,
  caption, date/town pill and thumbnail buttons. Its main photo has no
  failed-image placeholder yet.
- **Map.** `UsMap` draws the lower-48 outline as a decorative
  `aria-hidden` SVG; heart pins and label pills are absolutely positioned
  HTML links, keeping text at 17px or more. Bigger hearts mean more memories;
  a selected heart is deeper red, larger and above its neighbours.
  Town points come from the memory, rounded to 0.05°, never a file's GPS.
  Places outside the outline or without coordinates remain in the lists.
  On the Map page, `HomeInset` (“Closer to home”) sits beside the map from
  `lg` and below it at narrower desktop widths. It does not float over it:
  the board's floating inset covered pins and the caption (SPEC §8).
- **Decades.** `DecadeBars` draws count-scaled vertical bars, periwinkle
  normally, periwinkle-deep when selected, wood-light when empty. Explore
  bars toggle a year filter; Timeline bars jump to decade anchors. Labels
  shorten to `’50`, `’60`, etc. below `sm`; desktop labels show the full
  decade and Explore adds counts. The timeline continues as a dashed red
  thread with hearts and year pills, with an undated group at the end.
- **Quilt.** `TagQuilt` wraps tilted Fraunces patches, larger for more
  memories, cycling dashed periwinkle, goldenrod, lake-green, sunhat-pink,
  plum and wood edges. The selected patch fills periwinkle-deep with white
  text and `shadow-button-periwinkle`; others are paper/walnut. Hover
  straightens/lifts only under `motion-safe`. Links carry counts and
  `aria-current`; co-occurring patches appear below the quilt.
- **Phones and XL.** Phone Explore omits the map and links to By place;
  chip rows scroll. `MapZoom` switches Close to home / Whole country with
  real `aria-pressed` buttons, initially home. `TimelineDecades` shows at
  most one decade below `sm`, uses `aria-expanded`/`aria-controls`, and
  follows decade hashes; desktop shows all. Both components have `noscript`
  styles to reveal their content, but these cannot replace the site's
  streamed “Loading…” fallback when JavaScript is off. Explore becomes
  three panes at `min-[120rem]` (1920px): filters, results, map. It is an
  approximation of Main-XL: extra space under search, vertical decade
  columns instead of horizontal rows, shared view pills/header and no XL
  inset. Explore starts with 12 cards at every width.
- **Dark flag.** `OpeningSoon` in `bands.tsx` shows a dashed periwinkle
  paper note: “Jo's family is reading every memory first. See memories
  opens November 10.” It includes the primary Leave a memory action.
  `PUBLIC_MEMORIES_ENABLED` is off by default: no header link, no memory
  data, and public media returns 404. Turning it on or off requires a
  redeploy; the intended opening date is 2026-11-10, not a live-status claim.

Contracts, tests, launch steps and known gaps: [See memories feature
document](../docs/features/see-memories.md).

## 6. Layout
- Content max-width 1200px, 5% side padding (≥16px on phones).
- Section padding 64–72px top and bottom on desktop, 40–48px on phones.
- Every section is a wrapping flex row or a flex column; no fixed heights.
- Touch targets ≥44px, inputs and buttons 56–64px.
- No sticky header, no modals, no autoplay audio, no hover-only interactions.
  Two modals are allowed, both at Rob's request (2026-11-06): the footer's
  Privacy note and the full-screen view of a diagram on /how-it-was-built.
- The page must look finished at 390px wide — most visitors arrive from a
  text-message link. `reference/home.html` at 390px is the phone comp.

## 7. Voice and microcopy
Warm, plain, a little playful. Jo was teasing and direct. Use the copy in
the reference files verbatim unless a field needs something it doesn't
cover; then write in the same register.

- **Say:** "Tell us a Jo story." · "Leave a memory of Jo" · "Send this to
  Jo's family" · "Jo would have loved this." · "Spelling doesn't count."
- **Never:** "In loving memory" · "Celebrate a life" · "Tribute wall" ·
  "Submit" · "Mrs. Claus" (except in the obituary pull-quote).
- Empty and error states sound like a kind teacher: "Nothing here yet — be
  the first to tell a Jo story."

## 7a. Links to people (added 2026-11-06)
The site is about Jo, not the people who made it. Links to a person's own site
(Rob, Tracy) use `quietLinkClass` (`app/_components/field-classes.ts`): the text
stays the color of the sentence, with a 1px `wood` underline 4px below it, which
darkens to walnut and thickens to 2px on hover and keyboard focus. Red (`linkClass`)
stays for every other link (pages of the site, the church, email) and for actions. No external-link icon: it would
pull the eye back to the names. Contrast: walnut text 11.2:1 or more on every
ground; the `wood` underline 3.37:1 on the darkest gingham square, 3.97:1 on
muslin, 4.46:1 on paper (Rob: "noticeable but more subtle… This website isn't
supposed to be about Rob or Tracy").

## 8. Accessibility (non-negotiable)
- WCAG AA everywhere, AAA for body text (walnut on muslin and paper is).
- Real `<button>`, `<a href>`, `<label for>` on every control; no click
  handlers on divs.
- Visible 3px walnut focus outline on everything focusable (`app/globals.css`;
  goldenrod fails contrast as a focus color, so it is never the ring). The rule
  covers links, buttons, form controls and any `[tabindex="0"]` element, such
  as the scrolling diagram regions on `/how-it-was-built`.
- Decorative SVGs `aria-hidden="true"`; the heart mark in the header is
  decorative (the wordmark carries the name).
- No text below 17px, no light-weight type, no text over photos.
- Reduced motion: the only animation is the 3px card lift; wrap it in
  `@media (prefers-reduced-motion: no-preference)`.

## 9. Not in Phase 1
Phone-in voicemail (there is no "Call" card — removed 2026-11-03) and the
seasonal/Christmas variant. Don't build placeholders for them. The memory
wall, tag cloud and search are built in See memories (§5.12, 2026-11-08).
(The obituary page left this list on 2026-11-03; see §5.9.)

## 10. Placeholders in the comp
`[PHONE-NUMBER]` on the "Text us" card's `sms:` link — fill from the
voip.ms number in `docs/`. The hero carries no dates on purpose (the
family hasn't settled on how to show them); leave them off.

## 11. Email (added 2026-11-03, confirmation email PR)
The one transactional email follows the same palette and voice, with the
constraints email clients impose (Outlook's Word engine, Gmail's CSS
subset). Rules that differ from the web pages:
- Table layout, inline styles, `bgcolor` fallbacks; no `box-shadow`,
  no CSS positioning, no `@font-face`. Display text falls back to
  `Georgia, 'Times New Roman', serif`; body to
  `'Atkinson Hyperlegible', Arial, Helvetica, sans-serif`.
- The flat "stitched-on" shadow is built structurally: an outer cell in
  the shadow colour with bottom padding around the button or card.
- Every image is an inline attachment (`cid:`); the email never loads
  anything from a URL, so no token or tracking request leaves the reader.
  Brand marks live in `lib/email-assets/` (generated from
  `design/reference/*.svg` at 2x by `scripts/make-email-assets.ts`).
- Badges (`badge-play`, `badge-audio`, `badge-video`, `badge-photo`) are
  the calico heart's idiom: jo-red disc, paper stitch ring, paper glyph.
- Two transactional emails share the chrome in
  `services/email/templates/shared.ts`: the contributor confirmation and
  the family-admin alert (`admin-new-memory.ts`). The admin alert carries
  **no links** by ruling: the edit link belongs to the contributor.
- Preview with `npx tsx scripts/render-email-preview.ts [out.html] [confirmation|admin]`;
  the sample comps are in `docs/plans/evidence/2026-11-confirmation-email/`
  and `docs/plans/evidence/2026-11-admin-alert/`.
