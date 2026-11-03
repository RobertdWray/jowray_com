export type LogCategory = "api" | "upload" | "email" | "db" | "cron";

/** Fields any log line may carry. Never put an email, name or phone here unredacted. */
export interface LogContext {
  category?: LogCategory;
  action?: string;
  memoryId?: string;
  mediaId?: string;
  durationMs?: number;
  error?: string;
  [key: string]: unknown;
}
