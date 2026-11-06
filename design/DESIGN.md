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
   - `approxDateText` → "When is this memory from? (roughly is fine)" (placeholder: *Summer 1985*)
   - `place` → "Where? (optional)" (placeholder: *her classroom*)
   Placeholders are one short example each, never a sentence: they vanish on focus and a long one is cropped or read as entered text.
   - `note` → "Your memory of Jo"
   - `file` + recorder → the "Rather say it than type it?" periwinkle box, then the dashed file field
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
tracycgold.com, added 2026-11-06), 18px contact line, then the 18px links line
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
"Tracy Gold" to tracycgold.com (Rob's request). The story band's tagline under
"Jo's story" was removed the same day (Tracy didn't like it); the heading stands
alone.

### 5.10 Note from Rob (home `#why`, added 2026-11-06)
After the story band, on the muslin ground: one centered `paper` card, 760px
max, 3px dashed `periwinkle` border, `shadow-card`. Uppercase red-deep eyebrow
"A note from Rob", h2 "Why I built this", Rob's two paragraphs about Ivan's
funeral (his words, lightly edited), a Fraunces signature linking "Rob Wray" to
robwray.com, then the primary "Leave a memory of Jo" (full width and
balanced-wrap on phones, so the label never leaves "Jo" alone on a line) and a
text link to `/how-it-was-built`.

### 5.11 How this site was built (`/how-it-was-built`, added 2026-11-06)
For curious visitors and the GitHub crowd; reached from the note and the footer,
no nav entry. Padding sits on `main` and the 1200px cap on the box inside it
(as in the header). Sections: intro with a dashed secondary "See the code on
GitHub", four stat tiles, three diagrams, "Made for Jo's people", "Built with"
chips, "Privacy, in plain words", and a closing primary "Leave a memory of Jo".

- **Diagrams are HTML lists, never SVG or Mermaid.** A scaled SVG shrinks its
  labels under the 17px floor on a phone, and Mermaid needs client JS.
  `StitchedSteps` is a numbered vertical timeline (red 48px badges joined by a
  dashed periwinkle "thread", `paper` cards); `StackDiagram` stacks tiers with
  dashed connectors and ends in a row of service cards (1, 2 or 4 columns).
- Unstyled lists carry `role="list"` (Safari/VoiceOver drops list semantics
  without markers). Number badges and connectors are `aria-hidden`; step titles
  are h3 under each section's h2.
- Every sentence is checked against the code in the plan's fact table
  (`docs/plans/2026-11-06-why-and-how-built.md` §6). Two lines will go stale
  and carry code comments: "Nothing you share is public yet" (Phase 2 gallery)
  and the alpha telemetry note (update it, don't delete it, when the alpha
  settings end; replays continue at 10%).

## 6. Layout
- Content max-width 1200px, 5% side padding (≥16px on phones).
- Section padding 64–72px top and bottom on desktop, 40–48px on phones.
- Every section is a wrapping flex row or a flex column; no fixed heights.
- Touch targets ≥44px, inputs and buttons 56–64px.
- No sticky header, no modals, no autoplay audio, no hover-only interactions.
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

## 8. Accessibility (non-negotiable)
- WCAG AA everywhere, AAA for body text (walnut on muslin and paper is).
- Real `<button>`, `<a href>`, `<label for>` on every control; no click
  handlers on divs.
- Visible 3px walnut focus outline on everything focusable (`app/globals.css`;
  goldenrod fails contrast as a focus color, so it is never the ring).
- Decorative SVGs `aria-hidden="true"`; the heart mark in the header is
  decorative (the wordmark carries the name).
- No text below 17px, no light-weight type, no text over photos.
- Reduced motion: the only animation is the 3px card lift; wrap it in
  `@media (prefers-reduced-motion: no-preference)`.

## 9. Not in Phase 1
Phone-in voicemail (there is no "Call" card — removed 2026-11-03), the
memory wall, tag cloud, search, seasonal/Christmas variant. Don't build
placeholders for them. (The obituary page left this list on 2026-11-03; see
§ 5.9.)

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
