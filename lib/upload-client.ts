import { upload } from "@vercel/blob/client";

import type { UploadTicket } from "@/lib/upload-ticket";

/** What a ticketing Server Function hands the browser: the Blob pathname and the signed ticket. */
export interface UploadGrantLike {
  pathname: string;
  ticket: UploadTicket;
}

/**
 * The one way the browser sends a file to the store. The token exchange at
 * /api/upload authorizes exactly the ticketed pathname, type and size, so the
 * content type is always the ticket's (recordings have no extension type and
 * the SDK only sends the type when it is set here). Private, multipart.
 */
export async function uploadWithTicket(grant: UploadGrantLike, file: File, onProgress?: (percentage: number) => void): Promise<void> {
  await upload(grant.pathname, file, {
    access: "private",
    handleUploadUrl: "/api/upload",
    multipart: true,
    contentType: grant.ticket.mimeType,
    clientPayload: JSON.stringify(grant.ticket),
    ...(onProgress && { onUploadProgress: ({ percentage }: { percentage: number }) => onProgress(Math.round(percentage)) }),
  });
}
