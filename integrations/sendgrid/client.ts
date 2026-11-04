import "server-only";

import sgMail from "@sendgrid/mail";

import { getEmailEnv } from "@/server/config/env";

/**
 * Per-request HTTP timeout. A hung SendGrid request would otherwise hold a
 * Server Function or the reconcile cron until the platform kills it; three
 * attempts at this bound stay inside the cron's 50 s step budget.
 */
export const SENDGRID_REQUEST_TIMEOUT_MS = 10_000;

let configuredKey: string | undefined;

/** The SendGrid mail client with the current API key and timeout applied (re-applied if the key changes). */
export function getSendGridClient(): typeof sgMail {
  const key = getEmailEnv().SENDGRID_API_KEY;
  if (configuredKey !== key) {
    sgMail.setApiKey(key);
    sgMail.setTimeout(SENDGRID_REQUEST_TIMEOUT_MS);
    configuredKey = key;
  }
  return sgMail;
}
