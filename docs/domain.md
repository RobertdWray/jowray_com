# Custom domain: jowray.com

Set up on 2026-11-02. This file records how `jowray.com` reaches the Vercel project. It has no secrets: the zone, record, and project IDs below are resource identifiers, not credentials.

## What serves what

| Host | Behavior |
|---|---|
| `https://www.jowray.com` | **Primary.** Serves the `jowray.com` Vercel project's production deployment. |
| `https://jowray.com` | 308 to `https://www.jowray.com`, with the path and query string kept. |
| `http://…` (either host) | 308 to the `https://` version of the same host. |
| `https://jowraycom.vercel.app` | Still serves production. Vercel keeps it. |

Using `www` as the primary host with the apex redirecting to it matches Rob's other Vercel projects (`robwray.com`, `trayverify.com`, `tray-verify.com`).

## Vercel

The project is `rob-wrays-projects/jowray.com` (`prj_UWoR1IGnShoagieZphn2aXOnGSfm`). Both domains were added to it through the REST API (`POST /v10/projects/{id}/domains`):

- `www.jowray.com`: no redirect.
- `jowray.com`: `redirect: www.jowray.com`, `redirectStatusCode: 308`.

Both were `verified: true` when added, so no TXT ownership challenge was needed. Vercel issues and renews the Let's Encrypt certificates itself. Each host has its own certificate, and the first ones were issued 2026-11-02 and expire 2027-01-31.

## Cloudflare DNS

The `jowray.com` zone (`dad5b9fdb1ece5afc4a4224f61a51770`) uses the `beth`/`koa.ns.cloudflare.com` nameservers. It was empty before this change.

| Type | Name | Content | Proxy | TTL |
|---|---|---|---|---|
| A | `jowray.com` | `216.150.1.1` | DNS only | Auto |
| A | `jowray.com` | `216.150.16.1` | DNS only | Auto |
| CNAME | `www.jowray.com` | `533586c4b1899047.vercel-dns-016.com` | DNS only | Auto |

- Each record has a Cloudflare comment that names the Vercel project.
- The values are Vercel's rank-1 recommendations from `GET /v6/domains/{domain}/config?projectIdOrName=…`. The older `76.76.21.21` and `cname.vercel-dns.com` still work as rank-2 fallbacks.
- **Keep these records DNS only (grey cloud).** Vercel's edge terminates TLS and issues the certificates. If you proxy them through Cloudflare, Cloudflare's SSL mode applies too, which can cause redirect loops or certificate renewal failures.
- There's no CAA record, so Let's Encrypt can issue. If you add a CAA record later, allow `letsencrypt.org`.

## Cloudflare API token

`CLOUDFLARE_DNS_ONLY_API_TOKEN` in `.env` is an **account-owned** token:

- `GET /accounts/{CLOUDFLARE_ACCOUNT_ID}/tokens/verify` succeeds, but the user-token endpoint `/user/tokens/verify` rejects it.
- It can list and edit DNS records in every zone in the account, not just `jowray.com`.
- It can't read zone settings such as the SSL mode. Grey-cloud records don't need that.

The Cloudflare API MCP server (`https://mcp.cloudflare.com/mcp`, [docs](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/)) accepts the same token as a bearer header. This setup called the REST API directly instead, so no MCP server is configured for this repo.

## Re-check

```bash
# DNS
dig +noall +answer A jowray.com @1.1.1.1
dig +noall +answer www.jowray.com @1.1.1.1

# HTTP: expect 200 on www, 308 on apex
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://www.jowray.com/
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://jowray.com/

# Vercel's view: both domains listed under the jowray.com project
vercel domains inspect jowray.com --scope rob-wrays-projects
```

`vercel domains inspect` puts a ✘ next to `beth`/`koa.ns.cloudflare.com`. That's expected: it only means the domain doesn't use Vercel's nameservers. Vercel's verdict on the DNS records is the `misconfigured` field from `GET /v6/domains/{domain}/config`, which was `false` for both hosts on 2026-11-02. The project's Domains page in the dashboard shows the same status.

Your machine may say a host doesn't resolve for up to 30 minutes after a record is added. The zone's negative-cache TTL (SOA minimum) is 1800s, so a lookup made before the record existed stays cached that long. Query a public resolver directly, or flush the macOS cache with `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`.

## Not done here

- **Email DNS.** The zone has no MX, SPF, DKIM, or DMARC records. Add them when SendGrid sending is set up, using SendGrid's domain authentication CNAMEs plus a DMARC record. Until then, nothing stops someone from spoofing `@jowray.com` addresses.
- **The `vercel.app` alias.** `jowraycom.vercel.app` still serves the site instead of redirecting to `www.jowray.com`. That's harmless now. If duplicate indexing ever matters, redirect it.
- **Absolute URLs in code.** The app doesn't build any yet. When it does (Open Graph `metadataBase`, magic-link callbacks, SMS reply links), use `https://www.jowray.com`.

## Email DNS (SendGrid domain authentication, added 2026-11-03)

Created by `scripts/dns-setup.ts` (idempotent; re-run it to check validation). SendGrid domain authentication id `33798852`, subdomain `em4653`. All records are DNS-only (grey cloud).

| Type | Name | Content | Cloudflare record id |
|---|---|---|---|
| CNAME | `em4653` | `u46785377.wl128.sendgrid.net` | `496f00c07369a141a68fde36ead9cd71` |
| CNAME | `s1._domainkey` | `s1.domainkey.u46785377.wl128.sendgrid.net` | `ac50b464b68b2414420ea3276500e738` |
| CNAME | `s2._domainkey` | `s2.domainkey.u46785377.wl128.sendgrid.net` | `8931d1c589ebf61c67c588090494d13c` |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@jowray.com` | `c726c35b037f8ab93d2c9d23f1c827a1` |

No `MX` record exists; `jowray.com` does not receive mail (`dmarc@jowray.com` reports go nowhere until one is added).
