import "server-only";

import { BlobNotFoundError, del, get, head, issueSignedToken, presignUrl, put } from "@vercel/blob";

import { createLogger } from "@/lib/logger";
import { getBlobEnv } from "@/server/config/env";
import type {
  PresignGetOptions,
  PresignGetResult,
  StorageGetResult,
  StorageHeadResult,
  StorageService,
} from "@/services/storage/types";

const log = createLogger({ category: "upload" });

export class VercelBlobStorageService implements StorageService {
  private token(): string {
    return getBlobEnv().BLOB_READ_WRITE_TOKEN;
  }

  async put(
    pathname: string,
    body: ReadableStream | Blob | Buffer,
    contentType: string
  ): Promise<StorageHeadResult> {
    await put(pathname, body, {
      access: "private",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: false,
      token: this.token(),
    });
    const meta = await this.head(pathname);
    if (!meta) {
      throw new Error(`Blob vanished after put: ${pathname}`);
    }
    log.info({ action: "put", pathname, sizeBytes: meta.size }, "blob stored");
    return meta;
  }

  async head(pathname: string): Promise<StorageHeadResult | null> {
    try {
      const result = await head(pathname, { token: this.token() });
      return {
        pathname: result.pathname,
        url: result.url,
        size: result.size,
        contentType: result.contentType,
        uploadedAt: result.uploadedAt,
      };
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async get(pathname: string): Promise<StorageGetResult | null> {
    const result = await get(pathname, { access: "private", token: this.token() });
    if (!result || result.statusCode !== 200) {
      return null;
    }
    return {
      stream: result.stream,
      contentType: result.blob.contentType,
      contentLength: result.blob.size,
    };
  }

  async del(pathname: string): Promise<void> {
    await del(pathname, { token: this.token() });
    log.info({ action: "del", pathname }, "blob deleted");
  }

  async presignGet(options: PresignGetOptions): Promise<PresignGetResult> {
    const signed = await issueSignedToken({
      pathname: options.pathname,
      operations: ["get"],
      validUntil: options.validUntil,
      token: this.token(),
    });
    const { presignedUrl } = await presignUrl(signed, {
      access: "private",
      operation: "get",
      pathname: options.pathname,
      validUntil: options.validUntil,
    });
    return { url: presignedUrl, expiresAt: new Date(options.validUntil) };
  }
}
