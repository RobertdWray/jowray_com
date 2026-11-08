# See memories: implementation spec extracted from the ten artboards

Source: `design/reference/see-memories/*.dc.html` (markup + `text/x-dc` script) and the matching PNGs, read 2026-11-07. Seed data `data/memories.js` is invented (100 memories, 23 places, 23 tags; every memory has a year, none is undated). Plan: `docs/plans/2026-11-08-see-memories.md`; where this file and the plan differ, the plan wins (see the last section).

Conventions in this file: `{x}` = computed value; "Tw" = Tailwind utility using the repo's `@theme` tokens in `app/globals.css`; "raw" = no token matches, use the arbitrary value given. All icons are 24×24 viewBox SVGs, `aria-hidden`, stroke 1.8, round caps/joins unless stated.

---

## 1. Token map (artboard value → Tailwind)

### Colours (all match `@theme` 1:1 except the two raw ones)

| Hex | Tw colour | Hex | Tw colour |
|---|---|---|---|
| `#c8102e` | `jo-red` | `#f6efe3` | `muslin` |
| `#a50d26` | `jo-red-deep` | `#fffdf8` | `paper` |
| `#7d0a1e` | `jo-red-shadow` | `#8a7259` | `wood` |
| `#5b7db1` | `periwinkle` | `#e9d9c0` | `wood-light` |
| `#3f5f94` | `periwinkle-deep` | `#2e2420` | `walnut` |
| `#26406a` | `periwinkle-shadow` | `#5a4a3e` | `walnut-soft` |
| `#e8a317` | `goldenrod` | `#3f7d4e` | `lake-green` |
| `#e0457b` | `sunhat-pink` | `#6b3a5b` | `plum` |
| `#fff` | `white` (Tailwind default) | `#efe4d2` | raw `bg-[#efe4d2]` (3rd photo-placeholder fill) |
| `#e7f0e3` | raw `border-[#e7f0e3]` (dashed border of the button on the lake-green share band) | | |

### Shadows

| Value | Tw |
|---|---|
| `0 6px 0 #e9d9c0` | `shadow-card` |
| `0 10px 0 #e9d9c0` | `shadow-card-hover` |
| `0 5px 0 #7d0a1e` | `shadow-button-red` |
| `0 5px 0 #26406a` | `shadow-button-periwinkle` (selected quilt patch) |
| `0 3px 0 #7d0a1e` | `shadow-pill` |
| `0 14px 30px rgb(46 36 32 / 0.18)` | `shadow-photo` |
| `0 4px 0 #26406a` (active pills/chips/rows, voice play circle) | no token: `shadow-[0_4px_0_#26406a]` |
| `0 4px 0 #e9d9c0` (unselected place rows, quilt patches) | no token: `shadow-[0_4px_0_#e9d9c0]` |
| `0 4px 0 #7d0a1e` (phone header CTA only) | no token: `shadow-[0_4px_0_#7d0a1e]` |

### Radii and heights

| Value | Tw | Value | Tw |
|---|---|---|---|
| 18px | `rounded-card` | 56px min-height | `min-h-tap` |
| 14px | `rounded-button` | 64px | `min-h-tap-lg` |
| 12px | `rounded-input` | 52px | `min-h-13` (raw-equivalent `min-h-[52px]`) |
| 999px | `rounded-full` | 48px | `min-h-12` |
| 16px (voice box, video tile, phone recording box) | raw `rounded-[16px]` | 44px | `min-h-11` |
| 6px / 3px / 4px / 2px (patchwork frames, thumbs) | raw `rounded-[6px]` etc. | 40px | `min-h-10` |
| 10px (phone decade chips) | raw `rounded-[10px]` | 72px | `min-h-18` |
| `8px 8px 0 0` bars (1280) / `6px 6px 0 0` (phone) | raw `rounded-t-[8px]` / `rounded-t-[6px]` | 32px / 30px tag chips | `min-h-8` / `min-h-[30px]` |

### Type

| Artboard style | Tw |
|---|---|
| Fraunces 800 68px/1.02 −0.02em (desktop h1) | `font-display text-display font-extrabold` |
| Fraunces 800 44px/1.02 −0.02em (phone h1) | `font-display text-display-sm font-extrabold` |
| Fraunces 700 44px/1.1 −0.015em (selected place/tag h2, share band h2 at 1280) | `font-display text-h2 font-bold` |
| Fraunces 800 44px/1.1 −0.015em (memory h1, 1280) | `font-display text-h2 font-extrabold` |
| Fraunces 700 34px/1.1 −0.015em (section h2) | `font-display text-h2-sm font-bold` |
| Fraunces 800 34px (XL header h1; phone decade label at leading 1) | `text-h2-sm font-extrabold` (+ `leading-none` for the decade label) |
| Fraunces 800 36px/1.05 −0.015em (phone memory h1) | raw `text-[36px] leading-[1.05] tracking-[-0.015em]` |
| Fraunces 700 28px/1.1 (h3, phone h2, XL map h2) | `font-display text-card-title font-bold` |
| Fraunces 800 60px/1 −0.02em (timeline decade label) | `text-thanks leading-none font-extrabold` (token is 60px/1.05) |
| Fraunces 800 44px/1 (stat-tile numbers) | raw `text-[44px] leading-none font-extrabold` |
| Fraunces 500 26px/1.4 (memory blockquote) | raw `text-[26px] leading-[1.4] font-medium` |
| Fraunces 24 / 23 / 22 / 21 px | raw `text-[24px]` … `text-[21px]` (22px may use `text-lead` size) |
| Fraunces 20px/1.35 (figcaption) | `font-display text-body leading-[1.35]` (same as home page) |
| Atkinson 22px | `text-lead` |
| Atkinson 20px | `text-body` |
| Atkinson 700 19px | `text-label font-bold` |
| Atkinson 18px (XL chips, XL card note) | raw `text-[18px]` |
| Atkinson 17px | `text-small` (17px is the floor; nothing smaller appears) |
| Eyebrow | `font-bold uppercase tracking-[0.08em] text-jo-red-deep` + `text-small` (390) / `text-body` (1280) |
| `dt` label | `text-small font-bold uppercase tracking-[0.08em] text-walnut-soft` |

Page frame (all boards): body gingham + muslin (already the `body` base rule); text walnut 20px/1.5. Sections use `px-[max(16px,5%)]` with an inner `mx-auto max-w-[1200px]` (1280 boards); phone uses `px-4`; XL uses `px-10` and no max width. Global link rule in the boards: `a{color:#a50d26} a:hover{color:#2e2420}` (= `linkClass`); focus: 3px walnut outline offset 2 (already global).

---

## 2. Shared pieces

### 2.1 Site header (1280 boards)
- `header py-5 px-[max(16px,5%)]`, inner `max-w-[1200px] flex flex-wrap items-center justify-between gap-x-8 gap-y-4` (= existing `SiteHeader`).
- Logo: `SolidHeart size={44}` + "Jo Wray" Fraunces 700 30px −0.01em.
- Nav `aria-label="Site"`, `text-label font-bold gap-x-7 gap-y-2`: **"See memories"** (active: `pt-[10px] pb-[7px] border-b-[3px] border-dashed border-jo-red`, `aria-current="page"`), "Leave a memory" → /share, "Jo's story" → /#story (both `py-[10px]`).
- Phone boards draw a different header (see §4.6). XL draws a header band (see §4.10).

### 2.2 View pills (`view-nav.tsx`)
| | 1280 (Main) | 1280 (Map/Timeline/Tags) | 390 | XL |
|---|---|---|---|---|
| Labels | Everything / By place / By year / By what she loved | same | Everything / By place / By year / **What she loved** | Everything / **Place / Year / Patches** |
| Icons | yes (below) | none | none | Everything only |
| Size | `min-h-tap px-[22px] gap-[10px] text-label font-bold rounded-full` | same | `min-h-13 px-[18px]`, `flex-none` | Everything `min-h-tap px-[18px] rounded-input` full width; others 3-col grid `min-h-13 px-[10px] rounded-input text-small` centred |
| Row | `flex flex-wrap gap-[10px]` | same, `pt-[6px]` | `flex gap-2 overflow-x-auto scrollbar-none px-4 pb-4` | stacked `gap-2` |
- Active: `bg-periwinkle-deep text-white shadow-[0_4px_0_#26406a]` + `aria-current="page"`; icon stroke white.
- Inactive: `border-[3px] border-dashed border-periwinkle bg-paper text-walnut`; icon stroke `jo-red-deep`.
- Icons (22px): Everything = 4 rects `x/y ∈ {3,14}`, 7×7, `rx 1.5`; By place = `M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z` + circle (12,11) r2.2; By year = `M3 12h18` + circles (7,12) and (17,12) r2.2 + `M7 9.8V5M17 14.2V19`; By what she loved = `M3 11V4h7l10 10-7 7L3 11z` + circle (7.5,8.5) r1.4.

