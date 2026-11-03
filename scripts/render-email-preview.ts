// Writes the sample confirmation email as a standalone HTML file for review in
// a browser, with every `cid:` image inlined as a data: URI (browsers cannot
// resolve Content-IDs). The real email never contains data: or http(s) images.
// Usage: npx tsx scripts/render-email-preview.ts [out.html]
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSampleConfirmation } from "./sample-confirmation";

async function main(): Promise<void> {
  const out = process.argv[2] ?? join(tmpdir(), "jowray-confirmation-preview.html");
  const rendered = await buildSampleConfirmation("https://www.jowray.com/m/example-token");
  let html = rendered.html;
  for (const attachment of rendered.attachments) {
    // Match the closing quote too: `brand-heart` is a prefix of `brand-heart-stitched`.
    html = html.replaceAll(`cid:${attachment.contentId}"`, `data:${attachment.contentType};base64,${attachment.contentBase64}"`);
  }
  writeFileSync(out, html);
  writeFileSync(out.replace(/\.html$/, "") + ".txt", rendered.text);
  console.log(`${out} (${Buffer.byteLength(rendered.html)} bytes of HTML before inlining; text part beside it)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
