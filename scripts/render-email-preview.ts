// Writes a sample email as a standalone HTML file for review in a browser,
// with every `cid:` image inlined as a data: URI (browsers cannot resolve
// Content-IDs). The real email never contains data: or http(s) images.
// Usage: npx tsx scripts/render-email-preview.ts [out.html] [confirmation|admin]
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { buildSampleAdminAlert } from "./sample-admin-alert";
import { buildSampleConfirmation } from "./sample-confirmation";

export type SampleTemplate = "confirmation" | "admin";

export function parseTemplate(value: string | undefined): SampleTemplate {
  if (value === undefined || value === "confirmation") {
    return "confirmation";
  }
  if (value === "admin") {
    return "admin";
  }
  throw new Error(`unknown template "${value}" (expected "confirmation" or "admin")`);
}

export async function buildSample(template: SampleTemplate) {
  return template === "admin" ? buildSampleAdminAlert() : buildSampleConfirmation("https://www.jowray.com/m/example-token");
}

async function main(): Promise<void> {
  const template = parseTemplate(process.argv[3]);
  const out = process.argv[2] ?? join(tmpdir(), `jowray-${template}-preview.html`);
  const rendered = await buildSample(template);
  let html = rendered.html;
  for (const attachment of rendered.attachments) {
    // Match the closing quote too: `brand-heart` is a prefix of `brand-heart-stitched`.
    html = html.replaceAll(`cid:${attachment.contentId}"`, `data:${attachment.contentType};base64,${attachment.contentBase64}"`);
  }
  writeFileSync(out, html);
  writeFileSync(out.replace(/\.html$/, "") + ".txt", rendered.text);
  console.log(`${out} (${template}: ${Buffer.byteLength(rendered.html)} bytes of HTML before inlining; text part beside it)`);
}

// Entrypoint check that survives `tsx scripts/render-email-preview` (no extension): compare the basename without `.ts`.
const isEntrypoint = basename(process.argv[1] ?? "").replace(/\.ts$/, "") === "render-email-preview";
if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
