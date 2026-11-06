// Browser checks for the footer Privacy note and the /how-it-was-built diagram viewer (plan
// docs/plans/2026-11-06-privacy-note-and-diagram-viewer.md, verification step 2). Drives the installed Google Chrome
// headless through playwright-core against a running `next dev`, at 1280×900 and at 390×844 with touch, and writes
// screenshots to <evidenceDir>. Exits 1 if any check fails.
// Usage: node scripts/privacy-diagrams-smoke.mjs <repoDir> <baseUrl> <evidenceDir>
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const [worktree, base, evidence] = process.argv.slice(2);
const require = createRequire(join(worktree, "package.json"));
const { chromium } = require("playwright-core");
mkdirSync(evidence, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});

function collectErrors(page) {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") {
      errors.push(m.text());
    }
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

// Reads the scale and translate of the nth diagram's transformed content.
const transformOf = (page, index = 0, scope = "main") =>
  page.evaluate(
    ([i, s]) => {
      const root = s === "dialog" ? document.querySelector("dialog[open]") : document.querySelector("main");
      const el = root.querySelectorAll(".react-transform-component")[i];
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return { scale: m.a, x: m.e, y: m.f };
    },
    [index, scope],
  );

const settle = (page, ms = 450) => page.waitForTimeout(ms);

