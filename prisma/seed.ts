// Seed: one Memorial and its Person row, idempotent and non-destructive.
// Runs under `tsx` (prisma db seed), so it builds its own client and imports
// nothing guarded by `server-only`. `update: {}` on both upserts means edits
// made later in Prisma Studio survive every redeploy.
import { PrismaNeon } from "@prisma/adapter-neon";

import { PrismaClient } from "../generated/prisma/client";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required to seed the database`);
  }
  return value;
}

async function main(): Promise<void> {
  const connectionString = required("DATABASE_URL_UNPOOLED");
  const name = required("MEMORIAL_NAME");
  const slug = required("MEMORIAL_SLUG");
  // Not used here, but the app cannot serve /share without it; fail the
  // deployment at seed time rather than at the first request.
  required("CONSENT_VERSION");

  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
  try {
    const memorial = await prisma.memorial.upsert({
      where: { slug },
      create: { name, slug },
      update: {},
    });
    // The deceased is identified by the flag, not by the (editable) name, so a
    // rename in Prisma Studio never produces a second deceased person.
    const deceased = await prisma.person.findFirst({ where: { memorialId: memorial.id, isTheDeceased: true } });
    if (!deceased) {
      await prisma.person.create({ data: { memorialId: memorial.id, name: memorial.name, isTheDeceased: true } });
    }
    console.log(`seed: memorial "${slug}" (${memorial.id}) and its person row are present`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("seed failed:", error);
  process.exitCode = 1;
});
