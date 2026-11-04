"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createDraftAsAdmin, type AdminDraftResult } from "@/features/admin/create-draft";
import { ADMIN_COOKIE, adminCookieOptions, isAdminKey, mintAdminCookie } from "@/features/admin/session";
import { setMemoryDeletedAsAdmin, type AdminDeletedResult } from "@/features/admin/set-deleted";
import { setMemoryStatusAsAdmin, type AdminStatusResult } from "@/features/admin/set-status";
import { updateMemoryAsAdmin, type AdminUpdateResult } from "@/features/admin/update-memory";
import { reissueDraftClaimLink, type ReissueResult } from "@/features/memories/draft-memory";
import { createLogger } from "@/lib/logger";
import { adminEnterSchema } from "@/lib/validations/admin";
import { getAdminPageEnv } from "@/server/config/env";

import { hasAdminSession } from "./_session";

const log = createLogger({ category: "api" });

type Unauthorized = { ok: false; code: "unauthorized" };
const UNAUTHORIZED: Unauthorized = { ok: false, code: "unauthorized" };

/**
 * Thin wrappers (docs/plans/2026-11-04-admin-page.md §3.8). Server Functions
 * are reachable by direct POST, so every mutating one checks the session
 * cookie first and never trusts the page that rendered the form. `enterAdmin`
 * is the one function that accepts a credential as a parameter: it is the
 * login step. Its key travels in the POST body, never a URL; `next.config.ts`
 * turns Server Function argument logging off so the dev log never prints it.
 */

export async function enterAdmin(input: unknown): Promise<{ ok: false; code: "unauthorized" | "invalid" }> {
  const parsed = adminEnterSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  if (!isAdminKey(parsed.data.key)) {
    // Never the key; `configured` tells a missing secret apart from a wrong link.
    log.warn({ action: "admin_page_unauthorized", configured: Boolean(getAdminPageEnv().ADMIN_PAGE_SECRET) }, "admin page entry refused");
    return UNAUTHORIZED;
  }
  (await cookies()).set(ADMIN_COOKIE, mintAdminCookie(), adminCookieOptions());
  log.info({ action: "admin_page_entered" }, "admin page session started");
  redirect("/admin");
}

export async function leaveAdmin(): Promise<never> {
  // Delete must name the path the cookie was set with.
  (await cookies()).delete({ name: ADMIN_COOKIE, path: "/admin" });
  redirect("/admin");
}

export async function saveMemory(input: unknown): Promise<AdminUpdateResult | Unauthorized> {
  if (!(await hasAdminSession())) {
    return UNAUTHORIZED;
  }
  return updateMemoryAsAdmin(input);
}

export async function setStatus(input: unknown): Promise<AdminStatusResult | Unauthorized> {
  if (!(await hasAdminSession())) {
    return UNAUTHORIZED;
  }
  return setMemoryStatusAsAdmin(input);
}

export async function setDeleted(input: unknown): Promise<AdminDeletedResult | Unauthorized> {
  if (!(await hasAdminSession())) {
    return UNAUTHORIZED;
  }
  return setMemoryDeletedAsAdmin(input);
}

export async function createDraft(input: unknown): Promise<AdminDraftResult | Unauthorized> {
  if (!(await hasAdminSession())) {
    return UNAUTHORIZED;
  }
  return createDraftAsAdmin(input);
}

export async function reissueLink(input: unknown): Promise<ReissueResult | Unauthorized> {
  if (!(await hasAdminSession())) {
    return UNAUTHORIZED;
  }
  return reissueDraftClaimLink(input);
}