// ---------------------------------------------------------------- Desktop 1280
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/how-it-was-built`, { waitUntil: "networkidle" });

  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  check("desktop: no horizontal page overflow", overflow.scroll <= overflow.client, JSON.stringify(overflow));

  const fits = await page.evaluate(() =>
    [...document.querySelectorAll("main figure")].filter((f) => f.querySelector(".react-transform-component")).map((f) => {
      const img = f.querySelector(".react-transform-component img");
      const card = img.closest(".rounded-card");
      const r = img.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      return { w: Math.round(r.width), card: Math.round(c.width), ok: r.width <= c.width + 0.5 && c.right <= innerWidth };
    }),
  );
  check("desktop: all three diagrams fit their cards", fits.length === 3 && fits.every((f) => f.ok), JSON.stringify(fits));

  const arch = page.getByRole("figure", { name: "Architecture" });
  await arch.scrollIntoViewIfNeeded();
  await settle(page);
  await arch.screenshot({ path: join(evidence, "01-desktop-architecture-fitted.jpg"), quality: 80, type: "jpeg" });

  // Zoom in / Zoom out / Fit buttons (Architecture is the second figure).
  const zoomOutBtn = page.getByRole("button", { name: "Zoom out of Architecture" });
  check("desktop: Zoom out starts aria-disabled at fit size", (await zoomOutBtn.getAttribute("aria-disabled")) === "true");
  await page.getByRole("button", { name: "Zoom in on Architecture" }).click();
  await settle(page);
  const zoomedIn = await transformOf(page, 1);
  check("desktop: Zoom in scales the diagram up", zoomedIn.scale > 1.05, JSON.stringify(zoomedIn));
  check("desktop: Zoom out enabled once zoomed in", (await zoomOutBtn.getAttribute("aria-disabled")) === "false");
  await arch.screenshot({ path: join(evidence, "02-desktop-architecture-zoomed.jpg"), quality: 80, type: "jpeg" });

  // Drag pans when zoomed in.
  const box = await arch.locator(".react-transform-wrapper").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 150, cy - 40, { steps: 8 });
  await page.mouse.up();
  await settle(page, 900);
  const afterDrag = await transformOf(page, 1);
  check("desktop: drag pans once zoomed in", Math.abs(afterDrag.x - zoomedIn.x) > 20, `${zoomedIn.x} → ${afterDrag.x}`);

  await page.getByRole("button", { name: "Fit Architecture to the screen" }).click();
  await settle(page);
  const fitted = await transformOf(page, 1);
  check("desktop: Fit returns to scale 1", Math.abs(fitted.scale - 1) < 0.001 && Math.abs(fitted.x) < 1, JSON.stringify(fitted));

  // Drag does nothing at fit size.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 150, cy, { steps: 8 });
  await page.mouse.up();
  await settle(page);
  const fitDrag = await transformOf(page, 1);
  check("desktop: drag does nothing at fit size", Math.abs(fitDrag.x) < 1 && Math.abs(fitDrag.scale - 1) < 0.001, JSON.stringify(fitDrag));

  // A plain wheel scrolls the page; Ctrl+wheel zooms.
  const before = await page.evaluate(() => scrollY);
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, 300);
  await settle(page);
  const after = await page.evaluate(() => scrollY);
  const wheelT = await transformOf(page, 1);
  check("desktop: plain wheel scrolls the page, diagram stays fitted", after > before && Math.abs(wheelT.scale - 1) < 0.001, `scrollY ${before} → ${after}, scale ${wheelT.scale}`);

  const box2 = await arch.locator(".react-transform-wrapper").boundingBox();
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -400);
  await page.keyboard.up("Control");
  await settle(page);
  const ctrlT = await transformOf(page, 1);
  check("desktop: Ctrl+wheel zooms the diagram", ctrlT.scale > 1.05, JSON.stringify(ctrlT));
  await page.getByRole("button", { name: "Fit Architecture to the screen" }).click();
  await settle(page);

  // Full screen.
  const fullBtn = page.getByRole("button", { name: "Full screen: Architecture" });
  await fullBtn.click();
  await settle(page, 600);
  const fs = await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    const r = d.getBoundingClientRect();
    return {
      open: Boolean(d),
      modal: d.matches(":modal"),
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      vw: innerWidth,
      vh: innerHeight,
      focus: document.activeElement?.tagName + ":" + document.activeElement?.textContent,
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
    };
  });
  check("desktop: Full screen opens a modal dialog that fills the window", fs.modal && fs.rect[0] === 0 && fs.rect[1] === 0 && fs.rect[2] === fs.vw && fs.rect[3] === fs.vh, JSON.stringify(fs));
  check("desktop: focus starts on the full-screen title", fs.focus === "H2:Architecture", fs.focus);
  check("desktop: page scroll is locked behind the dialog", fs.htmlOverflow === "hidden", fs.htmlOverflow);
  await page.screenshot({ path: join(evidence, "03-desktop-fullscreen.jpg"), quality: 80, type: "jpeg" });

  const dlg = page.locator("dialog[open]");
  await dlg.getByRole("button", { name: "Zoom in on Architecture" }).click();
  await settle(page);
  const fsZoom = await transformOf(page, 0, "dialog");
  await dlg.getByRole("button", { name: "Move the view right" }).click();
  await settle(page);
  const fsRight = await transformOf(page, 0, "dialog");
  check("desktop: full-screen arrow button pans", fsRight.x < fsZoom.x - 20, `${fsZoom.x} → ${fsRight.x}`);

  await dlg.getByRole("group", { name: "Architecture diagram", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await settle(page);
  const fsKey = await transformOf(page, 0, "dialog");
  check("desktop: arrow keys pan in full screen", fsKey.x > fsRight.x + 10, `${fsRight.x} → ${fsKey.x}`);

  await page.keyboard.press("Escape");
  await settle(page);
  const afterEsc = await page.evaluate(() => ({
    open: Boolean(document.querySelector("dialog[open]")),
    focus: document.activeElement?.getAttribute("aria-label"),
    htmlOverflow: getComputedStyle(document.documentElement).overflow,
  }));
  check("desktop: Esc closes full screen and returns focus", !afterEsc.open && afterEsc.focus === "Full screen: Architecture" && afterEsc.htmlOverflow !== "hidden", JSON.stringify(afterEsc));

  await fullBtn.click();
  await settle(page, 600);
  await page.locator("dialog[open]").getByRole("button", { name: "Close" }).click();
  await settle(page);
  const afterClose = await page.evaluate(() => ({
    open: Boolean(document.querySelector("dialog[open]")),
    focus: document.activeElement?.getAttribute("aria-label"),
  }));
  check("desktop: Close shuts full screen and returns focus", !afterClose.open && afterClose.focus === "Full screen: Architecture", JSON.stringify(afterClose));

  // Privacy note on /obituary.
  await page.goto(`${base}/obituary`, { waitUntil: "networkidle" });
  const privacy = page.getByRole("button", { name: "Privacy" });
  await privacy.scrollIntoViewIfNeeded();
  const pb = await privacy.boundingBox();
  check("desktop: Privacy button is in the footer and ≥44px tall", pb && pb.height >= 44, JSON.stringify(pb));
  await page.locator("footer").screenshot({ path: join(evidence, "04-desktop-footer.jpg"), quality: 80, type: "jpeg" });

  await privacy.click();
  await settle(page);
  const pn = await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    const r = d.getBoundingClientRect();
    return {
      modal: d.matches(":modal"),
      centreDx: Math.round(r.left + r.width / 2 - innerWidth / 2),
      centreDy: Math.round(r.top + r.height / 2 - innerHeight / 2),
      width: Math.round(r.width),
      focus: document.activeElement?.tagName + ":" + document.activeElement?.textContent,
      label: document.getElementById(d.getAttribute("aria-labelledby"))?.textContent,
      describedby: d.getAttribute("aria-describedby"),
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
    };
  });
  check("desktop: Privacy note opens centred as a modal", pn.modal && Math.abs(pn.centreDx) <= 1 && Math.abs(pn.centreDy) <= 1 && pn.width <= 560, JSON.stringify(pn));
  check("desktop: focus starts on the note title; no aria-describedby", pn.focus === "H2:Privacy, the short version" && pn.label === "Privacy, the short version" && pn.describedby === null, pn.focus);
  check("desktop: page scroll locked while the note is open", pn.htmlOverflow === "hidden");
  await page.screenshot({ path: join(evidence, "05-desktop-privacy-note.jpg"), quality: 80, type: "jpeg" });

  // Tab stays inside the note.
  const tabbed = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    tabbed.push(await page.evaluate(() => ({
      inside: Boolean(document.activeElement?.closest("dialog[open]")),
      // Leaving the last control, Chrome moves focus to its own UI and document.activeElement becomes <body>;
      // the inert page itself must never take focus.
      onPage: document.activeElement !== document.body && !document.activeElement?.closest("dialog[open]"),
      tag: document.activeElement?.tagName,
      text: document.activeElement?.textContent?.trim().slice(0, 30),
    })));
  }
  check("desktop: Tab never reaches the inert page behind the note", tabbed.every((t) => !t.onPage) && tabbed.some((t) => t.inside), JSON.stringify(tabbed.map(({ tag, inside }) => `${tag}:${inside}`)));

  await page.keyboard.press("Escape");
  await settle(page);
  const pEsc = await page.evaluate(() => ({ open: Boolean(document.querySelector("dialog[open]")), focus: document.activeElement?.textContent }));
  check("desktop: Esc closes the note and focus returns to Privacy", !pEsc.open && pEsc.focus === "Privacy", JSON.stringify(pEsc));

  await privacy.click();
  await settle(page);
  await page.mouse.click(8, 8);
  await settle(page);
  check("desktop: a backdrop click closes the note", !(await page.evaluate(() => Boolean(document.querySelector("dialog[open]")))));

  await privacy.click();
  await settle(page);
  await page.locator("dialog[open]").getByRole("heading").click();
  await settle(page);
  check("desktop: a click inside the note does not close it", await page.evaluate(() => Boolean(document.querySelector("dialog[open]"))));
  await page.locator("dialog[open]").getByRole("button", { name: "Close" }).click();
  await settle(page);
  check("desktop: Close shuts the note", !(await page.evaluate(() => Boolean(document.querySelector("dialog[open]")))));

  await privacy.click();
  await settle(page);
  await page.locator("dialog[open]").getByRole("link", { name: "How this site was built" }).click();
  await page.waitForURL("**/how-it-was-built");
  await settle(page, 800);
  const nav = await page.evaluate(() => ({ path: location.pathname, open: Boolean(document.querySelector("dialog[open]")), htmlOverflow: getComputedStyle(document.documentElement).overflow }));
  check("desktop: the note's link navigates and the note is closed", nav.path === "/how-it-was-built" && !nav.open && nav.htmlOverflow !== "hidden", JSON.stringify(nav));

  check("desktop: no console errors", errors.length === 0, errors.join(" | ").slice(0, 600));
  await ctx.close();
}

// ---------------------------------------------------------------- Phone 390 (touch)
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/how-it-was-built`, { waitUntil: "networkidle" });

  const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  check("phone: no horizontal page overflow", overflow.scroll <= overflow.client, JSON.stringify(overflow));

  const arch = page.getByRole("figure", { name: "Architecture" });
  await arch.scrollIntoViewIfNeeded();
  await settle(page);
  await arch.screenshot({ path: join(evidence, "06-phone-architecture-fitted.jpg"), quality: 80, type: "jpeg" });

  // A one-finger swipe over the fitted diagram scrolls the page.
  const box = await arch.locator(".react-transform-wrapper").boundingBox();
  const cdp = await ctx.newCDPSession(page);
  const before = await page.evaluate(() => scrollY);
  await cdp.send("Input.synthesizeScrollGesture", {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
    yDistance: -200,
    gestureSourceType: "touch",
    speed: 800,
  });
  await settle(page);
  const after = await page.evaluate(() => scrollY);
  const t = await transformOf(page, 1);
  check("phone: one-finger swipe over a fitted diagram scrolls the page", after > before + 50 && Math.abs(t.scale - 1) < 0.001, `scrollY ${before} → ${after}, scale ${t.scale}`);

  await page.getByRole("button", { name: "Full screen: Architecture" }).click();
  await settle(page, 600);
  await page.screenshot({ path: join(evidence, "07-phone-fullscreen.jpg"), quality: 80, type: "jpeg" });
  const fsRect = await page.evaluate(() => {
    const r = document.querySelector("dialog[open]").getBoundingClientRect();
    const img = document.querySelector("dialog[open] img").getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight, imgW: Math.round(img.width) };
  });
  check("phone: full screen fills the window and the diagram fits", fsRect.w === fsRect.vw && fsRect.h === fsRect.vh && fsRect.imgW <= fsRect.vw, JSON.stringify(fsRect));
  await page.locator("dialog[open]").getByRole("button", { name: "Close" }).click();
  await settle(page);

  await page.goto(`${base}/obituary`, { waitUntil: "networkidle" });
  const privacy = page.getByRole("button", { name: "Privacy" });
  await privacy.scrollIntoViewIfNeeded();
  await page.locator("footer").screenshot({ path: join(evidence, "08-phone-footer.jpg"), quality: 80, type: "jpeg" });
  await privacy.tap();
  await settle(page);
  const pn = await page.evaluate(() => {
    const r = document.querySelector("dialog[open]").getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth };
  });
  check("phone: Privacy note fits with 16px gutters", pn.left >= 16 && pn.vw - pn.right >= 16, JSON.stringify(pn));
  await page.screenshot({ path: join(evidence, "09-phone-privacy-note.jpg"), quality: 80, type: "jpeg" });

  check("phone: no console errors", errors.length === 0, errors.join(" | ").slice(0, 600));
  await ctx.close();
}


