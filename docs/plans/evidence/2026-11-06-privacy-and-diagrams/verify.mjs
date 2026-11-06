// Browser checks for the Privacy note and the diagram viewer (plan verification step 2).
// Usage: node verify.mjs <worktree> <baseUrl> <evidenceDir>
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
    if (m.type() === "error") errors.push(m.text());
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
  check("desktop: Zoom out starts disabled at fit size", await zoomOutBtn.isDisabled());
  await page.getByRole("button", { name: "Zoom in on Architecture" }).click();
  await settle(page);
  const zoomedIn = await transformOf(page, 1);
  check("desktop: Zoom in scales the diagram up", zoomedIn.scale > 1.05, JSON.stringify(zoomedIn));
  check("desktop: Zoom out enabled once zoomed in", await zoomOutBtn.isEnabled());
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

  await dlg.getByRole("group", { name: /Arrow keys move it/ }).focus();
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

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
