// Sends the memory-confirmation template (with sample content and inline
// previews) to one address through SendGrid.
// Usage: npx tsx --env-file=.env scripts/send-test-email.ts <address>
// Runs outside Next.js, so it uses @sendgrid/mail directly and writes no
// EmailLog row. The address must be allowlisted unless OUTBOUND_ENABLED=true.
import sgMail from "@sendgrid/mail";

import { buildSampleConfirmation } from "./sample-confirmation";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

async function main(): Promise<void> {
  const to = process.argv[2]?.trim().toLowerCase();
  if (!to) {
    throw new Error("usage: send-test-email.ts <address>");
  }
  const allowlist = (process.env.OUTBOUND_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (process.env.OUTBOUND_ENABLED !== "true" && !allowlist.includes(to)) {
    throw new Error(`${to} is not in OUTBOUND_ALLOWLIST and OUTBOUND_ENABLED is not "true"`);
  }
  sgMail.setApiKey(required("SENDGRID_API_KEY"));
  const rendered = await buildSampleConfirmation("https://www.jowray.com/m/example-token");
  const [response] = await sgMail.send({
    to,
    from: required("SENDGRID_FROM_EMAIL"),
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    attachments: rendered.attachments.map((a) => ({
      content: a.contentBase64,
      filename: a.filename,
      type: a.contentType,
      disposition: "inline",
      contentId: a.contentId,
    })),
    trackingSettings: { clickTracking: { enable: false, enableText: false }, openTracking: { enable: false } },
  });
  const bytes = rendered.attachments.reduce((sum, a) => sum + Math.round(a.contentBase64.length * 0.75), 0);
  console.log(`status ${response.statusCode}; x-message-id ${String(response.headers["x-message-id"] ?? "")}; html ${Buffer.byteLength(rendered.html)} bytes; ${rendered.attachments.length} attachments (${bytes} bytes)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