// ---------------------------------------------------------------- Review round 1 regressions
{
  // Footer: at any width, no line ends with a dot and every dot sits on the line of the link after it.
  for (const width of [320, 412, 640, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/obituary`, { waitUntil: "networkidle" });
    const rows = await page.evaluate(() => {
      const row = document.querySelector("footer > div");
      const items = [...row.children].map((el) => {
        const r = el.getBoundingClientRect();
        // The Privacy item also holds the closed dialog's text; its first few characters are the visible part.
        const text = el.textContent.trim().slice(0, el.textContent.trim().startsWith("·Privacy") ? 8 : 40);
        return { text, top: Math.round(r.top + r.height / 2), dot: text.startsWith("·") };
      });
      return items;
    });
    const linksWithDot = rows.slice(1).every((r) => r.dot);
    const lines = new Map();
    for (const r of rows) {
      lines.set(r.top, [...(lines.get(r.top) ?? []), r.text]);
    }
    const dangling = [...lines.values()].some((texts) => texts[texts.length - 1].endsWith("·"));
    check(`footer ${width}px: every later link carries its own dot, none dangles`, linksWithDot && !dangling, JSON.stringify([...lines.values()]));
    await ctx.close();
  }

  // Zoom out keeps keyboard focus when it reaches fit size.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/how-it-was-built`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Zoom in on Architecture" }).click();
    await settle(page);
    const zoomOut = page.getByRole("button", { name: "Zoom out of Architecture" });
    await zoomOut.focus();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Enter");
      await settle(page, 300);
    }
    const state = await page.evaluate(() => ({
      focus: document.activeElement?.getAttribute("aria-label"),
      disabled: document.activeElement?.getAttribute("aria-disabled"),
    }));
    const t = await transformOf(page, 1);
    check("Zoom out keeps focus when it reaches fit size", state.focus === "Zoom out of Architecture" && state.disabled === "true" && Math.abs(t.scale - 1) < 0.001, JSON.stringify({ ...state, scale: t.scale }));
    await ctx.close();
  }

  // Landscape phone: the full-screen canvas keeps most of the height, and natural size is reachable.
  {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(`${base}/how-it-was-built`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Full screen: Data model" }).click();
    await settle(page, 700);
    const dlg = page.locator("dialog[open]");
    const canvas = await page.evaluate(() => {
      const g = document.querySelector("dialog[open] [role=group][aria-describedby]");
      return Math.round(g.getBoundingClientRect().height);
    });
    check("landscape phone: full-screen canvas is at least 280px tall", canvas >= 280, `${canvas}px of 390`);
    await page.screenshot({ path: join(evidence, "10-landscape-fullscreen.jpg"), quality: 80, type: "jpeg" });
    // Click at a human pace: a click during the 200ms zoom animation restarts from the mid-animation scale.
    let last = 0;
    let scale = 1;
    for (let i = 0; i < 30 && scale > last; i++) {
      last = scale;
      await dlg.getByRole("button", { name: "Zoom in on Data model" }).click();
      await settle(page, 320);
      scale = (await transformOf(page, 0, "dialog")).scale;
    }
    const shown = await page.evaluate(() => Math.round(document.querySelector("dialog[open] img").getBoundingClientRect().width));
    check("landscape phone: Zoom in reaches natural size (1804px) or more", shown >= 1804, `${shown}px at scale ${scale}`);
    check("landscape phone: the full-screen cap is worked out from the window (above the inline 8×)", scale > 8, `max scale ${scale}`);
    await ctx.close();
  }

  // Privacy note: selecting text and releasing over the backdrop keeps it open; Close stays in reach on a short phone.
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 553 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(`${base}/obituary`, { waitUntil: "networkidle" });
    const privacy = page.getByRole("button", { name: "Privacy" });
    await privacy.scrollIntoViewIfNeeded();
    await privacy.tap();
    await settle(page);
    const close = await page.evaluate(() => {
      const r = [...document.querySelectorAll("dialog[open] button")].find((b) => b.textContent === "Close").getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight };
    });
    check("short phone (375×553): Close is visible without scrolling", close.bottom <= close.vh && close.top >= 0, JSON.stringify(close));
    await page.screenshot({ path: join(evidence, "11-short-phone-privacy-note.jpg"), quality: 80, type: "jpeg" });
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/obituary`, { waitUntil: "networkidle" });
    const privacy = page.getByRole("button", { name: "Privacy" });
    await privacy.scrollIntoViewIfNeeded();
    await privacy.click();
    await settle(page);
    const p = await page.locator("dialog[open] p").first().boundingBox();
    await page.mouse.move(p.x + 20, p.y + 10);
    await page.mouse.down();
    await page.mouse.move(8, 8, { steps: 10 });
    await page.mouse.up();
    await settle(page);
    const stillOpen = await page.evaluate(() => Boolean(document.querySelector("dialog[open]")));
    check("Privacy note: selecting text and releasing on the backdrop keeps it open", stillOpen);
    const gutter = await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarGutter);
    check("open dialog keeps a stable scrollbar gutter", gutter.startsWith("stable"), gutter);
    await ctx.close();
  }

  // Full-screen focus ring is drawn inside the canvas; the controls are a labelled group, not a toolbar.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/how-it-was-built`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Full screen: Architecture" }).click();
    await settle(page, 600);
    let ring = null;
    for (let i = 0; i < 15 && !ring; i++) {
      await page.keyboard.press("Tab");
      ring = await page.evaluate(() => {
        const a = document.activeElement;
        return a?.getAttribute("role") === "group" && a.getAttribute("aria-describedby")
          ? { offset: getComputedStyle(a).outlineOffset, style: getComputedStyle(a).outlineStyle, label: a.getAttribute("aria-label") }
          : null;
      });
    }
    check("full screen: the diagram area's focus ring is inset", ring && ring.offset === "-4px" && ring.style === "solid", JSON.stringify(ring));
    const toolbars = await page.evaluate(() => document.querySelectorAll("[role=toolbar]").length);
    check("no role=toolbar without arrow-key movement", toolbars === 0, String(toolbars));
    await ctx.close();
  }
}

