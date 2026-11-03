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

  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
  try {
    const memorial = await prisma.memorial.upsert({
      where: { slug },
      create: { name, slug },
      update: {},
    });
    await prisma.person.upsert({
      where: { memorialId_name: { memorialId: memorial.id, name } },
      create: { memorialId: memorial.id, name, isTheDeceased: true },
      update: {},
    });
    console.log(`seed: memorial "${slug}" (${memorial.id}) and its person row are present`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("seed failed:", error);
  process.exitCode = 1;
});
