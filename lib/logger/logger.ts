import * as Sentry from "@sentry/nextjs";
import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";

/**
 * Keys that must never reach a log line. Contributors' identities live in
 * the database, not in Vercel logs or Sentry breadcrumbs.
 */
export const REDACT_PATHS = [
  "email",
  "recipientEmail",
  "name",
  "phone",
  "*.email",
  "*.recipientEmail",
  "*.name",
  "*.phone",
  "req.headers.cookie",
  "req.headers.authorization",
];

export interface BuildLoggerOptions {
  level?: string;
  /** Where lines go; defaults to stdout. Tests pass an in-memory stream. */
  destination?: DestinationStream;
  /** Use pino-pretty (development only; never in tests or production). */
  pretty?: boolean;
}

export function buildLogger(options: BuildLoggerOptions = {}): Logger {
  const pinoOptions: LoggerOptions = {
    level: options.level ?? "info",
    redact: { paths: REDACT_PATHS, censor: "[Redacted]" },
    base: { env: process.env.NODE_ENV },
    ...(options.pretty && {
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
      },
    }),
  };
  return options.destination ? pino(pinoOptions, options.destination) : pino(pinoOptions);
}

const isDevelopment = process.env.NODE_ENV === "development";

export const logger: Logger = buildLogger({
  level: process.env.LOG_LEVEL ?? (isDevelopment ? "debug" : "info"),
  pretty: isDevelopment,
});

/**
 * Child logger with fixed context.
 *
 * @example
 * const log = createLogger({ category: "upload" });
 * log.info({ action: "ticket", memoryId }, "ticket minted");
 */
export function createLogger(context: Record<string, unknown>): Logger {
  return logger.child(context);
}

/** Normalize a caught value into an Error, preserving real Error instances. */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Log an error with Pino and send it to Sentry.
 * For code that returns a graceful response from a Server Function, prefer
 * `logErrorAndFlush` so the event is delivered before the function freezes.
 */
export function logError(
  message: string,
  error: unknown,
  context?: Record<string, unknown>,
  tags?: Record<string, string>
): void {
  const normalized = toError(error);
  logger.error({ err: normalized, ...context }, message);
  Sentry.captureException(normalized, {
    extra: { message, ...context },
    ...(tags && { tags }),
  });
}

/**
 * `logError` followed by a bounded Sentry flush. On Vercel's Node.js runtime
 * a Server Function that returns normally may freeze before the transport
 * delivers the event; the flush (up to 2 s) makes delivery likely.
 */
export async function logErrorAndFlush(
  message: string,
  error: unknown,
  context?: Record<string, unknown>,
  tags?: Record<string, string>
): Promise<void> {
  logError(message, error, context, tags);
  try {
    const flushed = await Sentry.flush(2000);
    if (!flushed) {
      logger.warn(
        { ...context, action: "sentry_flush_timeout" },
        "Sentry flush timed out; the event may have been lost"
      );
    }
  } catch (flushError) {
    logger.warn(
      { ...context, action: "sentry_flush_error", err: toError(flushError) },
      "Sentry flush failed; the event may have been lost"
    );
  }
}
