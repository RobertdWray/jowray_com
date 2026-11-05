/**
 * The key the per-recipient daily cap counts by (issue #46, D3). The address
 * that is stored and sent is never changed; only the cap's bookkeeping treats
 * aliases of one inbox as one inbox:
 *
 * - lower-cased and trimmed (the validation layer already does this for the
 *   contributor address; the admin list is lower-cased by `csvList`);
 * - the `+tag` sub-address is dropped on every domain;
 * - dots in the local part are dropped for Gmail and Googlemail, which ignore them.
 *
 * Pure module (no server-only, no env).
 */

const DOT_INSENSITIVE_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export function recipientKey(address: string): string {
  const lower = address.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at <= 0) {
    return lower;
  }
  const domain = lower.slice(at + 1);
  let local = lower.slice(0, at);
  const plus = local.indexOf("+");
  if (plus > 0) {
    local = local.slice(0, plus);
  }
  if (DOT_INSENSITIVE_DOMAINS.has(domain)) {
    local = local.replaceAll(".", "");
  }
  return `${local}@${domain}`;
}
