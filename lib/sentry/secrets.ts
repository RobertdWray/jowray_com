/**
 * The bearer secrets this site handles, by the names they travel under.
 * Pure constants, no `server-only`: the browser scrubber uses them too.
 *
 * The Sentry SDK's own denylist already matches `token` and `auth` by partial
 * key; `ticket`, `clientPayload`, `sig`, `claimLink`, `shareUrl`, `presignedUrl` and the two `x-vercel-*`
 * headers are not on it, so they are named here. Invite tokens and share URLs
 * are bearer secrets too (R10, plan 2026-11-07 §8.7).
 */

/** Keys whose values are bearer secrets; matched case-insensitively as whole keys. */
// `key` is the family admin entry key (the argument of the admin `enterAdmin` Server Function, PR #31).
export const SECRET_FIELD_KEYS = ["claimToken", "claimTokens", "claimLink", "ticket", "clientPayload", "sig", "key", "presignedUrl", "shareUrl", "inviteToken"] as const;

/** Key fragments: any key containing one of these is a secret (covers future `*Token*` fields). */
export const SECRET_KEY_FRAGMENTS = ["token", "ticket"] as const;

/**
 * Request headers whose values are bearer secrets (cookies, auth, the Vercel
 * bypass and signature) or carry a claim/invite route: Next's router-state
 * header on a Server Function POST encodes the `[claimToken]` / `[inviteToken]` value
 * (URL-encoded, so no text scrubber sees it as a path). Dropped whole.
 */
export const SECRET_HEADER_KEYS = ["cookie", "authorization", "x-vercel-protection-bypass", "x-vercel-signature", "next-router-state-tree"] as const;
