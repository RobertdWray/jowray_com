import "server-only";

import { VercelBlobStorageService } from "@/integrations/vercel-blob";

import type { StorageService } from "./types";

export type {
  PresignGetOptions,
  PresignGetResult,
  StorageGetResult,
  StorageHeadResult,
  StorageService,
} from "./types";

let cached: StorageService | undefined;

/** The configured storage implementation. Env is read on first use, not here. */
export function createStorageService(): StorageService {
  cached ??= new VercelBlobStorageService();
  return cached;
}
