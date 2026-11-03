// Idempotent SendGrid domain authentication for jowray.com on Cloudflare DNS.
// Usage: npx tsx --env-file=.env scripts/dns-setup.ts
//
// 1. Verifies the account-owned Cloudflare token.
// 2. Finds or creates the SendGrid domain authentication (automated security:
//    one CNAME for mail, two for DKIM) and reads its DNS records from the API.
// 3. Creates each missing record in the zone (proxied: false, host label only)
//    plus a DMARC TXT record (p=none) when none exists. Existing records are
//    left untouched and printed with their ids.
// 4. Asks SendGrid to validate; prints the result (DNS can take up to 48 h).

const DOMAIN = "jowray.com";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

const cfToken = required("CLOUDFLARE_DNS_ONLY_API_TOKEN");
const cfAccount = required("CLOUDFLARE_ACCOUNT_ID");
const cfZone = required("CLOUDFLARE_ZONE_ID");
const sgKey = required("SENDGRID_API_KEY");

interface CfRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
}

async function cf<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cfToken}`, "Content-Type": "application/json", ...init.headers },
  });
  const body = (await res.json()) as { success: boolean; errors: unknown[]; result: T };
  if (!res.ok || !body.success) {
    throw new Error(`Cloudflare ${path} failed: ${JSON.stringify(body.errors)}`);
  }
  return body.result;
}

async function sg<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.sendgrid.com/v3${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${sgKey}`, "Content-Type": "application/json", ...init.headers },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`SendGrid ${path} failed (${res.status}): ${text}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

interface SgDnsRecord {
  host: string;
  type: string;
  data: string;
  valid: boolean;
}
interface SgDomain {
  id: number;
  domain: string;
  subdomain: string;
  valid: boolean;
  dns: Record<string, SgDnsRecord>;
}

async function ensureSendGridDomain(): Promise<SgDomain> {
  const existing = await sg<SgDomain[]>(`/whitelabel/domains?domain=${DOMAIN}`);
  const match = existing.find((d) => d.domain === DOMAIN);
  if (match) {
    console.log(`sendgrid: domain authentication exists (id ${match.id}, subdomain ${match.subdomain}, valid ${match.valid})`);
    return match;
  }
  const created = await sg<SgDomain>("/whitelabel/domains", {
    method: "POST",
    body: JSON.stringify({ domain: DOMAIN, automatic_security: true, default: false }),
  });
  console.log(`sendgrid: created domain authentication id ${created.id} (subdomain ${created.subdomain})`);
  return created;
}

/** Host label relative to the zone: "em1234.jowray.com" → "em1234". */
function label(host: string): string {
  return host.endsWith(`.${DOMAIN}`) ? host.slice(0, -(DOMAIN.length + 1)) : host;
}

async function ensureRecord(type: string, name: string, content: string): Promise<void> {
  const fqdn = name === "@" ? DOMAIN : `${name}.${DOMAIN}`;
  const found = await cf<CfRecord[]>(`/zones/${cfZone}/dns_records?type=${type}&name=${fqdn}`);
  if (found.length > 0) {
    const r = found[0];
    const same = r.content.replace(/\.$/, "") === content.replace(/\.$/, "");
    console.log(`cloudflare: ${type} ${fqdn} exists (id ${r.id}${same ? "" : ", DIFFERENT content: " + r.content}${r.proxied ? ", PROXIED" : ""})`);
    return;
  }
  const created = await cf<CfRecord>(`/zones/${cfZone}/dns_records`, {
    method: "POST",
    body: JSON.stringify({ type, name: fqdn, content, proxied: false, ttl: 1, comment: "SendGrid domain authentication (Phase 1 Task 6)" }),
  });
  console.log(`cloudflare: created ${type} ${fqdn} -> ${content} (id ${created.id})`);
}

async function main(): Promise<void> {
  const verify = await cf<{ status: string }>(`/accounts/${cfAccount}/tokens/verify`);
  console.log(`cloudflare: token ${verify.status}`);

  const domain = await ensureSendGridDomain();
  for (const [key, record] of Object.entries(domain.dns)) {
    await ensureRecord(record.type.toUpperCase(), label(record.host), record.data);
    console.log(`  (${key}: ${record.host} ${record.type} ${record.data}; sendgrid valid=${record.valid})`);
  }
  await ensureRecord("TXT", "_dmarc", "v=DMARC1; p=none; rua=mailto:dmarc@jowray.com");

  const validation = await sg<{ id: number; valid: boolean; validation_results: Record<string, { valid: boolean; reason: string | null }> }>(
    `/whitelabel/domains/${domain.id}/validate`,
    { method: "POST" }
  );
  console.log(`sendgrid: validation valid=${validation.valid}`);
  for (const [k, v] of Object.entries(validation.validation_results)) {
    console.log(`  ${k}: ${v.valid ? "valid" : "pending"}${v.reason ? " (" + v.reason + ")" : ""}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
