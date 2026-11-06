/**
 * The family's contact address, the one place it is spelled out. The site
 * footer and the confirmation email show it, and every outgoing email sets it
 * as Reply-To: the sending address (`SENDGRID_FROM_EMAIL`, memories@jowray.com)
 * is not an inbox anyone reads, so a reader who presses Reply must reach a real
 * person. Client-safe: no secrets, no `server-only`.
 */
export const FAMILY_CONTACT_EMAIL = "robwray@gmail.com";
