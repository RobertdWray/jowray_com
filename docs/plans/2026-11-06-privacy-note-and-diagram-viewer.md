<!-- Approved by Rob on 2026-11-06 in Claude Code plan mode; copied here unchanged except the C16 source link (private repo path removed). -->

# Footer Privacy note + fit-to-window diagrams with zoom, pan and full screen

## Context

Two small visitor-facing changes to jowray.com, requested by Rob on 2026-11-06. Base: `origin/main` at 982a141 (checked with `git ls-remote` this session; no open PRs).

**A. Privacy note.** The alpha records everything: Session Replay with text, inputs and media unmasked, plus 100% traces `[C1, C2]`. Today that is disclosed only deep inside `/how-it-was-built` `[C15]`. Rob wants a very small Privacy button at the bottom of every page that opens a little pop-up with his plain note and a link to `/how-it-was-built`.

**B. Diagrams overflow.** "The detailed version" on `/how-it-was-built` shows three generated SVGs, 2174, 2013 and 1804 px wide. Each sits at natural size in a sideways-scrolling card, under ruling R9 ("never scaled down") `[C24]`, so the right side is cut off at the card edge (Rob's screenshot). Rob wants them to fit the window, with zoom, pan and full-screen controls like the TrayVerify slide `[C16]`. That slide uses React Flow's `<Controls>`, which only work on a React Flow node graph. jowray's diagrams are static SVG images generated from README.md and kept in sync by a hash test, so this plan copies the controls onto a pan/zoom viewer and doesn't port React Flow. Rob's request supersedes R9.

### Rob's decisions (2026-11-06)
- **Placement:** the Privacy button goes in the footer link row, after "How this site was built". It does not float.
- **Copy:** lightly tidied and signed "— Rob":
  - Title: **Privacy, the short version**
  - "This website was vibe coded. We track everything to fix bugs. If you use the website, you accept that we record the screen, the logs and what you click and type, to make the site better."
  - "This is just for family and friends, so I'm not doing a big nutso legal disclaimer that you have to click OK on. — Rob"
  - "To see how this site works or read the source code, go to **How this site was built**."
  - Button: **Close**
- **Diagrams:** fit the window, with zoom, pan and full-screen buttons.

### My calls (say if any are wrong)
1. **One branch, one PR, two commits** (A, then B). Both commits add the same scroll-lock rule and edit the same "no modals" line, so two PRs would only create conflicts.
2. **New dependency: `react-zoom-pan-pinch@4.2.0`** (MIT, published 2026-09-03). It handles mouse, touchpad and touch gestures `[C17]`, and has button APIs (`zoomIn`, `zoomOut`, `resetTransform`, `panBy`) plus opt-in keyboard support `[C18]`. Hand-rolled pinch, wheel and drag would be the riskiest code in this change.
3. **"Full screen" opens a full-window `<dialog>`, not the Fullscreen API.** iPhone Safari supports that API only on iPad `[C22]`, and most visitors arrive on phones `[C14]`.
4. **The inline diagram doesn't hijack the page.** At fit size it behaves like a plain image. The wheel zooms only with Ctrl or ⌘ held, and drag-to-pan turns on only after zooming in `[C18, C20]`. Full screen turns on every gesture plus the keyboard.
5. **Controls sit in a toolbar above each diagram**, not on top of it. Each button has an icon and a visible label and is at least 56px tall `[C14]`.
6. **Dragging has a single-pointer alternative `[C21]`.** Full screen has ← ↑ ↓ → buttons (`panBy` `[C18]`), and the existing "Open … full size" link stays.

## Where the work happens
- `git fetch`, then `git worktree add /Users/rob/Documents/active_work/jowray_wt_privacy-diagrams -b feat/privacy-note-and-diagram-viewer origin/main`. The main checkout is stale (95f4df4), and its two untracked files belong to other work.
- `export PATH=/opt/homebrew/bin:$PATH` (Node 26), then `npm ci`. Re-read every file right before editing it.

## Commit A: Privacy note

**New `app/_components/privacy-note-client.tsx`** (`"use client"`, exports `PrivacyNote`) `[C3, C5]`
- **Trigger:**
  - `<button type="button" aria-haspopup="dialog">Privacy</button>` styled with `linkClass` plus `cursor-pointer` `[C10]`.
  - Also `inline-flex min-h-[44px] items-center`, for the touch-target minimum `[C14]`.
- **Open:** `if (!dialog.open) dialog.showModal()` `[C6]`, then focus the title.
  - The title is an `<h2 tabIndex={-1}>`. The note has several paragraphs, so the APG advises focusing a static element at the start and leaving out `aria-describedby` `[C7, C8]`.
  - The dialog gets `aria-labelledby` pointing at the title, with the id from `useId` `[C8]`.
- **Close:** Esc is native `[C7]`.
  - A visible `SecondaryButton` reads "Close" `[C8]`.
  - Backdrop clicks close it too: a click whose `target` is the `<dialog>` itself. That only works because the padding sits on an inner wrapper and the dialog is `p-0`.
  - Focus returns to the trigger `[C8]`. Verify this in the browser.
  - If jsx-a11y flags the handler on `<dialog>`, attach it in `useEffect`. **No `eslint-disable`.**
- **Styling:**
  - `m-auto`, because Preflight's `margin: 0` removes the dialog's centring `[C9]`.
  - Width `min(560px, 100% - 32px)` and a max height with `overflow-y-auto`.
  - Paper ground, dashed wood border, walnut text, and a walnut ~50% `backdrop:` `[C6]`.
- **Link:** `<Link href="/how-it-was-built" onClick={close}>` `[C11]`. The footer is in the root layout, which survives client-side navigation, so without `close` the note would stay open on the new page.
- **Header comment:** this copy describes the alpha telemetry `[C1]` and must change in the same commit as the "One honest note" bullet `[C15]`.

**`app/_components/site-footer.tsx`** `[C4, C5]`
- Append `<span aria-hidden="true"> · </span><PrivacyNote />` to the last `<p>`, after "How this site was built".
- The footer stays a Server Component. `app/global-error.tsx` needs no change.

**`app/globals.css`** `[C12]`
- Add `html:has(dialog:modal) { overflow: hidden; }` so the page can't scroll behind any open dialog. Commit B's full-screen view reuses this rule.

**`app/how-it-was-built/page.tsx`**, alpha-telemetry comment at line 242 `[C15]`
- Extend the comment so it also names `privacy-note-client.tsx`. Comment only.

**`design/DESIGN.md`** line 308 `[C13]` and **`README.md`** line 28 `[C13]`
- Change "no modals" to "no modals except the footer's Privacy note and the full-screen diagram view (Rob, 2026-11-06)".

## Commit B: Diagram viewer

**`package.json` / `package-lock.json`** `[C17]`
- `npm install --save-exact react-zoom-pan-pinch@4.2.0`.

**New `app/how-it-was-built/diagram-viewer-client.tsx`** (`"use client"`, exports `DiagramViewer`) `[C3, C19]`
- The library is imported only here. It ships without `"use client"`, so it must be wrapped in a Client Component `[C19]`.
- **Props:** `heading`, `src`, `width`, `height`, `alt`, `descriptionId`.
- **Inline view:**
  - `TransformWrapper` with `minScale={1}` (scale 1 means the image fits the card), `maxScale={8}` and `limitToBounds` `[C18]`.
  - `wheel={{ activationKeys: withCtrlOrCmd }}`, a function returning true when Control or Meta is held `[C18]`. (Implementation note: a plain `["Control", "Meta"]` list means both keys at once, because the library checks `keys.every`; the browser check caught it.)
  - `panning={{ disabled: scale <= 1 }}`, with `scale` tracked from `onTransform` `[C18]`.
  - `doubleClick` zooms in.
  - The image is `next/image` with `unoptimized` and the intrinsic `width`/`height`, so there's no layout shift `[C23]`. Classes `block w-full h-auto`, so it can't overflow.
- **Toolbar:** Zoom in / Zoom out / Fit / Full screen, using `zoomIn`, `zoomOut` and `resetTransform` from `useControls()` `[C17]`.
  - Small inline SVG icons with visible labels, `min-h-tap` (56px) `[C14]`, wrapping on phones.
  - Accessible names include the diagram, e.g. "Zoom in on Architecture".
- **Full-screen view:**
  - `<dialog>` with classes `m-0 p-0 w-screen h-dvh max-w-none max-h-none`, opened with `showModal()` `[C6, C9, C22]`.
  - The header holds the title (`tabIndex={-1}`, focused on open `[C8]`), the toolbar plus ← ↑ ↓ → `panBy` buttons `[C18, C21]`, and Close.
  - A second `TransformWrapper` fills the rest, with the image fitted by CSS (`max-w-full max-h-full`, centred with `centerOnInit`).
  - Wheel, pinch, drag and double-click all work, and the keyboard is on (`keyboard={{ disabled: false }}`, which is opt-in) `[C18]`.
  - Esc and Close shut it `[C7]`, and the commit A rule locks page scroll `[C12]`.
- **Touch check:** the 4.2.0 bundle sets no `touch-action` (grepped on unpkg). If the browser check shows a fitted inline diagram swallowing a one-finger page scroll, set `touch-action: pan-y pinch-zoom` on the wrapper while `scale <= 1` `[C20]`.

**`app/how-it-was-built/detailed-diagrams.tsx`** `[C4, C24]`
- It stays a Server Component.
- Replace the sideways-scrolling `role="region"` / `tabIndex` / `overflow-x-auto` card and the `max-w-none` image (lines 64–79) with `<DiagramViewer …/>`, keeping the same card classes.
- Keep the figcaption, `aria-describedby`, the "Open … full size" link `[C21]` and the README link.
- Rewrite the header comment (lines 6–13). The image fits the card; Zoom and Full screen reach the natural size, where the generator still guarantees 17px+ text. This supersedes R9 (Rob, 2026-11-06).

**`app/how-it-was-built/page.tsx`**, line 264 paragraph `[C25]`
- Replace "They are wide: swipe or scroll sideways inside each one, or open it full size." with copy saying they fit the screen and can be zoomed, dragged once zoomed in, or opened full screen.

## Verification
1. In the worktree, all three must pass with no `.env` and no `DATABASE_URL`: `npm run validate`, `npm run test:run` (the `readme-diagrams` hash test stays green) and `npm run build:offline`. There is no DOM test setup, and none is added for two presentational components.
2. Run `next dev`, then use the chrome-devtools MCP on `/how-it-was-built` and `/obituary` at 390px (touch emulated) and 1280px:
   - **Diagrams:**
     - `scrollWidth === clientWidth`, and every diagram is fully visible at fit size.
     - Zoom in, Zoom out and Fit work.
     - Drag pans only when zoomed in, and a plain wheel scrolls the page.
     - A one-finger swipe over a fitted diagram scrolls the page.
     - Full screen fills the window; pinch, wheel, drag, the arrow buttons and the arrow keys work; Esc and Close return focus; the page doesn't scroll behind it.
   - **Privacy note:**
     - It sits in the footer row, opens centred, and focus starts on the title.
     - Tab stays inside it.
     - Esc, a backdrop click and Close each shut it, with focus back on "Privacy".
     - The link navigates, and the note is closed on the new page.
   - No console errors.
   - Screenshots are saved in the worktree for the PR.
3. A fresh review subagent reads the diff against this plan: a11y, scroll-jacking, the Preflight dialog points, and no `eslint-disable`. Fix anything real.
4. Push, open a PR against `main` with the screenshots, wait for `ci`, and re-check the Vercel preview at phone width. Merge only when Rob says so.

## Citations

### [C1] — Alpha telemetry policy: everything is recorded
- **Relevant File(s):** `app/_components/privacy-note-client.tsx`
- **Change Summary:** The note's claim that the site records the screen, the logs and what people click and type.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/982a141/AGENTS.md#L60
- **Verbatim Quote:**
  > "Browser (`instrumentation-client.ts`): 100 % traces and Session Replay (text, inputs and media unmasked), replay network bodies for same-origin requests (scrubbed by `scrubRecordingEvent`)"
- **Justification:** The repo's own policy confirms Rob's copy is accurate: replay with unmasked text and inputs is screen recording plus "what you click and type", and traces/logs are the "log recording".

### [C2] — Sentry Session Replay masks by default; this site turns masking off
- **Relevant File(s):** `app/_components/privacy-note-client.tsx`
- **Change Summary:** Explains why the note has to disclose what is recorded.
- **Source URL:** https://docs.sentry.io/platforms/javascript/guides/nextjs/session-replay/privacy/#privacy-configuration
- **Verbatim Quote:**
  > "By default, the Session Replay SDK will mask all text content with * and block all media elements (img, svg, video, object, picture, embed, map, audio) on the client, before it is sent to the server. This can be disabled by setting maskAllText to false."
- **Justification:** jowray disables these defaults [C1], so replays contain readable text and media. That is the reason for a visible, plain-words notice.

### [C3] — "use client" marks the interactive component files
- **Relevant File(s):** `app/_components/privacy-note-client.tsx`, `app/how-it-was-built/diagram-viewer-client.tsx`
- **Change Summary:** Both new components use state, refs and event handlers, so they are Client Components.
- **Source URL:** https://nextjs.org/docs/app/getting-started/server-and-client-components#using-client-components
- **Verbatim Quote:**
  > "You can create a Client Component by adding the "use client" directive at the top of the file, above your imports."
- **Justification:** `showModal()`, `onClick` and the zoom state need the client, so each new file starts with `"use client"`. The same text appears in the installed Next 16.4.4 docs (`node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md:142`).

### [C4] — Keep the parents as Server Components
- **Relevant File(s):** `app/_components/site-footer.tsx`, `app/how-it-was-built/detailed-diagrams.tsx`
- **Change Summary:** Only the button+dialog and the viewer go to the client; the footer and the diagram list stay server-rendered.
- **Source URL:** https://nextjs.org/docs/app/getting-started/server-and-client-components#reducing-js-bundle-size
- **Verbatim Quote:**
  > "To reduce the size of your client JavaScript bundles, add 'use client' at the top of the files that define your interactive components instead of marking large parts of your UI as Client Components."
- **Justification:** The footer and `detailed-diagrams.tsx` import the small client pieces and keep their own static markup on the server, which is the pattern this passage describes.

### [C5] — Repo conventions for shared client UI
- **Relevant File(s):** `app/_components/privacy-note-client.tsx`, `app/_components/site-footer.tsx`
- **Change Summary:** The file name, location and import limits of the new shared component.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/982a141/AGENTS.md#L38-L40
- **Verbatim Quote:**
  > "`app/_components/` holds shared visitor-facing UI (header, footer, hearts, buttons, field classes). It is a Next.js private folder (not a route), imported only from `app/**` with relative paths, and it never imports `@/server`, `@/integrations` or `server-only` because Client Components use it"
- **Justification:** The privacy note is shared visitor UI rendered by the footer, so it lives in `app/_components/`. It takes the `*-client.tsx` suffix from the same section's naming convention, uses relative imports, and imports nothing server-side.

### [C6] — `showModal()` gives top layer, backdrop and an inert page
- **Relevant File(s):** `app/_components/privacy-note-client.tsx`, `app/how-it-was-built/diagram-viewer-client.tsx`
- **Change Summary:** Both pop-ups use the native modal dialog rather than a custom overlay.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal#description
- **Verbatim Quote:**
  > "A modal dialog displays in the top layer, along with a ::backdrop pseudo-element. Elements inside the same document as the dialog, except the dialog and its descendants, become inert (as if the inert attribute is specified)."
- **Justification:** The top layer and the inert page give focus containment with no library. `::backdrop` is what the `backdrop:` Tailwind classes style.

### [C7] — Esc closes; first focusable element gets focus
- **Relevant File(s):** `app/_components/privacy-note-client.tsx`, `app/how-it-was-built/diagram-viewer-client.tsx`
- **Change Summary:** No custom Esc handler; the focus target is set on purpose.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog#accessibility
- **Verbatim Quote:**
  > "By default, a dialog invoked by the showModal() method can be dismissed by pressing the Esc key. Keyboard users expect the Esc key to close modal dialogs; ensure that this behavior is implemented and maintained."
  > "When using HTMLDialogElement.showModal() to open a <dialog>, focus is set on the first nested focusable element."
- **Justification:** We rely on the native Esc. Because the browser picks the first focusable element, the `tabIndex={-1}` title [C8] goes first in the markup and is also focused explicitly after `showModal()`.

### [C8] — APG modal dialog: initial focus, labelling, return focus, visible close
- **Relevant File(s):** `app/_components/privacy-note-client.tsx`, `app/how-it-was-built/diagram-viewer-client.tsx`
- **Change Summary:** Focus the title (`tabIndex={-1}`), use `aria-labelledby` without `aria-describedby`, return focus to the trigger, and show a Close button.
- **Source URL:** https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/#keyboardinteraction
- **Verbatim Quote:**
  > "If the dialog content includes semantic structures, such as lists, tables, or multiple paragraphs, that need to be perceived in order to easily understand the content, i.e., if the content would be difficult to understand when announced as a single unbroken string, then it is advisable to add tabindex="-1" to a static element at the start of the content and initially focus that element. This makes it easier for assistive technology users to read the content by navigating the semantic structures. Additionally, it is advisable to omit applying aria-describedby to the dialog container in this scenario."
  > "When a dialog closes, focus returns to the element that invoked the dialog unless either:"
  > "It is strongly recommended that the tab sequence of all dialogs include a visible element with role button that closes the dialog, such as a close icon or cancel button."
- **Justification:** The note is three paragraphs, which is exactly the first case, so focus goes to the title and `aria-describedby` is left out. Each dialog has a visible Close button, and verification checks that focus returns to the trigger.

### [C9] — Preflight zeroes margins, so the dialog needs `m-auto`
- **Relevant File(s):** `app/_components/privacy-note-client.tsx`, `app/how-it-was-built/diagram-viewer-client.tsx`
- **Change Summary:** `m-auto` centres the note; the full-screen dialog uses `m-0` with full-viewport size.
- **Source URL:** https://tailwindcss.com/docs/preflight#margins-are-removed
- **Verbatim Quote:**
  > "Preflight removes all of the default margins from all elements including headings, blockquotes, paragraphs, etc:"
  > "*,::after,::before,::backdrop,::file-selector-button {  margin: 0;  padding: 0;}"
- **Justification:** The browser centres a modal dialog with `margin: auto`, and Preflight's `margin: 0` removes that, so `m-auto` restores it. The reset also covers `::backdrop`.

### [C10] — Tailwind v4 buttons use the default cursor
- **Relevant File(s):** `app/_components/privacy-note-client.tsx`
- **Change Summary:** Add `cursor-pointer` to the link-styled Privacy button.
- **Source URL:** https://tailwindcss.com/docs/upgrade-guide#buttons-use-the-default-cursor
- **Verbatim Quote:**
  > "Buttons now use cursor: default instead of cursor: pointer to match the default browser behavior."
- **Justification:** The Privacy trigger is a `<button>` styled like its neighbouring links. Without `cursor-pointer` it would show an arrow where the links show a hand.

### [C11] — Link `onClick` runs on every click
- **Relevant File(s):** `app/_components/privacy-note-client.tsx`
- **Change Summary:** `onClick={close}` on the "How this site was built" link.
- **Source URL:** https://nextjs.org/docs/app/api-reference/components/link#onnavigate
- **Verbatim Quote:**
  > "While onClick and onNavigate may seem similar, they serve different purposes. onClick executes for all click events, while onNavigate only runs during client-side navigation."
- **Justification:** We want the note closed on every click, including a Ctrl/⌘-click that opens a new tab, so `onClick` is the right hook rather than `onNavigate`.

### [C12] — `:modal` matches a dialog opened with `showModal()`
- **Relevant File(s):** `app/globals.css`
- **Change Summary:** `html:has(dialog:modal) { overflow: hidden; }` locks page scroll while either dialog is open.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:modal
- **Verbatim Quote:**
  > "The :modal CSS pseudo-class matches an element that is in a state in which it excludes all interaction with elements outside it until the interaction has been dismissed."
  > "The dialog element opened with the showModal() API."
- **Justification:** `:modal` is true exactly while our dialogs are open, so one rule covers both. It never matches a dialog opened with `show()`.

### [C13] — The "no modals" rule this change makes an exception to
- **Relevant File(s):** `design/DESIGN.md`, `README.md`
- **Change Summary:** Record the two modal exceptions Rob asked for.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/982a141/design/DESIGN.md#L308 and https://github.com/RobertdWray/jowray_com/blob/982a141/README.md#L28
- **Verbatim Quote:**
  > "- No sticky header, no modals, no autoplay audio, no hover-only interactions."
  > "there are no modals and nothing hides behind hover."
- **Justification:** Both docs would be wrong once this ships, so each line gets the exception with Rob's date, keeping the docs true after the audit pass in #52.

### [C14] — Touch targets and the 390px phone baseline
- **Relevant File(s):** `app/_components/privacy-note-client.tsx`, `app/how-it-was-built/diagram-viewer-client.tsx`
- **Change Summary:** The Privacy trigger is ≥44px; toolbar buttons are `min-h-tap` (56px); everything is checked at 390px.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/982a141/design/DESIGN.md#L307
- **Verbatim Quote:**
  > "- Touch targets ≥44px, inputs and buttons 56–64px."
  > "- The page must look finished at 390px wide — most visitors arrive from a text-message link."
- **Justification:** These are the sizes the controls must meet. Phone-first visitors are also why full screen uses a dialog [C22].

### [C15] — The existing alpha-telemetry sync note
- **Relevant File(s):** `app/how-it-was-built/page.tsx` (comment at line 242)
- **Change Summary:** Extend the comment so the Privacy note copy is updated together with this bullet.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/982a141/app/how-it-was-built/page.tsx#L242
- **Verbatim Quote:**
  > "Alpha telemetry (AGENTS.md § Sentry). When the alpha settings end, UPDATE this line in the same"
- **Justification:** The page already asks for its telemetry line to change with the alpha settings. Naming the new component in the same comment keeps the two disclosures in step.

### [C16] — The reference UX: TrayVerify's diagram controls
- **Relevant File(s):** `app/how-it-was-built/diagram-viewer-client.tsx`
- **Change Summary:** The control set to copy: zoom in, zoom out, fit view.
- **Source URL:** https://investors.tray-verify.com/slides/advanced-system-architecture (source: `src/slides/advanced-system-architecture.tsx` lines 149–161 in the private TrayVerify investors repo)
- **Verbatim Quote:**
  > "fitView
  >         fitViewOptions={{ padding: 0.15 }}
  >         proOptions={{ hideAttribution: true }}
  >         minZoom={0.1}
  >         maxZoom={2}
  >       >
  >         <Controls"
- **Justification:** Rob named this slide as the model. React Flow's `<Controls>` only works on a React Flow node graph (`diagram-modal.md`), so the viewer copies its buttons (zoom in, zoom out, fit) and adds Full screen.

### [C17] — react-zoom-pan-pinch: what it does and its button API
- **Relevant File(s):** `package.json`, `package-lock.json`, `app/how-it-was-built/diagram-viewer-client.tsx`
- **Change Summary:** Add the dependency; drive the toolbar with `useControls()`.
- **Source URL:** https://github.com/BetterTyped/react-zoom-pan-pinch#readme
- **Verbatim Quote:**
  > "Super fast and light react npm package for zooming, panning and pinching html elements in easy way"
  > "Mobile gestures, touchpad gestures and desktop mouse events support"
  > "const { zoomIn, zoomOut, resetTransform } = useControls();"
- **Justification:** It covers mouse, touchpad and touch on an `<img>`, which is the job. `useControls()` supplies the Zoom in, Zoom out and Fit (`resetTransform`) handlers for the toolbar.

### [C18] — react-zoom-pan-pinch 4.2.0 options used
- **Relevant File(s):** `app/how-it-was-built/diagram-viewer-client.tsx`
- **Change Summary:** Ctrl/⌘-only wheel inline, pan only when zoomed, opt-in keyboard and `panBy` arrow buttons in full screen.
- **Source URL:** https://unpkg.com/react-zoom-pan-pinch@4.2.0/dist/index.d.ts (the `ReactZoomPanPinchProps` type and the `panBy` doc comment)
- **Verbatim Quote:**
  > "activationKeys?: string[] | ((keys: string[]) => boolean);"
  > "keyboard?: {
  >         /** Keyboard navigation is opt-in. */"
  > "Pans by a pixel delta (positive x moves the content right), limited to the bounds when `limitToBounds` is on. Backs the keyboard arrows and is handy for directional buttons (#254, #527)."
- **Justification:** These are the exact 4.2.0 types. `wheel.activationKeys` keeps a plain scroll for the page, `panning.disabled` and `limitToBounds` exist as used, keyboard support has to be switched on, and `panBy` powers the arrow buttons [C21].

### [C19] — A third-party component without "use client" works inside a Client Component
- **Relevant File(s):** `app/how-it-was-built/diagram-viewer-client.tsx`
- **Change Summary:** Import `react-zoom-pan-pinch` only inside the `"use client"` viewer file.
- **Source URL:** https://nextjs.org/docs/app/getting-started/server-and-client-components#third-party-components
- **Verbatim Quote:**
  > "When using a third-party component that relies on client-only features, you can wrap it in a Client Component to ensure it works as expected."
- **Justification:** The 4.2.0 bundle has no `"use client"` directive (checked on unpkg), so wrapping it in our Client Component is the documented way to use it.

### [C20] — `touch-action` controls which gestures the browser keeps
- **Relevant File(s):** `app/how-it-was-built/diagram-viewer-client.tsx`
- **Change Summary:** Fallback if a fitted inline diagram blocks page scrolling: `touch-action: pan-y pinch-zoom` while the scale is ≤ 1.
- **Source URL:** https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action#values
- **Verbatim Quote:**
  > "pan-y — Enable single-finger vertical panning gestures."
  > "pinch-zoom — Enable multi-finger panning and zooming of the page."
- **Justification:** If testing shows the library swallowing a one-finger swipe at fit size, these two values hand vertical scrolling and page pinch-zoom back to the browser. That fixes the cause without `!important`.

### [C21] — WCAG 2.5.7 Dragging Movements
- **Relevant File(s):** `app/how-it-was-built/diagram-viewer-client.tsx`, `app/how-it-was-built/detailed-diagrams.tsx`
- **Change Summary:** Arrow `panBy` buttons in full screen, and keep the "Open … full size" link.
- **Source URL:** https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html
- **Verbatim Quote:**
  > "All functionality that uses a dragging movement for operation can be achieved by a single pointer without dragging, unless dragging is essential or the functionality is determined by the user agent and not modified by the author."
  > "A map allows users to drag the view of the map around, and the map has up/down/left/right buttons to move the view as well."
- **Justification:** Drag-to-pan is new functionality. The arrow buttons follow the map example, and the full-size link gives native scrolling, so panning never requires a drag.

### [C22] — No element Fullscreen API on iPhone
- **Relevant File(s):** `app/how-it-was-built/diagram-viewer-client.tsx`
- **Change Summary:** "Full screen" is a full-window `<dialog>`, not `requestFullscreen()`.
- **Source URL:** https://caniuse.com/fullscreen
- **Verbatim Quote:**
  > "12 - 26.6 : Partial support"
  > "Partial support refers to supporting only iPad, not iPhone."
- **Justification:** Most visitors use phones [C14], and the Fullscreen API would do nothing on an iPhone. A full-viewport modal dialog [C6] behaves the same everywhere.

### [C23] — `next/image` with intrinsic size and `unoptimized` for SVG
- **Relevant File(s):** `app/how-it-was-built/diagram-viewer-client.tsx`
- **Change Summary:** Keep `next/image` with `width`, `height` and `unoptimized`, styled `w-full h-auto` to fit.
- **Source URL:** https://nextjs.org/docs/app/api-reference/components/image#unoptimized
- **Verbatim Quote:**
  > "We recommend using the unoptimized prop when the src prop is known to be SVG."
  > "The width and height attributes are used to infer the correct aspect ratio of image and avoid layout shift from the image loading in. The width and height do not determine the rendered size of the image file."
- **Justification:** The diagrams are SVGs, so they stay `unoptimized`. The intrinsic `width`/`height` reserve the right aspect ratio while CSS scales the image down to the card.

### [C24] — Ruling R9, which Rob's request supersedes
- **Relevant File(s):** `app/how-it-was-built/detailed-diagrams.tsx` (comment lines 6–13; card lines 64–79)
- **Change Summary:** Replace the never-scale-down scroller with the fit-to-width viewer and rewrite the comment.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/982a141/app/how-it-was-built/detailed-diagrams.tsx#L11-L13
- **Verbatim Quote:**
  > "Text is 17px or more at natural size (the script refuses to write anything smaller), so the images are never scaled down: each sits in a keyboard-focusable region that scrolls sideways (WCAG 1.4.10 allows two-dimensional content to scroll) and the page itself never does."
- **Justification:** This is the comment and the behaviour Rob's screenshot shows as overflow. The new comment records that the fitted view scales down and that Zoom and Full screen reach the 17px natural size, which the generator still enforces.

### [C25] — The page copy that describes sideways scrolling
- **Relevant File(s):** `app/how-it-was-built/page.tsx` (paragraph at line 264)
- **Change Summary:** Rewrite the instruction to match the new viewer.
- **Source URL:** https://github.com/RobertdWray/jowray_com/blob/982a141/app/how-it-was-built/page.tsx#L264
- **Verbatim Quote:**
  > "They are wide: swipe or scroll sideways inside each one, or open it full"
- **Justification:** After commit B the diagrams no longer scroll sideways, so this sentence would be wrong. It is replaced with zoom, drag-when-zoomed and full-screen wording.
