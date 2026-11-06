/**
 * The family's contact address, the one place it is spelled out. The site
 * footer and the confirmation email show it. Emails set no Reply-To: a reply
 * to the sending address (`SENDGRID_FROM_EMAIL`, memories@jowray.com) is
 * forwarded here by Cloudflare Email Routing (`docs/domain.md`). That rule's
 * destination is a second copy of this address, outside the repo: change both
 * together. Client-safe: no secrets, no `server-only`.
 */
export const FAMILY_CONTACT_EMAIL = "robwray@gmail.com";
