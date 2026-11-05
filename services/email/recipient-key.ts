/**
 * The key the per-recipient daily cap counts by (issue #46, D3). The address
 * that is stored and sent is never changed; only the cap's bookkeeping treats
 * aliases of one inbox as one inbox:
 *
 * - lower-cased and trimmed (the validation layer already does this for the
 *   contributor address; the admin list is lower-cased by `csvList`);
 * - the `+tag` sub-address is dropped on every domain;
 * - `googlemail.com` is the same inbox as `gmail.com` and folds into it; dots
 *   in a Gmail local part are dropped, because Gmail ignores them.
 *
 * Pure module (no server-only, no env).
 */

const GMAIL = "gmail.com";
const GMAIL_ALIASES = new Set([GMAIL, "googlemail.com"]);

export function recipientKey(address: string): string {
  const lower = address.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at <= 0) {
    return lower;
  }
  const gmail = GMAIL_ALIASES.has(lower.slice(at + 1));
  const domain = gmail ? GMAIL : lower.slice(at + 1);
  let local = lower.slice(0, at);
  const plus = local.indexOf("+");
  if (plus > 0) {
    local = local.slice(0, plus);
  }
  if (gmail) {
    local = local.replaceAll(".", "");
  }
  return `${local}@${domain}`;
}