### 2.3 Filter chips (decade, tag, kind)
- Off: `inline-flex items-center gap-2 min-h-12 px-[18px] rounded-full border-[3px] border-dashed border-periwinkle bg-paper text-walnut text-label font-bold`.
- On: same with `border-solid border-periwinkle-deep bg-periwinkle-deep text-white shadow-[0_4px_0_#26406a]`.
- Count after the name: `<span class="font-normal opacity-90">{n}</span>`.
- Phone: `flex-none gap-[6px] px-4`. XL: `px-[14px] text-[18px] justify-center`.

### 2.4 Place rows (Explore top places, Map "Every place", XL top places)
- `w-full flex items-center gap-3 rounded-input text-label font-bold`, off `border-[3px] border-wood-light bg-paper shadow-[0_4px_0_#e9d9c0]`, on `border-[3px] border-periwinkle-deep bg-periwinkle-deep text-white shadow-[0_4px_0_#26406a]`.
- Explore: `min-h-tap px-[18px]`; name left (`flex-1 text-left`), count right `text-small font-normal opacity-90` "{n} memories".
- Map: `min-h-18 py-[10px] px-[18px]`; left column name + years line `text-small font-normal opacity-90` "{min}–{max}"; right count Fraunces 800 28px `leading-none ml-auto`.
- Phone map: `min-h-tap px-4`; count Fraunces 800 24px.
- XL: `min-h-13 px-[14px] gap-[10px] text-[18px]`, name truncated (`truncate`), count `text-small font-normal opacity-90` digits only; unselected has **no** shadow.

### 2.5 Buttons and bands
- Primary (hero, memory page): `min-h-tap-lg px-7 rounded-button bg-jo-red text-white text-body font-bold shadow-button-red gap-3` + `StitchedHeart size 26 color #fff`. Existing `PrimaryLink` is 22px/30px pad (close; plan says use it).
- Secondary "Start at the beginning": `min-h-tap-lg px-6 rounded-button border-[3px] border-dashed border-wood bg-paper text-body font-bold` (= `SecondaryLink` + `bg-paper`).
- "Show everything again": `min-h-tap px-5 rounded-button border-[3px] border-dashed border-wood bg-paper text-label font-bold gap-[10px]`, X icon 22px `M6 6l12 12M18 6L6 18` jo-red-deep. Phone: `min-h-12 px-4 text-small self-start`, no icon.
- Load more: centred `min-h-tap-lg px-8 rounded-button border-[3px] border-dashed border-wood bg-paper text-body font-bold`; phone `w-full`.
- Paper band: `border-t-[3px] border-dashed border-jo-red bg-paper` (results, selected place/tag, "Close to this one"); "Ways to look" and the timeline jump band have `border-y-[3px]`.
- Empty state (Explore): `max-w-[40em] text-lead p-7 border-[3px] border-dashed border-periwinkle rounded-card bg-muslin` (XL: `bg-paper`; phone `text-label p-5`). Copy in §5.
- Share band (Explore only): `bg-lake-green text-paper py-16 px-[max(16px,5%)]`; inner `flex flex-wrap items-center justify-between gap-x-12 gap-y-6`; text column `flex-[1_1_420px] gap-[10px]`: h2 `text-h2 font-bold`, p `text-body leading-[1.6]`; link `min-h-tap-lg px-7 rounded-button border-[3px] border-dashed border-[#e7f0e3] text-paper text-body font-bold`. Phone: `py-8 px-4 gap-[14px]`, h2 `text-h2-sm`, link `w-full`.

### 2.6 Memory card (`memory-card.tsx`)
Base (1280 Explore): `<li class="min-w-0 flex">` → `<a class="flex-1 flex flex-col gap-4 rounded-card border-[3px] border-wood-light bg-paper p-5 shadow-card text-walnut no-underline min-w-0 motion-safe:transition-[transform,box-shadow] motion-safe:duration-150 motion-safe:hover:-translate-y-[3px] motion-safe:hover:shadow-card-hover">`, `aria-label="Open the memory from {who}, {when}"`.

