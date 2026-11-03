import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../generated/prisma/client";
async function main() {
  const p = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL_UNPOOLED! }) });
  const m = await p.memory.findFirst({ orderBy: { createdAt: "desc" }, include: { contributor: true, media: true, emails: true, revisions: true } });
  console.log(JSON.stringify({
    memory: m && { id: m.id, type: m.type, status: m.status, consentVersion: m.consentVersion, hash: m.claimTokenHash.slice(0, 8) + "…", note: m.contributorNote },
    contributor: m?.contributor && { name: m.contributor.name, relationship: m.contributor.relationship, email: m.contributor.email, contactOptIn: m.contributor.contactOptIn },
    media: m?.media.map((x) => ({ status: x.status, mime: x.mimeType, size: x.sizeBytes, checksum: x.checksumSha256?.slice(0, 12), key: x.storageKey, blobUrl: !!x.blobUrl })),
    emails: m?.emails.map((e) => ({ status: e.status, attempts: e.attempts, msgId: e.sendgridMessageId })),
    revisions: m?.revisions.length,
    webhookEvents: await p.webhookEvent.count(),
  }, null, 1));
  await p.$disconnect();
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