// ---------------------------------------------------------------- Team Code Review round
// Each check here failed on the code before the round (2000e13) and passes after it.
{
  // The inline controls: arrows and Fit wait for a zoom, the arrows pan, a double-click does not zoom.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/how-it-was-built`, { waitUntil: "networkidle" });
  const arch = page.getByRole("figure", { name: "Architecture" });
  await arch.scrollIntoViewIfNeeded();
  await settle(page);

  // Read straight from the DOM: a locator would wait its full timeout for buttons the old code never rendered.
  const inlineControls = () =>
    page.evaluate(() => {
      const group = document.querySelector('main [role=group][aria-label="Architecture diagram controls"]');
      const buttons = [...group.querySelectorAll("button")];
      const fit = buttons.find((b) => b.getAttribute("aria-label") === "Fit Architecture to the screen");
      const arrows = buttons
        .filter((b) => b.getAttribute("aria-label")?.startsWith("Move the view "))
        .map((b) => ({
          label: b.getAttribute("aria-label"),
          disabled: b.getAttribute("aria-disabled"),
          width: Math.round(b.getBoundingClientRect().width),
          text: b.textContent.trim(),
        }));
      return { fit: fit.getAttribute("aria-disabled"), arrows };
    });
  const clickInlineArrow = (direction) =>
    page.evaluate((label) => {
      const group = document.querySelector('main [role=group][aria-label="Architecture diagram controls"]');
      [...group.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label)?.click();
    }, `Move the view ${direction}`);

  const atFit = await inlineControls();
  await clickInlineArrow("right");
  await settle(page);
  const afterFitArrow = await transformOf(page, 1);
  check(
    "inline: four icon-only 44px arrow buttons, aria-disabled and inert at fit size",
    atFit.arrows.length === 4 &&
      atFit.arrows.every((a) => a.disabled === "true" && a.width === 44 && a.text === "") &&
      Math.abs(afterFitArrow.x) < 1 &&
      Math.abs(afterFitArrow.scale - 1) < 0.001,
    JSON.stringify({ arrows: atFit.arrows, after: afterFitArrow }),
  );
  check("inline: Fit is aria-disabled at fit size", atFit.fit === "true", String(atFit.fit));

  await page.getByRole("button", { name: "Zoom in on Architecture" }).click();
  await settle(page);
  const zoomed = await inlineControls();
  const beforePan = await transformOf(page, 1);
  await clickInlineArrow("right");
  await settle(page);
  const afterPan = await transformOf(page, 1);
  check(
    "inline: after Zoom in, Fit and the arrows are enabled and the arrows pan",
    zoomed.fit === "false" && zoomed.arrows.length === 4 && zoomed.arrows.every((a) => a.disabled === "false") && afterPan.x < beforePan.x - 20,
    JSON.stringify({ fit: zoomed.fit, arrows: zoomed.arrows.map((a) => a.disabled), x: [beforePan.x, afterPan.x] }),
  );
  await arch.screenshot({ path: join(evidence, "12-desktop-architecture-panned.jpg"), quality: 80, type: "jpeg" });

  await page.getByRole("button", { name: "Fit Architecture to the screen" }).click();
  await settle(page);
  const box = await arch.locator(".react-transform-wrapper").boundingBox();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await settle(page, 600);
  const afterDouble = await transformOf(page, 1);
  check("inline: a double-click on a fitted diagram does not zoom it", Math.abs(afterDouble.scale - 1) < 0.001, JSON.stringify(afterDouble));

  // Footer links share the Privacy button's 44px touch height (DESIGN.md § 6).
  await page.goto(`${base}/obituary`, { waitUntil: "networkidle" });
  const footerLinks = await page.evaluate(() =>
    // Not the link inside the closed Privacy note, which also reads "How this site was built".
    [...document.querySelectorAll("footer a:not(dialog a)")]
      .filter((a) => ["Jo's obituary", "How this site was built"].includes(a.textContent.trim()))
      .map((a) => ({ text: a.textContent.trim(), height: Math.round(a.getBoundingClientRect().height) })),
  );
  check("footer: the obituary and how-it-was-built links are ≥44px tall", footerLinks.length === 2 && footerLinks.every((l) => l.height >= 44), JSON.stringify(footerLinks));

  // A press and release on the note's own 3px border keeps it open; the backdrop still closes it.
  const privacy = page.getByRole("button", { name: "Privacy" });
  await privacy.scrollIntoViewIfNeeded();
  await privacy.click();
  await settle(page);
  const border = await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    const r = d.getBoundingClientRect();
    const x = Math.round(r.left + 1);
    const y = Math.round(r.top + r.height / 2);
    return { x, y, onDialog: document.elementFromPoint(x, y) === d, borderLeft: getComputedStyle(d).borderLeftWidth };
  });
  await page.mouse.click(border.x, border.y);
  await settle(page);
  const openAfterBorder = await page.evaluate(() => Boolean(document.querySelector("dialog[open]")));
  await page.mouse.click(8, 8);
  await settle(page);
  const openAfterBackdrop = await page.evaluate(() => Boolean(document.querySelector("dialog[open]")));
  check(
    "Privacy note: a click on its border keeps it open; a backdrop click closes it",
    border.onDialog && openAfterBorder && !openAfterBackdrop,
    JSON.stringify({ ...border, openAfterBorder, openAfterBackdrop }),
  );
  await ctx.close();
}

