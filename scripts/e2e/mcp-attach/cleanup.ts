import { del, list } from "@vercel/blob";

import { cleanupOriginals, HarnessError, isMain, parseCleanupArgs, publicError } from "./lib";

async function main(): Promise<void> {
  const { memoryId } = parseCleanupArgs(process.argv.slice(2));
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) { throw new HarnessError("BLOB_READ_WRITE_TOKEN is required."); }
  const result = await cleanupOriginals(memoryId, {
    list: (options) => list({ ...options, token }),
    del: (pathnames) => del(pathnames, { token }),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.remaining !== 0) {
    throw new HarnessError("Cleanup readback is not empty; stop uploads and inspect the test memory before retrying.");
  }
}

if (isMain(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(`cleanup: ${publicError(error)}`);
    process.exitCode = 1;
  });
}
