# Email replies and forwarding

Readers can reply to a site email and reach the family. Cloudflare Email Routing forwards the sending address to the same public contact address shown in the site footer and receipts.

**Status:** [PR #54](https://github.com/RobertdWray/jowray_com/pull/54) added the family contact constant and Reply-To (`af1d95f`, merged 2026-11-06). [PR #57](https://github.com/RobertdWray/jowray_com/pull/57) removed Reply-To after forwarding worked (`a5afe00`, merged 2026-11-06); that is the code at HEAD. Forwarding was configured and exercised with a Gmail message on 2026-11-06. The exports record ready Vercel previews, not a post-merge production header check.

## What we built

1. A reader receives a site email From `memories@jowray.com`, the configured `SENDGRID_FROM_EMAIL`.
2. Pressing **Reply** addresses the response to `memories@jowray.com`. Cloudflare forwards it to `robwray@gmail.com`, the family inbox. No Reply-To overrides the From address.
3. The footer (`app/_components/site-footer.tsx`) and the receipt's questions line also show `robwray@gmail.com` as a mailto link. These use `FAMILY_CONTACT_EMAIL` from `lib/contact.ts`; the receipt copy lives in `services/email/templates/memory-confirmation.ts`. Clicking either link addresses the family inbox directly.

## Why we built it

[PR #54](https://github.com/RobertdWray/jowray_com/pull/54) described the failure: "A family member who presses **Reply** on a confirmation gets a bounce." The zone had no MX record; replies could not reach a person. Reply-To first supplied a working destination, then forwarding made the sending address itself receive mail.

## Key decisions (Rob)

| Decision | Source |
|---|---|
| Agent's fix in #54: set Reply-To on every email while the zone had no MX. Merged 2026-11-06; the export records no separate verbatim Rob ruling. | [PR #54](https://github.com/RobertdWray/jowray_com/pull/54) |
| Rob chose to remove Reply-To once forwarding worked (2026-11-06, as reported by the PR). A freemail Reply-To on a jowray.com From costs about 2 SpamAssassin points under `FREEMAIL_FORGED_REPLYTO`. | [PR #57](https://github.com/RobertdWray/jowray_com/pull/57), [inbound email](../domain.md#inbound-email-cloudflare-email-routing-enabled-2026-11-06) |
| Leave `dmarc@jowray.com` unrouted for now. The PR records this as deliberate scope, without a separate Rob quote. | [PR #57](https://github.com/RobertdWray/jowray_com/pull/57) |

## How it works

`deliver()` sets From from `SENDGRID_FROM_EMAIL` for receipts, admin alerts and the pause notice. `OutboundEmail`, the SendGrid transport and `scripts/send-test-email.ts` have no Reply-To field. The two receipt templates share `CONFIRMATION_COPY`, including the family contact line.

Inbound mail goes through Cloudflare to the family mailbox, outside the app and its delivery log. The rule matches the literal address; if the zone's subaddressing setting is on, `memories+<tag>@jowray.com` matches the same rule. That setting is not recorded in the repo. The rule does not follow an env change. Its destination is a second copy of `FAMILY_CONTACT_EMAIL`, managed outside the repository. For outbound receipts, alerts, caps and retries, see [Email and cron](./email-and-cron.md#what-we-built).

## Operations and rollback

- Before changing `SENDGRID_FROM_EMAIL`, add and verify a routing rule for the new address. Before changing `FAMILY_CONTACT_EMAIL`, verify the new destination in Cloudflare and update the rule along with the constant. Keep the old sending address routable for replies to earlier mail.
- This feature adds no env key: `SENDGRID_FROM_EMAIL` is an [existing email setting](../environment.md#phase-1-storage-and-email-keys-task-5), and `FAMILY_CONTACT_EMAIL` is a code constant. Rule management, OAuth requirements, destination and rule IDs are in [Inbound email](../domain.md#inbound-email-cloudflare-email-routing-enabled-2026-11-06); the repo's DNS token cannot manage Email Routing.
- After a change, use the [DNS and rule re-check commands](../domain.md#re-check), then repeat the delivery check recorded under [Inbound email](../domain.md#inbound-email-cloudflare-email-routing-enabled-2026-11-06). Inspect a newly delivered site email's From and Reply-To headers and reply to it; DNS alone does not prove inbox delivery. Keep SendGrid's separate authentication records intact ([Email DNS](../domain.md#email-dns-sendgrid-domain-authentication-added-2026-11-03)).
- Forwarding is controlled in Cloudflare, not by an app switch. Disabling the rule breaks replies. For rollback, restore the last working rule and verified destination; keep routing during an app rollback. Returning to #54 restores the freemail Reply-To on new mail and its spam-score tradeoff, but cannot change headers on mail already sent.

## Key files

| Path | Role |
|---|---|
| **app** | |
| `app/_components/site-footer.tsx` | Public contact link |
| **services + integrations** | |
| `services/email/index.ts`, `services/email/types.ts` | Shared From setting; outbound contract without Reply-To |
| `services/email/templates/memory-confirmation.ts`, `services/email/templates/submission-confirmation.ts` | Shared receipt contact copy |
| `integrations/sendgrid/index.ts` | SendGrid payload without Reply-To |
| **lib + server** | |
| `lib/contact.ts`, `server/config/env.ts` | Family contact constant and sending-address validation |
| **scripts and docs** | |
| `scripts/send-test-email.ts` | Sample send with the same From and no Reply-To |
| `docs/domain.md`, `docs/environment.md` | Routing, DNS, verification and env runbooks |
| **tests** | |
| `__tests__/services/email.test.ts` | No Reply-To in the mocked SendGrid payload |
| `__tests__/services/email-template.test.ts` | Receipt contact text and mailto link |

## Tests and evidence

- The email test exercises memory receipts, submission receipts and admin alerts. It pins From and rejects `replyTo`, `replyToList` and any case of a raw Reply-To header. Its comment records the SpamAssassin reason. The template test pins the questions line in text and HTML.
- [PR #54](https://github.com/RobertdWray/jowray_com/pull/54) and [PR #57](https://github.com/RobertdWray/jowray_com/pull/57) each report `npm run validate` and `npm run build:offline` exit 0, and `npm run test:run`: 1216 passed, 7 skipped. #57 records the test-email script reaching its usage check under tsx; nothing was sent. Their Vercel comments show ready previews; no full CI result is included in the exports.
- [Forwarding proof, 2026-11-06](../domain.md#inbound-email-cloudflare-email-routing-enabled-2026-11-06): a Gmail message to the sending address arrived at the family inbox. SPF (SRS), DKIM (`jowray.com`, `cloudflare-email.net`, `gmail.com`), ARC and DMARC passed.
- Checked by the orchestrator, **2026-11-07 01:07 UTC**: MX answered `route1.mx.cloudflare.net`, `route2.mx.cloudflare.net`, `route3.mx.cloudflare.net` at priorities 22, 54, 82; SPF answered `v=spf1 include:_spf.mx.cloudflare.net ~all`; DMARC answered `v=DMARC1; p=none; rua=mailto:dmarc@jowray.com`. These match the [routing records](../domain.md#inbound-email-cloudflare-email-routing-enabled-2026-11-06) and [Email DNS](../domain.md#email-dns-sendgrid-domain-authentication-added-2026-11-03).
- **NOT RUN:** in this documentation task, npm checks, live DNS or mail sends; no supplied record of a reply from a non-Gmail mailbox, a post-#57 production header-and-reply check, or the deferred wire-format test below.

## Known gaps and follow-ups

- DMARC remains `p=none` (no enforcement). `dmarc@jowray.com`, its aggregate-report destination, has no rule and bounces. Catch-all is disabled, so every other `@jowray.com` address also bounces. Before tightening DMARC, Rob needs to route reports or change their destination and read them; see [Not done here](../domain.md#not-done-here).
- [PR #54](https://github.com/RobertdWray/jowray_com/pull/54) leaves a NICE wire-format test through the real SendGrid helper's `Mail.toJSON()` undone: it would import an undeclared transitive dependency. HEAD tests the mocked SDK payload, not that serialization step.

## Related

- [Email and cron](./email-and-cron.md), [Sentry telemetry](./sentry-telemetry.md)
- [Domain runbook](../domain.md), [Environment](../environment.md#phase-1-storage-and-email-keys-task-5), [Dependencies](../dependencies.md), [Code layout](../code-layout.md)