{
  // Phone: a quick double-tap while scrolling past a diagram must not zoom it (and so cannot trap one-finger scrolling).
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${base}/how-it-was-built`, { waitUntil: "networkidle" });
  const arch = page.getByRole("figure", { name: "Architecture" });
  await arch.scrollIntoViewIfNeeded();
  await settle(page);
  const box = await arch.locator(".react-transform-wrapper").boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await settle(page, 600);
  const t = await transformOf(page, 1);
  check("phone: a double-tap on a fitted diagram does not zoom it", Math.abs(t.scale - 1) < 0.001, JSON.stringify(t));
  await ctx.close();
}

// Short screens: the focused "How this site was built" link sits inside the note's scrolling text, clear of the
// Close row, which no longer overlaps the scrolling area at all.
for (const [width, height, shot] of [
  [375, 480, "13-short-phone-privacy-note-link-focused.jpg"],
  [844, 390, "14-landscape-privacy-note-link-focused.jpg"],
]) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${base}/obituary`, { waitUntil: "networkidle" });
  const privacy = page.getByRole("button", { name: "Privacy" });
  await privacy.scrollIntoViewIfNeeded();
  await privacy.tap();
  await settle(page);
  await page.keyboard.press("Tab");
  await settle(page);
  const geo = await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    const link = d.querySelector("a");
    let region = link.parentElement;
    while (region && !["auto", "scroll"].includes(getComputedStyle(region).overflowY)) {
      region = region.parentElement;
    }
    const closeRow = [...d.querySelectorAll("button")].find((b) => b.textContent === "Close").parentElement;
    const round = (r) => ({ top: Math.round(r.top), bottom: Math.round(r.bottom) });
    return {
      focused: document.activeElement === link,
      scrolls: region.scrollHeight > region.clientHeight,
      link: round(link.getBoundingClientRect()),
      region: round(region.getBoundingClientRect()),
      closeRow: round(closeRow.getBoundingClientRect()),
    };
  });
  const inside = geo.link.top >= geo.region.top && geo.link.bottom <= geo.region.bottom;
  const clear = geo.closeRow.top >= geo.region.bottom && geo.link.bottom <= geo.closeRow.top;
  check(`short screen ${width}×${height}: the focused link is inside the note's scrolling text, clear of the Close row`, geo.focused && geo.scrolls && inside && clear, JSON.stringify(geo));
  await page.screenshot({ path: join(evidence, shot), quality: 80, type: "jpeg" });
  await ctx.close();
}

