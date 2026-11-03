// Sends the memory-confirmation template to one address through SendGrid.
// Usage: npx tsx --env-file=.env scripts/send-test-email.ts <address>
// Runs outside Next.js, so it uses @sendgrid/mail directly and writes no
// EmailLog row. The address must be allowlisted unless OUTBOUND_ENABLED=true.
import sgMail from "@sendgrid/mail";

import { buildMemoryConfirmation } from "../services/email/templates/memory-confirmation";

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
  const rendered = buildMemoryConfirmation({
    name: "Test Contributor",
    received: { type: "PHOTO", fileCount: 1 },
    claimLink: "https://www.jowray.com/m/example-token",
    usageSentence: process.env.TEST_USAGE_SENTENCE,
  });
  const [response] = await sgMail.send({
    to,
    from: required("SENDGRID_FROM_EMAIL"),
    ...rendered,
    trackingSettings: { clickTracking: { enable: false, enableText: false }, openTracking: { enable: false } },
  });
  console.log(`status ${response.statusCode}; x-message-id ${String(response.headers["x-message-id"] ?? "")}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