Media slot by kind:
- **PHOTO**: frame `rotate-[-1.2deg]` (even index) / `rotate-[1.2deg]` (odd index); `p-2 rounded-[6px] shadow-photo` + patchwork at 16px squares (`patchwork-sm`: jo-red ground, periwinkle and goldenrod 45° checks, `background-size:16px 16px; background-position:0 0, 8px 8px`); inner `bg-paper rounded-[3px] p-2 pb-[10px]`; mount `aspect-[4/3] rounded-[3px]`, placeholder fill cycles `muslin` / `wood-light` / `#efe4d2` by `seed % 3`, centred photo icon 44px jo-red-deep (`rect 3,5 18×14 rx2`, `circle 9,10 r2`, `M21 16l-5-5-8 8`) + "{N} photos" / "1 photo" `text-small font-bold text-walnut-soft`. `role="img"`, aria "Placeholder for {N} photos from {who}" (placeholder only; the real card uses the image's alt).
- **VOICE**: `flex items-center gap-[14px] p-[14px] border-[3px] border-dashed border-periwinkle rounded-[16px] bg-muslin`; play circle 56px `rounded-full bg-periwinkle-deep shadow-[0_4px_0_#26406a]` with white triangle 24px `M8 5.5v13l11-6.5z`; bars: 24 × `w-1 rounded-[2px] bg-periwinkle`, `gap-[3px]`, row `h-12 overflow-hidden flex-1`, heights per §3; duration `text-small font-bold text-walnut-soft flex-none`. All decorative (`aria-hidden`).
- **VIDEO**: `relative aspect-video border-[3px] border-dashed border-wood rounded-[16px] bg-wood-light grid place-items-center`; badge-play 64px (circle r11 jo-red; circle r8.6 stroke paper 1.1 dash `1.8 1.6`; triangle `M9.6 7.8v8.4l6.6-4.2z` paper); duration pill `absolute right-3 bottom-[10px] px-3 py-1 rounded-full bg-jo-red text-paper text-small font-bold shadow-pill`. aria "Placeholder for a video from {who}, {duration}".
- **TEXT**: no media; note as `“{note}”` in Fraunces 500 24px/1.35 `line-clamp-7`.
- Non-TEXT note: `text-label font-normal leading-[1.5] line-clamp-3` (19px).

Footer of card: `mt-auto flex flex-col gap-0.5`: who Fraunces 700 21px; meta `text-small leading-[1.45] text-walnut-soft` = `[relationship, when, placeLabel].filter(Boolean).join(" · ")`.
Tag chips (Explore only, first 2 tags): `inline-flex items-center min-h-8 px-3 rounded-full border-2 border-dashed border-periwinkle bg-paper text-small font-bold text-periwinkle-deep`, row `flex flex-wrap gap-2`.

Variants by surface:

| Surface | pad / gap | Photo frame | Voice | Video | TEXT | Note | who | meta place | Tag chips |
|---|---|---|---|---|---|---|---|---|---|
| Explore 1280 | p-5 / gap-4 | p-2, inner p-2 pb-10px, icon 44 | 56px circle, 24 bars mod 40, h-12 | 64 badge | 24px clamp 7 | 19px clamp 3 | 21px | label or "place not given" | first 2 |
| Map 1280 | p-5 / gap-4 | same | same | same | 24 clamp 7 | 19 clamp 3 | 21 | omitted (meta = relationship · when) | none |
| Timeline 1280 | p-[18px] / gap-[14px] | same | same | same | 23 clamp 6 | 19 clamp 3 | 21 | label if any | none |
| Tags 1280 | p-5 / gap-4 | same | same | same | 24 clamp 7 | 19 clamp 3 | 21 | label if any | first 3; the selected tag's chip filled `bg-periwinkle-deep text-white` (no border) |
| Phone Explore | p-[18px] / gap-[14px] | same | p-3 gap-3, 20 bars | 64 badge | 23 clamp 6 | 19 clamp 3 | 21, no `mt-auto` | label if any | none |
| Phone Timeline | p-4 / gap-3 | p-[6px], inner p-[6px] pb-2, icon 40, gap-1 | 52px circle (play 22), 16 bars mod 36, h-11 | 56 badge, pill right-[10px] bottom-2 px-[10px] py-[3px] | 22 clamp 6 | 19 clamp 3 | 20 | label if any | none |
| XL | p-4 / gap-[14px] | p-[7px], inner p-[7px] pb-[9px], icon 40 | p-3 gap-3, 52 circle, 20 bars mod 36, h-11 | 56 badge, small pill | 22 clamp 6 | 18px leading 1.45 clamp 3 | 20 | label or "place not given" | first 2, `min-h-[30px] px-[10px] gap-[6px]` |

Compact "kind" card (Memory "Close to this one", phone map selected place): no media; header row `flex items-center gap-3` = kind badge 44px (36px phone map) + kind label `text-small font-bold text-walnut-soft`; note `text-label font-normal line-clamp-4`; who 21px; meta incl. place (phone map: relationship · when). Kind badge = jo-red circle r11 + paper dashed ring r8.6 (stroke 1.1, dash `1.8 1.6`) + paper glyph (stroke 1.3): PHOTO `rect 7.5,8.5 9×7 rx1` + `circle 10.5,11 r1 fill` + `M16.5 14l-2.5-2.5-4 4`; VOICE `rect 10.5,7 3×6 rx1.5` + `M8.5 11.5a3.5 3.5 0 0 0 7 0M12 15v2`; VIDEO filled triangle `M9.6 7.8v8.4l6.6-4.2z`; TEXT `M8 16l1.5-.5 6-6-1-1-6 6L8 16zM13.5 9.5l1 1`. Kind labels: PHOTO "Photos", VOICE "A voice", VIDEO "A video", TEXT "In writing".

### 2.7 US map (`us-map.tsx`)
- Box: `relative w-full aspect-[1000/560] rounded-card border-[3px] border-wood-light bg-paper shadow-card` (overflow visible).
- Outline: `<svg viewBox="0 0 1000 560" class="absolute inset-0 size-full" aria-hidden>`, one path, `fill=#f6efe3 stroke=#c8102e stroke-width=3 stroke-dasharray="9 7" stroke-linejoin=round stroke-linecap=round` (phone: width 4, dash `10 8`). Identical `d` in Main, Map, Phone-Map, Main-XL:

```
M13.5 30.8 L23.7 63.8 L25.3 114.4 L18.6 154.0 L22.0 178.2 L28.7 224.4 L50.7 264.0 L60.8 290.4 L82.8 334.4 L118.3 347.6 L138.6 369.6 L142.0 380.6 L182.5 376.2 L243.4 407.0 L292.4 407.0 L321.1 396.0 L348.1 424.6 L376.9 457.6 L407.3 440.0 L439.4 490.6 L474.9 525.8 L478.3 484.0 L491.8 470.8 L518.8 451.0 L535.7 442.2 L566.1 444.4 L599.9 455.4 L610.1 431.2 L633.8 424.6 L659.1 426.8 L684.4 442.2 L703.0 435.6 L721.6 457.6 L725.0 484.0 L738.5 512.6 L750.4 541.2 L762.2 541.2 L767.3 508.2 L758.8 470.8 L747.0 437.8 L743.6 420.2 L750.4 391.6 L770.6 374.0 L794.3 349.8 L804.4 343.2 L828.1 332.2 L845.0 319.0 L838.2 290.4 L836.5 275.0 L843.3 261.8 L851.8 250.8 L855.1 237.6 L868.7 215.6 L870.3 202.4 L877.1 200.2 L904.1 191.4 L916.0 182.6 L924.4 180.4 L937.9 178.2 L929.5 158.4 L926.1 147.4 L934.6 134.2 L958.2 118.8 L988.6 110.0 L975.1 90.2 L975.1 59.4 L956.5 55.0 L951.5 52.8 L932.9 81.4 L921.0 99.0 L880.5 105.6 L858.5 105.6 L831.5 123.2 L823.0 136.4 L787.5 143.0 L784.2 147.4 L787.5 151.8 L767.3 162.8 L740.2 182.6 L709.8 178.2 L716.6 169.4 L726.7 149.6 L725.0 127.6 L709.8 96.8 L689.5 88.0 L674.3 103.4 L659.1 123.2 L662.5 147.4 L640.5 173.8 L637.1 151.8 L650.6 107.8 L643.9 72.6 L633.8 63.8 L599.9 68.2 L564.5 66.0 L583.0 50.6 L606.7 39.6 L599.9 37.4 L522.2 24.2 L512.1 17.6 L37.2 17.6 L45.6 33.0 Z
```
- Map board only: extra connector `M 838 236 L 676 452`, stroke periwinkle 2, dash `6 6`, round cap (Maryland → inset).
- Pin: absolutely positioned at `left:{x}% top:{y}%`, `-translate-x-1/2 -translate-y-[82%]`, `flex flex-col items-center min-w-11 min-h-11`, contains `SolidHeart size={pinSize}` (fill jo-red; selected jo-red-deep; paper stitch) + label pill. Hover: heart `brightness(1.08)`.
- Projection: `x% = (lon + 125.5) × 1.69`, `y% = (49.8 − lat) × 3.9286`, `toFixed(1)`.
- Labels (HTML, never SVG text):
  - selected: full place label, `-mt-[6px] px-3 py-0.5 rounded-full bg-walnut text-paper text-small font-bold whitespace-nowrap shadow-pill`;
  - unselected with n > 1: count, `-mt-2 px-[9px] rounded-full bg-paper border-2 border-wood-light text-jo-red-deep text-small font-bold leading-[1.4]`;
  - n = 1: no label.
  - aria-label `"{place label}: {n} memory|memories"`.
- Home inset ("Closer to home"): bounds `−77.7 < lon < −74.7`, `38.1 < lat < 40.6` (exclusive). Inset label pill `-mt-[6px] px-[9px] rounded-full bg-paper border-2 border-wood-light text-walnut text-small font-bold leading-[1.4] whitespace-nowrap`, text `"{town} · {n}"` where town = label with `, MD|, PA|, DC` removed (first match only).

| Board | Inset box | Inset projection (x%, y%) | Big pin size | Inset pin size | Inset label |
|---|---|---|---|---|---|
| Main 1280 | none | – | `round(26 + √n·7) + (sel?6:0)` | – | – |
| Map 1280 | `absolute left-[26%] top-1/2 w-[30%]` over the map; `flex flex-col gap-2 pt-[14px] px-4 pb-4 bg-paper border-[3px] border-dashed border-periwinkle rounded-card shadow-card`; title Fraunces 700 21px; sub text-small walnut-soft; inner `aspect-square bg-muslin rounded-input` | `(lon+77.7)/3×100`, `(40.6−lat)/2.5×100` | `round(26 + √n·8)+6sel` | `round(24 + √n·6)+6sel` | "Town · n" for all (fixed style) |
| Phone Map | replaces the US map when "Close to home" is on; `aspect-square` paper box (card border/shadow), caption "Maryland and the neighbors" absolute `left-[14px] top-3 text-small font-bold text-walnut-soft` | `8 + (lon+77.7)/3×84`, `14 + (40.6−lat)/2.5×80` | `round(26 + √n·7)+6sel` (US pins have no labels) | same | "Town · n"; selected walnut/paper + `shadow-pill`, `leading-[1.5]` |
| XL | below the map, `p-[18px] bg-paper border-[3px] border-dashed border-periwinkle rounded-card` (no shadow); header h3 Fraunces 24 + "Maryland and the neighbors" text-small walnut-soft; inner `aspect-[2/1] bg-muslin rounded-input` | `6 + (lon+77.7)/3×88`, `18 + (40.6−lat)/2.5×74` | `round(24 + √n·7)+6sel` | `round(24 + √n·5)+6sel` | unselected "Town" (no count), `leading-[1.5]`; selected full label walnut pill |

### 2.8 Decade bars (`decade-bars.tsx`)
| | 1280 Explore | 1280 Timeline jump | 390 Explore | 390 Timeline jump | XL |
|---|---|---|---|---|---|
| Box | `flex flex-wrap items-end gap-[10px] pt-5 px-4 pb-4 bg-paper border-[3px] border-wood-light rounded-card shadow-card` | in the paper band, `flex flex-wrap items-end gap-2 flex-[1_1_560px]` | in paper band, `flex items-end gap-[6px]` | same | rows in the "When" card |
| Item | button `flex-[1_1_110px] gap-[10px]` | `<a href="#d1950">` `flex-[1_1_90px] gap-2` | button `flex-[1_1_0] gap-[6px]` | button | row button `min-h-12 px-3 rounded-input gap-3 text-label font-bold`; selected `border-[3px] border-periwinkle-deep bg-periwinkle-deep text-white`, else transparent 3px border |
| Bar area | h-20, bar `w-[58%] rounded-t-[8px]` | h-14, `w-[56%] rounded-t-[8px]` | h-12, `w-[70%] rounded-t-[6px]` | h-11, `w-[70%]` | label `w-[72px]`; track `flex-1 h-[14px] rounded-[7px] bg-muslin`; fill `rounded-[7px]`; count `w-9 text-right text-small font-normal` |
| Bar colour | sel periwinkle-deep; n>0 periwinkle; 0 wood-light | always periwinkle | sel periwinkle-deep; n>0 periwinkle; 0 wood-light | open periwinkle-deep; n>0 periwinkle; 0 wood-light | sel periwinkle-deep else periwinkle |
| Label | chip (§2.3) "1950s" | `min-h-11 px-[14px] rounded-full border-[3px] border-dashed border-periwinkle bg-paper text-label font-bold whitespace-nowrap` "1950s" | `min-h-10 w-full rounded-[10px] border-2 text-small font-bold`, off dashed periwinkle/paper, on solid periwinkle-deep/white; text "’50" (U+2019) | same chip, "’50" | "1950s" |
| Under label | count "{n} memory/memories" or "none yet", text-small walnut-soft | – | – (aria-label "1950s, {n} memories") | – (aria-label same) | – |

### 2.9 Tag quilt (`tag-quilt.tsx`)
- Container: `flex flex-wrap items-center justify-center gap-x-4 gap-y-[14px] py-10 px-8 bg-paper border-[3px] border-wood-light rounded-card shadow-card`.
- Patch: `inline-flex items-baseline gap-[10px] min-h-tap py-[10px] px-[22px] rounded-button font-display font-bold leading-[1.1]`, inline `fontSize` and `transform: rotate()`; `transition-transform duration-150`; `motion-safe:hover:-translate-y-[3px] motion-safe:hover:rotate-0`.
  - off: `bg-paper text-walnut border-[3px] border-dashed border-{edge} shadow-[0_4px_0_#e9d9c0]`;
  - selected: `bg-periwinkle-deep text-white border-[3px] border-periwinkle-deep shadow-button-periwinkle`.
  - count span: Atkinson `text-small font-bold opacity-85`.
  - aria-label `"{name}, {n} memory|memories"`.
- Order and cycles (index `i` = rank by count desc, ties in definition order): size `round(20 + (n/max)^0.8 × 26)` px (20–46); tilt `["-2deg","1.5deg","-1deg","2deg","-1.5deg","1deg","0deg"][i % 7]`; edge `[periwinkle, goldenrod, lake-green, sunhat-pink, plum, wood][i % 6]`.
- Only tags with count > 0 appear.

### 2.10 Hearts on the timeline thread
- 1280: cards column `border-l-[3px] border-dashed border-jo-red pl-10 relative`; per **year** block a `SolidHeart size 30` at `absolute left-[-57px] top-2` (centres on the line).
- 390: per **decade** a 30px rail column: `SolidHeart` (fill jo-red; open decade jo-red-deep) above `flex-1 border-l-[3px] border-dashed border-jo-red mt-1`.
- Year pill: `inline-flex px-4 py-[6px] rounded-full bg-jo-red text-paper font-display font-extrabold text-[24px] leading-none shadow-pill -rotate-2` + count `text-small font-normal text-walnut-soft` (`gap-[14px]`, inside `<h3>`); phone `px-[14px] py-[5px] text-[22px]`, `gap-3`.

---

## 3. Computations (as scripted)

| Value | Rule in the x-dc script |
|---|---|
| `stats.total` | number of memories |
| `stats.places` | distinct `placeId`s present |
| `stats.first` / `stats.last` | min / max `year` |
| `stats.decades` | distinct `floor(year/10)*10` |
| Facet counts (Explore) | each facet counted over memories passing every *other* filter (place counts skip `place`, decade skip `decade`, tag skip `tag`, kind skip `type`); search always applies |
| Search | lower-case substring of `[who, relationship, note, when, place name, tag names].join(" ")` (phone omits tag names) |
| Toggle | clicking the selected value clears it; any change resets page size |
| Explore list order | year desc, month desc (null = 0), id desc |
| Pins | places with count > 0; size and position per §2.7 |
| Top places | count desc, Explore 7, XL 8 |
| Decade range | fixed 1950–2020 in every board |
| Explore bar height | `n ? max(8, round(n/decMax × 80)) : 4` px; `decMax = max(1, max counts)` |
| Timeline jump bar | `n ? max(6, round(n/decMax × 56)) : 3`; counts after the kind filter |
| Phone Explore bar | `n ? max(6, round(n/decMax × 48)) : 3` |
| Phone Timeline bar | `n ? max(6, round(n/decMax × 44)) : 3` (unfiltered) |
| XL bar width | `n ? max(4, round(n/decMax × 100)) : 0` % |
| Tag chips | tags with count > 0 or selected; count desc; Explore top 12, phone top 10, XL all |
| Kind chips | PHOTO "Photos", VOICE "Voices", VIDEO "Videos", TEXT "Written", with counts |
| Summary (1280, XL) | no filters: `"{n} memories, newest first"`; else `"{n} {noun}"` + `" about {tag lower-case}"` + `" from {place label}"` + `" in the {decade}s"` + `" mentioning “{q}”"`; noun = kind plural (photos / voices / videos / written memories) or memory/memories |
| Summary (390) | no filters: `"Newest first"`; decade phrase `" from the {decade}s"`; no place facet |
| Load more | `"Show {min(page, n − shown)} more of {n}"`; page = 12 (1280), 16 (XL), 5 (390), 9 (Tags) |
| Duration text | `< 60 → "{s} sec"`, else `"{round(s/60)} min"`; empty if none |
| Phone clock | `"{floor(s/60)}:{ss}"` |
| Fake bars | `seed = int(digits of id) || 7`; `h_k = 8 + ((seed·37 + k·53 + k²·11) mod 40)` (24 bars, 1280); `mod 36` with 16/20 bars on phone timeline / XL; phone Explore 20 bars mod 40; recording box 40 bars `10 + (… mod 56)`, first 9 bars periwinkle-deep ("played"), rest periwinkle |
| Photo tilt | index even −1.2deg, odd 1.2deg |
| Placeholder fill | `[muslin, wood-light, #efe4d2][seed % 3]` |
| Timeline title | 1280 `"{last−first} years of Jo stories, {first} to {last}"`; 390 `"{last−first} years of Jo stories"` |
| Timeline decade | memories in decade sorted year asc, month asc; grouped by year asc; count `"{n} memory/memories"` or `"nothing yet"`; year count same nouns |
| Map selection | `?place` else the place with most memories; cards = that place's memories by year asc, first 6 (phone 3) |
| Map eyebrow | `"{n} memory/memories · {minYear}–{maxYear}"` |
| Map sub | `"The earliest is from {min}, the latest from {max}."` |
| Map "all" link | `"See all {n} in Everything"` (phone: `"See all {n} from {town}"`, shown only when n > 3) |
| Map no-place line | `"{k} memory doesn't / memories don't say where they happened. They're in Everything and on the timeline."` (hidden when 0) |
| Map "every place" years | `"{min}–{max}"` of that place |
| Tags selection | `?tag` else the top-ranked tag; list = memories with the tag, year desc; 9 per page |
| Tags eyebrow | `"{n} memory/memories carry this patch"` |
| Often stitched next to | tags co-occurring within the selected tag's memories, count desc, top 4, count = co-occurrences |
| Thread order (Memory) | year asc, month asc (null 0), id asc; `"Memory {i+1} of {N} on the thread"` (390: `"{i+1} of {N}"`) |
| Earlier / Later | `"{when} · {who}"` of neighbours; fallbacks "This is the first one" (390: "This is the first") / "Nothing later yet" |
| Close to this one | score = same place 3 + `|Δyear| ≤ 5` 2 + 1 per shared tag; keep score > 0; sort desc (ties: data order); top 3 |
| Where helper | `"{placeCount − 1} more from {label before comma}"`; no place → value "Not given", helper "See the map" |
| Photo pill | `[when, place label].filter(Boolean).join(", ")` |
| Caption | `"From {who}, {relationship}."` (placeholder for the media caption) |
| Thumbs | photos 2..N: label `"{i} of {N}"`, aria `"Photo {i} of {N}"`, tilt `i odd → 2deg, even → −2deg` |
| Pin/patch aria | `"{name}: {n} memory|memories"` / `"{name}, {n} memory|memories"` |
| Card aria | `"Open the memory from {who}, {when}"` |

---

## 4. Artboards, top to bottom

### 4.1 Main (Explore, 1280 × 2720; PNG ends inside the card grid, the share band is below the fold)
1. Header (§2.1).
2. **Hero** `section aria-labelledby="h1"`, `pt-6 pb-12`; inner `flex flex-wrap items-end gap-x-16 gap-y-8`.
   - Left `flex-[1_1_440px] min-w-0 flex flex-col gap-5`: eyebrow "Memories of Jo"; h1 "Every <span class="text-jo-red">Jo</span> story, in one place." (`text-display`); p `text-lead max-w-[34em]`: "So far her students, church friends, neighbors and family have left **{total} memories** from **{places} places**, stretching from **{first}** to **{last}**. Wander by place, by year or by what she loved. More arrive every day."; buttons row `flex flex-wrap items-center gap-4`: primary "Leave a memory of Jo" (→ /share, stitched heart), secondary "Start at the beginning" (→ timeline).
   - Right `ul role=list grid grid-cols-3 gap-4 flex-[1_1_360px]`: three stat tiles `flex flex-col gap-1 py-5 px-[18px] bg-paper border-[3px] border-wood-light rounded-card shadow-card`, rotations `-rotate-1`, `rotate-[0.8deg]`, `-rotate-[0.6deg]`; number Fraunces 800 44px leading-none (first `text-jo-red`, others walnut); label `text-small text-walnut-soft`: "memories", "places", "decades".
3. **Ways to look** band `aria-label="Ways to look"`, `border-y-[3px] … bg-paper py-7`; inner `flex flex-wrap items-center justify-between gap-x-8 gap-y-5`: view nav (`aria-label="View"`, icons) + search `flex-[1_1_320px] max-w-[460px] flex flex-col gap-[6px]`: label `text-label font-bold` "Look for a word, a name or a place" (`for="q"`), `input#q type=search placeholder="quilt"` = `inputClass` (`min-h-tap px-4 border-2 border-wood rounded-input bg-white text-body`).
4. **Where** `aria-labelledby="where-h"`, `pt-14 pb-6`; inner `flex flex-wrap items-start gap-x-12 gap-y-8`.
   - Map column `flex-[2_1_560px] gap-[14px]`: row (baseline, between) h2 "Where the stories happened" (`text-h2-sm`) + link "Open the big map" (`text-label font-bold`) → map; map (§2.7); caption `text-small text-walnut-soft`: "Each heart is a place someone remembers with Jo; the bigger the heart, the more stories. Tap one to keep only those."
   - List column `flex-[1_1_280px] gap-3`: h3 "Most of them close to home" (`text-card-title`); `ul gap-2` of top-7 place rows (§2.4).
5. **When** `aria-labelledby="when-h"`, `pt-8 pb-6 gap-4`: h2 "When" + link "Walk the whole timeline"; bars (§2.8); era line `ol role=list px-2 flex flex-wrap gap-x-[22px] gap-y-[6px] text-small text-walnut-soft`, each `<li><strong class="text-jo-red-deep">{range}</strong> {text}</li>` (copy §5).
6. **What she loved** `aria-labelledby="what-h"`, `pt-8 pb-10 gap-4`: h2 "What she loved" + link "See every tag"; tag chips `flex flex-wrap gap-[10px]`; kind row `flex flex-wrap items-center gap-[10px]`: "Kind:" (`text-label font-bold mr-[6px]`) + kind chips.
7. **Results** `aria-labelledby="list-h"`, paper band `pt-14 pb-16 gap-7`: header `flex flex-wrap items-center justify-between gap-x-6 gap-y-3`: h2 `{summary}` + "Show everything again" (only with filters); empty state when 0; grid `grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-6 items-start` (the board exposes card min 240–420px, default 300); load more.
8. **Share band** `aria-labelledby="cta-h"`: h2 "Did one of these remind you of your own?"; p "Three sentences count. A photo from a shoebox counts. Spelling doesn't count."; link "Leave a memory of Jo".
9. Design footer ("Made with ♡ for Jo." + Obituary / How it was built / Privacy) — dropped (D8); use `SiteFooter`.

### 4.2 Map (1280 × 2150)
1. Header.
2. Hero `pt-6 pb-10 gap-5`: eyebrow "Memories of Jo · by place"; h1 "Where the stories happened" (`text-display max-w-[14em]`); p `text-lead max-w-[36em]`: "Jo's father was an Army chaplain, so she grew up on posts from Washington State to Texas. She spent the rest of her life within a short drive of Cockeysville, which is why the map is lopsided. **{total} memories** from **{places} places** so far."; view nav (no icons, `pt-[6px]`).
3. Map section `aria-label="Map of the memories"`, `pb-12 gap-4`: big map + connector + "Closer to home" inset (title "Closer to home", sub "Maryland and the neighbors, up close"); caption `text-small text-walnut-soft max-w-[50em]`: "Each heart is a place someone remembers with Jo; the bigger the heart, the more stories. Tap a heart to read what happened there. A memory's exact address is never shown, only the town."
4. Selected place `aria-labelledby="place-h"`, paper band `pt-14 pb-16 gap-7`: header `flex flex-wrap items-end justify-between gap-x-6 gap-y-3`; left `gap-[6px]`: eyebrow `{n} memories · {min}–{max}`, h2 `{place label}` (`text-h2`), sub `text-body text-walnut-soft` "The earliest is from {min}, the latest from {max}."; right link-button `min-h-tap px-[22px] rounded-button border-[3px] border-dashed border-wood bg-paper text-label font-bold` "See all {n} in Everything". Cards grid as Explore (6 cards, Map variant). Fallback name when nothing: "Pick a place on the map".
5. Every place `aria-labelledby="every-h"`, `pt-14 pb-[72px] gap-5`: h2 "Every place, most stories first"; `ul grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-3` of Map place rows; no-place line `text-small text-walnut-soft`.

### 4.3 Timeline (1280 × 2720)
1. Header. `html{scroll-behavior:smooth}` on this page (use `motion-safe:` scroll-smooth).
2. Hero `pt-6 pb-10 gap-5`: eyebrow "Memories of Jo · by year"; h1 `{title}` (`max-w-[14em]`); p `text-lead max-w-[36em]`: "The thread runs from a girl folding paper crowns on an Army post to a grandmother with a drawer full of stickers. Dates are as people remembered them: "Summer 1985" counts."; view nav.
3. Jump band `aria-label="Jump to a decade"`, `border-y-[3px] … bg-paper py-6`; inner `flex flex-wrap items-center justify-between gap-x-8 gap-y-4`: jump bars (§2.8) + kind row `flex flex-wrap items-center gap-[10px]`: "Show:" (`text-label font-bold mr-1`) + chips "All", "Photos", "Voices", "Videos", "Written" (no counts; "All" selected when no kind; selecting sets, "All" clears).
4. Timeline `aria-label="The timeline"`, `pt-14 pb-12`; per decade `section id="d{decade}" aria-labelledby="h{decade}"` `flex flex-wrap gap-x-10 gap-y-6 pb-14`:
   - left `flex-[0_1_220px] min-w-[180px] gap-[10px] pt-1`: h2 "{decade}s" (60px jo-red), era Fraunces 700 24px/1.25, count `text-small text-walnut-soft`;
   - right `flex-[1_1_640px] min-w-0 gap-7` thread (§2.10): empty note `text-body text-walnut-soft py-5 px-6 border-[3px] border-dashed border-periwinkle rounded-card bg-paper max-w-[36em]` "Nothing from these years yet. Were you there? <a>Tell that Jo story</a>."; else year blocks `gap-4`: heart, `<h3>` year pill + "{n} memory/memories", cards grid `minmax(min(300px,100%),1fr) gap-5`.
5. Closing row `flex items-center gap-4 pl-[220px]`: `SolidHeart 44` + Fraunces 700 24px "The thread keeps going. <a>Add a stitch.</a>" (→ /share).
6. Not drawn: the "Not dated yet" group (plan D4) and decades outside 1950–2020.

### 4.4 Tags (1280 × 2300)
1. Header.
2. Hero `pt-6 pb-10 gap-5`: eyebrow "Memories of Jo · by what she loved"; h1 "A quilt of everything she loved"; p `text-lead max-w-[36em]`: "Every memory gets a few patches: what it's about, who's in it, what Jo was up to. The bigger the patch, the more stories. Tap one and the quilt shows you those."; view nav.
3. Quilt `aria-label="The tag quilt"`, `pb-14 gap-[14px]`: quilt (§2.9) + note `text-small text-walnut-soft max-w-[50em]`: "Patches come from the words people wrote, from what's in the photos and recordings, and from Jo's family. A memory can carry several."
4. Selected tag `aria-labelledby="tag-h"`, paper band `pt-14 pb-[72px] gap-7`: header `flex flex-wrap items-end justify-between gap-x-6 gap-y-4`; left `gap-2`: eyebrow "{n} memories carry this patch", h2 `{tag name}` (`text-h2`), row `flex flex-wrap items-center gap-2 pt-1`: "Often stitched next to:" (`text-label font-bold mr-1`) + up to 4 chips `min-h-11 px-4 rounded-full border-[3px] border-dashed border-periwinkle bg-paper text-label font-bold` "{name} <span font-normal opacity-90>{co}</span>"; right link-button "Mix this with a place or a year" (same style as Map's "See all"). Cards grid (Tags variant), 9 + load more "Show {k} more of {n}". Fallback name "Pick a patch".

### 4.5 Memory (one photo memory, 1280 × 2050)
1. Header.
2. "Where you are" `pt-2 pb-6`, `flex flex-wrap items-center justify-between gap-x-6 gap-y-3`: link `min-h-11 gap-[10px] text-label font-bold no-underline` chevron 22 `M15 5l-7 7 7 7` + "All the memories"; `text-small text-walnut-soft` "Memory {i} of {N} on the thread".
3. `article aria-labelledby="who"`, `pb-16`; inner `flex flex-wrap items-start gap-x-16 gap-y-12`.
   - **Figure** `flex-[1_1_440px] max-w-[600px] min-w-0 flex flex-col items-center -rotate-[1.5deg]`: `patchwork` (32px) `w-full p-4 rounded-[6px] shadow-photo` → inner `flex flex-col gap-3 bg-paper rounded-[3px] px-[14px] pt-[14px] pb-[18px]` → image `aspect-[4/3] w-full rounded-[3px]` (placeholder bg wood-light, icon 64, "Photo 1 of {N}" 19 bold, "Placeholder: the web copy of the original" 17) → figcaption `text-center font-display text-body leading-[1.35]`. Pill `relative -top-7 inline-block rotate-[4deg] px-[14px] py-2 rounded-full bg-jo-red text-paper text-small font-bold shadow-pill` (identical to the home page pill). Thumbs `ul aria-label="The other photos" -mt-2 flex flex-wrap justify-center gap-3`: buttons `size-24 p-[5px] rounded-[4px] patchwork-sm` rotated ±2deg, inner `size-full bg-paper rounded-[2px] grid place-items-center text-small font-bold text-walnut-soft` "{i} of {N}".
   - **Details** `flex-[1_1_400px] min-w-0 flex flex-col gap-6`:
     - `gap-2`: eyebrow "A memory from"; h1#who `{who}` (`text-h2 font-extrabold`); `text-lead text-walnut-soft` `{relationship}`.
     - blockquote `py-6 px-7 border-[3px] border-dashed border-periwinkle rounded-card bg-paper shadow-card`, p Fraunces 500 26px/1.4 `{note}` (no quote marks).
     - `dl grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-x-6 gap-y-4`; tiles `flex flex-col gap-1 py-4 px-[18px] bg-paper border-[3px] border-wood-light rounded-card` (no shadow): dt "When" → dd Fraunces 700 24px/1.2 `{when}` → dd `text-small text-walnut-soft` "as they remembered it"; dt "Where" → dd `{place label}` → dd link `text-small font-bold` "{k} more from {town}" (→ map).
     - Patches `gap-[10px]`: "Patches on this one" (`text-label font-bold`); links `min-h-11 px-4 rounded-full border-[3px] border-dashed border-periwinkle bg-paper text-label font-bold text-walnut no-underline` (→ tags `?tag=`). People chips (solid wood-light border, person icon) dropped (D8).
     - CTA row `flex flex-wrap items-center gap-4 pt-2`: primary "This reminds me of a Jo story" (stitched heart 26) → /share; link `text-label font-bold` "Something wrong here? Tell the family".
4. Earlier/Later `aria-label="Earlier and later"`, `pb-14`, `flex flex-wrap justify-between gap-4`: two links `flex-[1_1_300px] flex items-center gap-[14px] min-h-18 py-3 px-5 rounded-button border-[3px] border-dashed border-wood bg-paper text-walnut no-underline`; chevrons 26px jo-red-deep (`M15 5l-7 7 7 7`, `M9 5l7 7-7 7`); text column: `text-small text-walnut-soft` "Earlier on the thread" / "Later on the thread" + `text-label font-bold truncate` `{when} · {who}`; the right one `justify-end text-right items-end`.
5. Close to this one `aria-labelledby="near-h"`, paper band `pt-14 pb-[72px] gap-6`: h2 "Close to this one" + `text-walnut-soft` (body) "Same town, same stretch of years, or the same patches."; grid `minmax(min(300px,100%),1fr) gap-6` of compact kind cards (§2.6), 3 max.
6. Not drawn at 1280: VOICE/VIDEO/TEXT memory pages (phone voice in §4.9), the D16 status line.

### 4.6 Phone Explore (390 × 2250)
1. Header `pt-4 px-4 pb-2 flex items-center justify-between gap-3`: logo `SolidHeart 40` + "Jo Wray" Fraunces 700 26px; red button `min-h-12 px-4 rounded-button bg-jo-red text-white text-small font-bold shadow-[0_4px_0_#7d0a1e]` "Leave a memory" (no nav links).
2. Hero `pt-4 px-4 pb-5 gap-3`: eyebrow `text-small` "Memories of Jo"; h1 `text-display-sm` same sentence as 1280; p `text-label font-normal`: "**{total} memories** from **{places} places**, {first} to {last}. More arrive every day." No stat tiles, no hero buttons.
3. View pills row (scrolling; 4th label "What she loved").
4. Search `aria-label="Look for something"`, `px-4 pb-5 gap-[6px]`: label `text-small font-bold` "Look for a word, a name or a place"; input full width.
5. When band `aria-labelledby="when-h"`, `border-t-[3px] … bg-paper py-5 px-4 gap-3`: h2 `text-card-title` "When" + link `text-small font-bold` "Whole timeline"; compact bars; hint `text-small text-walnut-soft`: "Tap a decade to keep only those years." / with a decade "Showing the {decade}s. Tap it again for every year."
6. What she loved `py-5 gap-3` (on gingham, no band): h2 "What she loved" + link "All patches"; tag chips row `flex gap-2 overflow-x-auto scrollbar-none px-4 pb-1` (top 10); kind chips row (no "Kind:" label).
7. Results paper band `pt-6 px-4 pb-8 gap-5`: `gap-[10px]` h2 `text-card-title` `{summary}` + "Show everything again"; empty state; `ul flex flex-col gap-5` cards (phone variant); load more full width.
8. **No map / top places section on phone Explore.**
9. Share band `aria-label="Share yours"`: h2 "Did one remind you of your own?"; p "Three sentences count. Spelling doesn't."; full-width "Leave a memory of Jo".
10. Footer dropped (D8).

### 4.7 Phone Map (390 × 1780)
1. Header (phone).
2. Hero `p-4 gap-3`: eyebrow "Memories of Jo · by place"; h1 "Where the stories happened"; p `text-label font-normal`: "Most Jo stories happened a short drive from Cockeysville, but the Army took her family all over when she was a girl."
3. View pills row.
4. Map `aria-label="Map"`, `px-4 pb-4 gap-3`: segmented `div role="group" aria-label="How far out" flex gap-2`: "Close to home" / "Whole country" buttons `flex-1 min-h-13 rounded-full text-label font-bold` (on = active pill style, off = dashed), default "Close to home"; one of: home square (§2.7) or US map (no labels); caption `text-small text-walnut-soft` "Bigger heart, more stories. Tap one."
5. Selected place paper band `pt-6 px-4 pb-7 gap-4`: eyebrow `text-small` `{n} memories · {min}–{max}`; h2 `text-h2-sm` `{label}`; `ul gap-4` of 3 compact kind cards (36px badge, `p-4 gap-3`, meta relationship · when); link-button `min-h-tap rounded-button border-[3px] border-dashed border-wood bg-paper text-label font-bold` "See all {n} from {town}" (→ Explore with place), shown when n > 3. Fallback "Pick a place".
6. Every place `pt-6 px-4 pb-8 gap-3`: h2 `text-card-title` "Every place"; `ul gap-2` of phone place rows.

### 4.8 Phone Timeline (390 × 2250)
1. Header (phone).
2. Hero `p-4 gap-3`: eyebrow "Memories of Jo · by year"; h1 "{last−first} years of Jo stories"; p `text-label font-normal`: "Dates are as people remembered them. "Summer 1985" counts."
3. View pills row.
4. Jump band `aria-label="Jump to a decade"`, `border-t-[3px] … bg-paper p-4 gap-[10px]`: compact bars (button opens that decade; `aria-pressed` = open); hint `text-small text-walnut-soft` "Tap a decade to open it. One at a time keeps the page short." **No kind chips on phone.**
5. Timeline `pt-6 px-4 pb-2`: per decade `section id="d{decade}" flex gap-4 pb-3`: rail (§2.10) + body `flex-1 gap-[14px] pb-3`: header button `aria-expanded aria-controls="b{decade}" id="h{decade}" w-full min-h-tap flex items-center justify-between gap-3 text-left` containing `{decade}s` (Fraunces 800 34px leading-none jo-red), era (Fraunces 700 19px/1.25), count `text-small text-walnut-soft`, chevron 28px `M6 9l6 6 6-6` jo-red-deep rotated 180° when open; body `#b{decade} gap-5`: empty note (phone: `text-label font-normal p-4`) or year blocks `gap-3` with `ul flex flex-col gap-[14px]` of phone-timeline cards.
6. Closing row `flex items-center gap-3 pt-1 pb-6`: `SolidHeart 30` (no stitch) + Fraunces 700 21px "The thread keeps going. <a>Add a stitch.</a>"
7. Default open decade in the board: 1980 (hard-coded).

### 4.9 Phone Memory (voice, 390 × 1900)
1. Header (phone) — this board's button is the **dashed secondary** style (`border-[3px] border-dashed border-wood bg-paper text-walnut`), not red.
2. `nav aria-label="Where you are"` `pt-2 px-4 pb-4 flex justify-between gap-3`: "All the memories" (`text-small font-bold`, chevron 20) + `text-small text-walnut-soft` "{i} of {N}".
3. `article` `px-4 pb-6 gap-5`:
   - `gap-[6px]`: eyebrow `text-small` "A voice memory from"; h1 `{who}` (36px); `text-label font-normal text-walnut-soft` `{relationship}`.
   - Recording `section aria-label="The recording"` `flex flex-col gap-4 p-[18px] border-[3px] border-dashed border-periwinkle rounded-[16px] bg-paper shadow-card`: bars row `aria-hidden h-[72px] flex items-center gap-[3px] overflow-hidden` (40 bars `flex-1 min-w-[3px] rounded-[2px]`); time row `flex justify-between text-small font-bold text-walnut-soft` "0:00" / `{m:ss}`; button `w-full min-h-tap-lg rounded-button bg-jo-red text-white text-body font-bold shadow-button-red gap-3` white triangle 26 + "Listen · {duration}"; `text-small text-walnut-soft text-center` "Nothing plays until you press it."
   - blockquote (no border) `gap-2`: label `text-small font-bold uppercase tracking-[0.08em] text-walnut-soft` "In their words"; p Fraunces 500 24px/1.4 `{note}`.
   - Transcript box "Written out" / "The typed-out version of this recording appears here once Jo's family has it transcribed, so you can read along or search for a word." — dropped (D8).
   - `dl grid grid-cols-2 gap-3`; tiles `p-[14px] gap-0.5 rounded-card border-[3px] border-wood-light bg-paper min-w-0`: dt "When"/"Where", dd Fraunces 700 21px/1.2; no helper lines.
   - Patches `gap-[10px]`: "Patches on this one" `text-small font-bold`; chips `min-h-11 px-[14px] text-small` (people chip dropped).
   - Full-width **secondary** link `min-h-tap-lg rounded-button border-[3px] border-dashed border-wood bg-paper text-body font-bold gap-[10px]` + `StitchedHeart 24 color jo-red-deep` "This reminds me of a Jo story". No "Something wrong here?" link.
4. `nav aria-label="Earlier and later"` `px-4 pb-6 flex gap-[10px]`: two `flex-1 min-w-0 min-h-tap-lg py-2 px-[14px] rounded-button border-[3px] border-wood-light bg-paper` links (solid, not dashed); labels "Earlier" / "Later" (`text-small text-walnut-soft`) + value `text-small font-bold truncate`.
5. Close to this one paper band `pt-6 px-4 pb-8 gap-4`: h2 `text-card-title`; `ul gap-[14px]` cards `p-4 gap-[10px]`: kind label `text-small font-bold text-jo-red-deep` (no badge), note `line-clamp-3`, who Fraunces 20px, meta.

### 4.10 Main-XL (2400 × 2000, three panes)
1. Header band `py-4 px-10 border-b-[3px] border-dashed border-jo-red bg-paper`, `flex flex-wrap items-center justify-between gap-x-10 gap-y-4`: logo (44 heart + 30px name); middle `flex-[1_1_600px] flex flex-wrap items-center gap-x-6 gap-y-3`: h1 `text-h2-sm font-extrabold whitespace-nowrap` "Every <span jo-red>Jo</span> story, in one place." + stats `text-label font-normal text-walnut-soft`: "<b class=text-walnut>{total}</b> memories · <b>{places}</b> places · <b>{first}–{last}</b>"; nav: "See memories" (active underline), "Jo's story", CTA `min-h-tap px-[22px] rounded-button bg-jo-red text-white text-label font-bold shadow-button-red gap-[10px]` + stitched heart 22 "Leave a memory of Jo" (no "Leave a memory" text link).
2. `main flex flex-wrap items-start gap-6 pt-6 px-10 pb-10` (no max width):
   - **Filters aside** `aria-label="Filters"` `flex-[0_1_380px] min-w-[300px] gap-5`: view nav (XL style §2.2); search (label 19, input full width); "Kind" card `p-[18px] gap-[10px] bg-paper border-[3px] border-wood-light rounded-card shadow-card` with h2 Fraunces 700 24px "Kind" and `grid grid-cols-2 gap-2` chips; "When" card: h2 "When" + link `text-small font-bold` "Timeline", `ul gap-[6px]` of decade rows (§2.8), era line `text-small text-walnut-soft leading-[1.45]` (copy §5); "What she loved" card: h2 + link "All patches", all tag chips `flex flex-wrap gap-2`.
   - **Results** `flex-[999_1_900px] min-w-0 gap-5`: header `min-h-tap` h2 `{summary}` + "Show everything again"; empty state (paper bg); grid `grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-5` (4 columns in the PNG); load more (board: 16 per page).
   - **Map aside** `aria-label="Where"` `flex-[0_1_560px] min-w-[360px] gap-4`: header `min-h-tap` h2 `text-card-title` "Where the stories happened" + link "Big map" (`whitespace-nowrap`); US map; "Closer to home" box (§2.7); `ul grid grid-cols-2 gap-2` top-8 place rows (XL style); caption `text-small text-walnut-soft` "Bigger heart, more stories. Tap one to keep only those. Towns only, never an address."
3. Footer band (dropped, D8).

---

## 5. Copy

### 5.1 Copy about Jo's life (verbatim; D14: Rob confirms facts)

| Where | Text |
|---|---|
| Explore hero h1 (all sizes) | Every **Jo** story, in one place. (Jo in jo-red) |
| Explore hero p (1280) | So far her students, church friends, neighbors and family have left **{total} memories** from **{places} places**, stretching from **{first}** to **{last}**. Wander by place, by year or by what she loved. More arrive every day. |
| Explore hero p (390) | **{total} memories** from **{places} places**, {first} to {last}. More arrive every day. |
| Map hero (1280) | Jo's father was an Army chaplain, so she grew up on posts from Washington State to Texas. She spent the rest of her life within a short drive of Cockeysville, which is why the map is lopsided. **{total} memories** from **{places} places** so far. |
| Map hero (390) | Most Jo stories happened a short drive from Cockeysville, but the Army took her family all over when she was a girl. |
| Timeline intro (1280) | The thread runs from a girl folding paper crowns on an Army post to a grandmother with a drawer full of stickers. Dates are as people remembered them: "Summer 1985" counts. |
| Timeline intro (390) | Dates are as people remembered them. "Summer 1985" counts. |
| Tags intro | Every memory gets a few patches: what it's about, who's in it, what Jo was up to. The bigger the patch, the more stories. Tap one and the quilt shows you those. |
| Tags note | Patches come from the words people wrote, from what's in the photos and recordings, and from Jo's family. A memory can carry several. |
| Inset sub (Map 1280) | Maryland and the neighbors, up close |
| Inset caption (390, XL) | Maryland and the neighbors |

### 5.2 Eras

| Range / decade | Explore 1280 era line | XL era line | Timeline 1280 (`eras[decade]`) | Timeline 390 |
|---|---|---|---|---|
| 1949–66 | Growing up on Army posts | Army posts | – | – |
| 1967–71 | Towson, and a tall guy named Richard | Towson | – | – |
| 1971–2008 | The teaching years | teaching | – | – |
| 2009–17 | Quilts, bargains and Santa | quilts and Santa | – | – |
| 2018– | Grandma Jo | Grandma Jo | – | – |
| 1950s | | | Growing up on Army posts | Growing up on Army posts |
| 1960s | | | Last Army years, then Towson | Last Army years, then Towson |
| 1970s | | | A Christmas Eve wedding, and a classroom | A Christmas Eve wedding, and a classroom |
| 1980s | | | The teaching years | The teaching years |
| 1990s | | | The teaching years | The teaching years |
| 2000s | | | The teaching years, then retirement | **Teaching, then retirement** |
| 2010s | | | Quilts, bargains and Santa | Quilts, bargains and Santa |
| 2020s | | | Grandma Jo | Grandma Jo |

XL era line verbatim: "1949–66 Army posts · 1967–71 Towson · 1971–2008 teaching · 2009–17 quilts and Santa · 2018– Grandma Jo". Explore line ranges are `<strong class="text-jo-red-deep">`. Note the two systems disagree at the edges (e.g. Explore says teaching ran to 2008 and quilts from 2009; Timeline's 2000s says "then retirement").

### 5.3 Other UI strings (verbatim)

| Context | String |
|---|---|
| Section headings | Where the stories happened · Most of them close to home · When · What she loved · Every place, most stories first · Every place (390) · Close to this one · Kind (XL) |
| Links | Open the big map · Big map (XL) · Walk the whole timeline · Whole timeline (390) · Timeline (XL) · See every tag · All patches (390, XL) · All the memories · Mix this with a place or a year · See all {n} in Everything · See all {n} from {town} (390) |
| Buttons | Leave a memory of Jo · Leave a memory (phone header) · Start at the beginning · Show everything again · Show {k} more of {n} · This reminds me of a Jo story · Listen · {duration} · Close to home · Whole country |
| Labels | Look for a word, a name or a place (placeholder "quilt") · Kind: · Show: · All · Photos · Voices · Videos · Written · Often stitched next to: · Patches on this one · When · Where · as they remembered it · In their words (390) · Earlier on the thread · Later on the thread · Earlier / Later (390) |
| Helpers | Each heart is a place someone remembers with Jo; the bigger the heart, the more stories. Tap one to keep only those. · …Tap a heart to read what happened there. A memory's exact address is never shown, only the town. (Map) · Bigger heart, more stories. Tap one. (390) · Bigger heart, more stories. Tap one to keep only those. Towns only, never an address. (XL) · Tap a decade to keep only those years. · Showing the {decade}s. Tap it again for every year. · Tap a decade to open it. One at a time keeps the page short. · Same town, same stretch of years, or the same patches. · Nothing plays until you press it. |
| Empty / edge | Nothing here yet for that mix. Try one filter fewer, or <a>be the first to tell that Jo story</a>. · Nothing from these years yet. Were you there? <a>Tell that Jo story</a>. · The thread keeps going. <a>Add a stitch.</a> · none yet (decade bar) · nothing yet (timeline decade) · place not given (card meta) · Not given (Where tile) · See the map · This is the first one · This is the first (390) · Nothing later yet · Pick a place on the map · Pick a place (390) · Pick a patch |
| Memory page | A memory from · A voice memory from (390) · Something wrong here? Tell the family · Memory {i} of {N} on the thread |
| Share band | Did one of these remind you of your own? / Three sentences count. A photo from a shoebox counts. Spelling doesn't count. · (390) Did one remind you of your own? / Three sentences count. Spelling doesn't. |
| aria-labels | Site · View · Ways to look · Map of the memories · The tag quilt · Jump to a decade · The timeline · Where you are · Earlier and later · The other photos · Look for something (390) · Map (390) · How far out (390) · Share yours (390) · The recording (390) · Filters / Where (XL asides) · pins/patches/cards per §3 |
| Page titles (board `<title>`) | Memories of Jo — explore / — by place / — by year / — by what she loved / One memory of Jo (plan sets its own metadata titles) |

---

## 6. Interactions drawn or scripted

| Element | Board behaviour | States |
|---|---|---|
| Pins, top-place rows, "every place" rows | toggle place filter (Explore) / select place (Map) | sel: deeper heart (+6px), name pill; rows periwinkle-deep |
| Decade bars / chips | toggle decade (Explore); Timeline 1280 = `#d{decade}` anchors (smooth scroll) | sel bar periwinkle-deep + chip on |
| Tag chips, kind chips | toggle; facet counts recompute | chip on/off (§2.3) |
| Timeline "Show:" | sets kind, "All" clears; no toggle-off | one always on |
| Search | live filter on change; page size reset | – |
| Show everything again | clears all filters | visible only with filters |
| Load more | page size += page | hidden when all shown |
| Quilt patch | select tag; hover lifts 3px and straightens | sel periwinkle-deep fill |
| "Often stitched next to" chips | select that tag | no on state |
| Card | link; hover lift 3px + `shadow-card-hover` (reduced-motion: none) | – |
| Phone segmented control | swaps home / US map; default home | `aria-pressed` |
| Phone timeline accordion | header button toggles; jump bar opens that decade; one open at a time | `aria-expanded`, chevron rotate 180°, rail heart jo-red-deep, bar/chip periwinkle-deep |
| Memory thumbs | buttons (behaviour not scripted; plan: swap the big photo) | – |
| Listen button | drawn only (plan: Listen/Pause driving native audio) | first 9 bars darker as "played" look |

---

## 7. What changes between 390, 1280 and 2400

| Area | 390 | 1280 | 2400 (XL) |
|---|---|---|---|
| Header | logo + one CTA button, no nav | logo + 3 nav links | paper band with inline h1, stats, nav, CTA |
| Explore hero | h1 44px, one-line stats sentence, no tiles/buttons | h1 68px, full sentence, 2 buttons, 3 tilted tiles | collapsed into the header band |
| View nav | scrolling pill row, "What she loved" | wrapping pills (icons on Explore) | stacked: Everything + 3-up Place/Year/Patches |
| Map on Explore | absent | map + top 7 rows | right aside: map, 2:1 inset, top 8 in 2 cols |
| When | compact ’50 bars + hint | bars with chips and counts + era list | horizontal bar rows + abbreviated era line |
| Tags / kinds | scrolling rows, top 10, no "Kind:" | wrapping, top 12, "Kind:" row | all tags; kinds 2×2 |
| Results grid | single column, gap 20 | auto-fit min 300, gap 24 | auto-fill min 300, gap 20 |
| Page size (board) | 5 | 12 | 16 |
| Map page | segmented home/US, 3 compact cards, rows without years | big map + floating inset, 6 cards, rows with years | – |
| Timeline | accordion, rail with decade hearts, no kind chips, short title | all open, 220px label column, year hearts, kind chips | – |
| Memory | voice box, 36px h1, 2-col tiles without helpers, secondary CTA, solid Earlier/Later | photo figure + side column, dashed blockquote, tiles with helpers | – |

---

## 8. Design defects visible in the PNGs (do not copy)

1. Map 1280: the "Closer to home" inset (`top:50%`, `width:30%`, square inner box) overflows the map box downward, covers the caption and the top of the next band, and sits over the middle of the US map.
2. Map 1280, Phone Map, XL: home-inset labels collide (Cockeysville, Towson, Baltimore, Washington overlap); "Ocean City · 5" spills past the phone box edge; on the 1280 big map the selected "Cockeysville, MD" pill is hidden under neighbouring pins. Needs label placement / z-order (selected on top).
3. Phone Memory: the Earlier value overruns into the Later card ("DecemberFall of 2013") — the inner text column needs `min-w-0 overflow-hidden` for `truncate` to work.
4. Grammar: `"1 memory carry this patch"`; summary `"1 photos"` (kind noun never singular); `"0 more from {town}"` when the memory is the only one there.
5. Timeline 1280: a year with one photo card stretches the card to the full column (very large photo frame).
6. Phone Memory: `Listen · 4 min` beside a `3:53` clock (round vs exact) reads oddly.

---

## 9. Conflicts with the plan (plan wins; flagged only)

1. **Pin size**: plan `round(26 + √n·7) + 6sel` everywhere; Map board uses `26 + √n·8` (big) and `24 + √n·6` (inset); XL uses `24 + √n·7` and `24 + √n·5`.
2. **Home-inset projection** differs per board (unpadded on Map 1280; 8/84 · 14/80 on phone; 6/88 · 18/74 on XL); plan names one `homePoint`.
3. **Earlier/Later**: boards link to the Timeline page; plan D12 links to the adjacent memory page.
4. **"Something wrong here? Tell the family"**: board links to /share; plan uses `mailto:` the family address.
5. **Page sizes**: XL board 16 per page, phone 5; plan D10/D8 = 12 everywhere.
6. **Pins, rows, chips, decade bars are `<button aria-pressed>`** that filter in place; plan D5 uses `<Link>` with `aria-current` and URL query params (`?place=`, `?decade=`, …).
7. **Phone header** (logo + "Leave a memory" button, no nav; Phone Memory's button is dashed instead of red); plan keeps the shared `SiteHeader` with the "See memories" `NavLink`.
8. **Phone Explore has no map / top-places section and no place facet**; plan's Explore page is "the same page at 390px" with the map section — the plan does not say to hide it. Needs a call.
9. **Phone Timeline has no "Show:" kind chips**; plan's timeline takes `?kind=` at all sizes.
10. **Phone Memory CTA** "This reminds me of a Jo story" is a dashed secondary button and the "Something wrong here?" link is absent; plan names `PrimaryLink` and the link for the page.
11. **Era copy is inconsistent**: Explore era line (five ranges) vs Timeline per-decade eras, and Timeline 2000s differs between 1280 ("The teaching years, then retirement") and 390 ("Teaching, then retirement"); plan has a single `ERAS` (D14 verbatim). Needs one choice.
12. **Timeline title**: 390 board drops ", {first} to {last}"; plan specifies "N years of Jo stories, first to last".
13. **Summary heading on 390**: "Newest first" (no count) and "from the 1980s"; plan's model gives "57 memories, newest first" and "in the 1980s".
14. **Phone search haystack** omits tag names; plan searches tag names too.
15. **Tags note copy** ("Patches come from … what's in the photos and recordings …") implies automatic tagging; plan D3 says no AI tagging, tags are set through MCP and the admin form.
16. **Photo pill** shows the full place label ("Summer of 2009, Ocean City, MD"); plan says "when, town".
17. **Primary button size**: boards draw 20px text / 28px padding; `PrimaryLink` is 22px / 30px. Secondary "Start at the beginning" adds `bg-paper` that `SecondaryLink` lacks.
18. **Map/Tags with no selection** default to the top place / top tag; plan routes (`?place=`, `?tag=`) do not state a default.
19. **Phone timeline default open decade** is hard-coded 1980; plan: hash, else the decade with most memories (the seed data ties 1980s/1990s/2010s/2020s at 16; tie-break unspecified).
20. **Not drawn but in the plan**: "Not dated yet" group (D4), decades beyond 1950–2020, VIDEO player on the memory page, D16 "This recording will play once the family's copy is ready." line, the `OpeningSoon` dark-flag note, real images (boards show placeholders).
21. **Dropped by the plan but drawn**: people chips, the "Written out" transcript box, the design footer (D8).
