import "server-only";

import sgMail from "@sendgrid/mail";

import { getEmailEnv } from "@/server/config/env";

let configuredKey: string | undefined;

/** The SendGrid mail client with the current API key applied (re-applied if it changes). */
export function getSendGridClient(): typeof sgMail {
  const key = getEmailEnv().SENDGRID_API_KEY;
  if (configuredKey !== key) {
    sgMail.setApiKey(key);
    configuredKey = key;
  }
  return sgMail;
}