// Full screen with a scrollbar that takes space. Chrome 145+ subtracts a reserved gutter from 100vw; WebKit and Firefox
// do not, so this runs in Playwright's WebKit. Headless browsers on macOS draw overlay scrollbars, so the page gets a
// 15px classic scrollbar that stays while the dialog is open, the same width the open dialog's scrollbar-gutter:
// stable reserves on Windows or with "Always show scroll bars".
{
  const { webkit } = require("playwright-core");
  let wk = null;
  try {
    wk = await webkit.launch();
  } catch (error) {
    check("WebKit, classic scrollbar: full screen stays inside the usable width", false, `Playwright WebKit did not start (npx playwright-core install webkit): ${String(error).split("\n")[0]}`);
  }
  if (wk) {
    const page = await wk.newPage({ viewport: { width: 1280, height: 900 } });
    // WebKit ignores a scrollbar style added after load (the root scrollbar already exists), and React's hydration
    // removes one placed directly in <html>, so it goes into <head> as soon as the document is parsed.
    await page.addInitScript((css) => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = css;
        document.head.append(style);
      });
    }, "::-webkit-scrollbar { width: 15px; } ::-webkit-scrollbar-thumb { background: #888; } html:root:has(dialog:modal) { overflow-y: scroll; }");
    await page.goto(`${base}/how-it-was-built`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Full screen: Architecture" }).click();
    await settle(page, 700);
    const fit = await page.evaluate(() => {
      const d = document.querySelector("dialog[open]");
      const close = [...d.querySelectorAll("button")].find((b) => b.textContent === "Close");
      return {
        dialog: Math.round(d.getBoundingClientRect().width),
        closeRight: Math.round(close.getBoundingClientRect().right),
        usable: document.documentElement.clientWidth,
        window: innerWidth,
      };
    });
    check(
      "WebKit, classic scrollbar: full screen stays inside the usable width",
      fit.usable < fit.window && fit.dialog <= fit.usable && fit.closeRight <= fit.usable,
      JSON.stringify(fit),
    );
    await wk.close();
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
