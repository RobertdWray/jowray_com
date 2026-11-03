import "server-only";

import sgMail from "@sendgrid/mail";

import { getEmailEnv } from "@/server/config/env";

let configured = false;

/** The SendGrid mail client with the API key applied once, on first use. */
export function getSendGridClient(): typeof sgMail {
  if (!configured) {
    sgMail.setApiKey(getEmailEnv().SENDGRID_API_KEY);
    configured = true;
  }
  return sgMail;
}
