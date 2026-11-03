import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../generated/prisma/client";
async function main() {
  const p = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL_UNPOOLED! }) });
  const r = await p.memoryRevision.findFirst({ orderBy: { createdAt: "desc" } });
  console.log(JSON.stringify({ changedVia: r?.changedVia, before: r?.before, after: r?.after }, null, 1));
  await p.$disconnect();
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
