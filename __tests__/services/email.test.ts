import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import { resetEnvCache } from "@/server/config/env";

// --- stubs -------------------------------------------------------------
const sendMock = vi.fn();
const setTimeoutMock = vi.fn();
vi.mock("@sendgrid/mail", () => ({
  default: { setApiKey: vi.fn(), setTimeout: (...args: unknown[]) => setTimeoutMock(...args), send: (...args: unknown[]) => sendMock(...args) },
}));

type EmailType = "MEMORY_CONFIRMATION" | "ADMIN_NEW_MEMORY" | "SUBMISSION_CONFIRMATION";
type Status = "PENDING" | "SENDING" | "SENT" | "FAILED" | "SKIPPED";
interface Row {
  id: string;
  memoryId: string;
  recipientEmail: string;
  recipientKey: string | null;
  emailType: EmailType;
  status: Status;
  attempts: number;
  nextAttemptAt: Date | null;
  errorMessage: string | null;
  sendgridMessageId: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
interface Where {
  recipientEmail?: string;
  recipientKey?: string;
  emailType?: EmailType | { in: EmailType[] };
  createdAt?: { gte: Date };
  updatedAt?: { gte?: Date; lt?: Date };
  status?: Status | { in: Status[] };
  errorMessage?: string | null | { notIn: string[] };
  NOT?: { memoryId?: string; id?: string };
  OR?: Where[];
}
const rows: Row[] = [];
function matches(r: Row, where: Where): boolean {
  const typeMatches = where.emailType === undefined || (typeof where.emailType === "string" ? r.emailType === where.emailType : where.emailType.in.includes(r.emailType));
  const statusMatches = where.status === undefined || (typeof where.status === "string" ? r.status === where.status : where.status.in.includes(r.status));
  return (
    (where.recipientEmail === undefined || r.recipientEmail === where.recipientEmail) &&
    (where.recipientKey === undefined || r.recipientKey === where.recipientKey) &&
    typeMatches &&
    statusMatches &&
    (!where.updatedAt?.gte || where.updatedAt.gte <= r.updatedAt) &&
    (!where.updatedAt?.lt || r.updatedAt < where.updatedAt.lt) &&
    (!where.createdAt || where.createdAt.gte <= r.createdAt) &&
    (where.errorMessage === undefined || (typeof where.errorMessage === "object" && where.errorMessage !== null ? r.errorMessage !== null && !where.errorMessage.notIn.includes(r.errorMessage) : r.errorMessage === where.errorMessage)) &&
    (!where.NOT || ((where.NOT.memoryId === undefined || r.memoryId !== where.NOT.memoryId) && (where.NOT.id === undefined || r.id !== where.NOT.id))) &&
    (!where.OR || where.OR.some((w) => matches(r, w)))
  );
}
function newRow(data: Pick<Row, "memoryId" | "recipientEmail" | "emailType" | "status"> & Partial<Row>): Row {
  return { id: `log_${rows.length + 1}`, createdAt: new Date(), updatedAt: new Date(), attempts: 0, nextAttemptAt: null, errorMessage: null, sendgridMessageId: null, sentAt: null, recipientKey: null, ...data };
}
const memoryUpdateMock = vi.fn(async (_arg: unknown) => ({}));
// Interactive transactions run one at a time, as the advisory lock serialises the real ones.
let txChain: Promise<unknown> = Promise.resolve();
const rawSql: string[] = [];
const dbStub = {
  $transaction: vi.fn((ops: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) => {
    if (typeof ops === "function") {
      const run = txChain.then(() => ops(dbStub));
      txChain = run.catch(() => undefined);
      return run;
    }
    return Promise.all(ops);
  }),
  // Renders the statement as sent: `Prisma.raw` values carry their text in `.sql`, parameters are inlined for the assertion.
  $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const render = (v: unknown) => (typeof v === "object" && v !== null && "sql" in v ? String((v as { sql: unknown }).sql) : String(v));
    rawSql.push(strings.reduce((out, str, i) => out + str + (i < values.length ? render(values[i]) : ""), ""));
    return 1;
  }),
  memory: { update: (arg: unknown) => memoryUpdateMock(arg) },
  emailLog: {
    findUnique: vi.fn(async ({ where }: { where: { memoryId_emailType: { memoryId: string; emailType: EmailType } } }) =>
      rows.find((r) => r.memoryId === where.memoryId_emailType.memoryId && r.emailType === where.memoryId_emailType.emailType) ?? null
    ),
    findFirst: vi.fn(async ({ where }: { where: Where; orderBy?: { updatedAt: "asc" } }) => [...rows].filter((r) => matches(r, where)).sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())[0] ?? null),
    count: vi.fn(async ({ where }: { where: Where }) => rows.filter((r) => matches(r, where)).length),
    create: vi.fn(async ({ data }: { data: Pick<Row, "memoryId" | "recipientEmail" | "emailType" | "status"> & { recipientKey?: string; errorMessage?: string } }) => {
      if (rows.some((r) => r.memoryId === data.memoryId && r.emailType === data.emailType)) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      const row = newRow(data);
      rows.push(row);
      return row;
    }),
    createMany: vi.fn(async ({ data, skipDuplicates }: { data: Pick<Row, "memoryId" | "recipientEmail" | "emailType" | "status"> & Partial<Row>; skipDuplicates: boolean }) => {
      if (rows.some((r) => r.memoryId === data.memoryId && r.emailType === data.emailType)) {
        if (skipDuplicates) { return { count: 0 }; }
        throw new Error("Unique constraint failed");
      }
      rows.push(newRow(data));
      return { count: 1 };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) {
        throw new Error("missing row");
      }
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Where & { id?: string; memoryId?: string }; data: Partial<Row> }) => {
      const { id, memoryId, ...rest } = where;
      const row = rows.find((r) => (id ? r.id === id : r.memoryId === memoryId) && matches(r, rest));
      if (!row) {
        return { count: 0 };
      }
      Object.assign(row, data, { updatedAt: new Date() });
      return { count: 1 };
    }),
  },
};
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));

import { ADMIN_ALERTS_PAUSED_SUBJECT, claimableWhere, HOUR_MS, RECIPIENT_DAILY_CAP, sendAdminNewMemory, sendMemoryConfirmation, sendSubmissionConfirmation, skipDelivery, suppressAdminAlertForDraftShare, TERMINAL_SKIP_REASONS } from "@/services/email";
import type { AdminNewMemoryContent, MemoryConfirmationInput, SubmissionConfirmationInput } from "@/services/email/types";

const base: MemoryConfirmationInput = {
  memoryId: "mem_1",
  to: "person@example.com",
  hasWords: true,
  media: [],
  claimLink: "https://www.jowray.com/m/token",
};

const ENV_KEYS = ["OUTBOUND_HOURLY_CAP", "OUTBOUND_DAILY_CAP", "ADMIN_ALERT_HOURLY_CAP"] as const;

beforeEach(() => {
  rows.length = 0;
  rawSql.length = 0;
  dbStub.$executeRaw.mockClear();
  sendMock.mockReset();
  sendMock.mockResolvedValue([{ statusCode: 202, headers: { "x-message-id": "msg-1" } }, {}]);
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  process.env.SENDGRID_API_KEY = "SG.test";
  process.env.SENDGRID_FROM_EMAIL = "memories@jowray.com";
  process.env.OUTBOUND_ENABLED = "false";
  process.env.OUTBOUND_ALLOWLIST = "person@example.com, Other@Example.org";
  process.env.CONSENT_VERSION = "2026-11-v1";
  process.env.ADMIN_ALERT_EMAILS = "robwray@gmail.com, rjwray@hotmail.com";
  resetEnvCache();
});

const adminContent: AdminNewMemoryContent = {
  memoryId: "mem_1",
  submittedAt: new Date("2026-11-03T19:38:00Z"),
  name: "Jo Contributor",
  relationship: "neighbour",
  email: "person@example.com",
  contactOptIn: true,
  mailingListOptIn: false,
  notifyWhenPosted: true,
  approxDateText: "Summer 1998",
  place: "the lake",
  note: "She once taught me to quilt.",
  visibility: "FAMILY",
  media: [],
  filesNotReady: 0,
};
function adminRow(memoryId = "mem_1") {
  return rows.find((r) => r.memoryId === memoryId && r.emailType === "ADMIN_NEW_MEMORY");
}
function confirmationRow(memoryId = "mem_1") {
  return rows.find((r) => r.memoryId === memoryId && r.emailType === "MEMORY_CONFIRMATION");
}
/** Move every counted row this far into the past, as if the window had moved on. */
function age(ms: number) {
  for (const r of rows) {
    r.updatedAt = new Date(r.updatedAt.getTime() - ms);
  }
}
function lastMessage() {
  return sendMock.mock.calls.at(-1)?.[0] as { to: unknown; from: string; subject: string; html: string; text: string };
}

describe("sendMemoryConfirmation", () => {
  it("sends once and records SENT with the message id", async () => {
    const first = await sendMemoryConfirmation(base);
    expect(first).toEqual({ sent: true, messageId: "msg-1" });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(rows[0]?.status).toBe("SENT");
    expect(rows[0]?.sendgridMessageId).toBe("msg-1");

    const second = await sendMemoryConfirmation(base);
    expect(second).toEqual({ sent: false, skipped: "already_sent" });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("bounds the lock wait, then takes the outbound lock, inside the decision transaction and before any row is written (#7)", async () => {
    await sendMemoryConfirmation(base);
    expect(rawSql).toEqual(["SET LOCAL lock_timeout = '3s'", "SELECT pg_advisory_xact_lock(2026110546::bigint)"]);
    const lockCall = dbStub.$executeRaw.mock.invocationCallOrder[1]!;
    const createCall = dbStub.emailLog.create.mock.invocationCallOrder[0]!;
    expect(lockCall).toBeLessThan(createCall);
    expect(sendMock.mock.invocationCallOrder[0]!).toBeGreaterThan(createCall);
  });

  it("answers `busy` without a row when the lock wait runs out, so the cron's catch-up finds the send and nothing is lost (#3, #7)", async () => {
    // The shape Prisma 7 + @prisma/adapter-neon produce: P2010 wrapping the adapter's DriverAdapterError, whose `cause` carries the SQLSTATE.
    const driverAdapterError = Object.assign(new Error("canceling statement due to lock timeout"), {
      name: "DriverAdapterError",
      cause: { kind: "postgres", code: "55P03", severity: "ERROR", message: "canceling statement due to lock timeout", originalCode: "55P03", originalMessage: "canceling statement due to lock timeout" },
    });
    dbStub.$executeRaw.mockRejectedValueOnce(Object.assign(new Error("Raw query failed. Code: `55P03`. Message: `canceling statement due to lock timeout`"), { name: "PrismaClientKnownRequestError", code: "P2010", meta: { driverAdapterError } }));
    expect(await sendMemoryConfirmation(base)).toEqual({ sent: false, skipped: "busy" });
    // The older shape (SQLSTATE in meta.code) is still recognised.
    dbStub.$executeRaw.mockRejectedValueOnce(Object.assign(new Error("lock timeout"), { code: "P2010", meta: { code: "55P03" } }));
    expect(await sendMemoryConfirmation(base)).toEqual({ sent: false, skipped: "busy" });
    expect(rows).toHaveLength(0);
    expect(sendMock).not.toHaveBeenCalled();
    // Any other decision failure is reported and answered as failed, never thrown at the caller.
    dbStub.$executeRaw.mockRejectedValueOnce(new Error("connection reset"));
    expect(await sendMemoryConfirmation(base)).toMatchObject({ sent: false, skipped: "failed", error: expect.stringMatching(/connection reset/) });
    expect(rows).toHaveLength(0);
    // And the same send goes out normally afterwards.
    expect(await sendMemoryConfirmation(base)).toEqual({ sent: true, messageId: "msg-1" });
  });

  it("marks FAILED with attempts and nextAttemptAt when SendGrid fails", async () => {
    const err = Object.assign(new Error("boom"), { code: 500 });
    sendMock.mockRejectedValue(err);
    const result = await sendMemoryConfirmation(base);
    expect(result).toMatchObject({ sent: false, skipped: "failed", error: expect.stringMatching(/boom/) });
    expect(rows[0]?.status).toBe("FAILED");
    expect(rows[0]?.attempts).toBe(1);
    expect(rows[0]?.nextAttemptAt).toBeInstanceOf(Date);
    expect(rows[0]!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    // retried inline 3 times with linear backoff before giving up
    expect(sendMock).toHaveBeenCalledTimes(3);
  }, 15_000);

  it("does not retry non-retryable 4xx errors", async () => {
    sendMock.mockRejectedValue(Object.assign(new Error("bad"), { code: 401 }));
    await sendMemoryConfirmation(base);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(rows[0]?.status).toBe("FAILED");
  });

  it("skips a non-allowlisted recipient when outbound is disabled and records a terminal SKIPPED row", async () => {
    const result = await sendMemoryConfirmation({ ...base, to: "stranger@example.net" });
    expect(result).toEqual({ sent: false, skipped: "outbound_disabled" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "SKIPPED", errorMessage: "outbound_disabled" });
    expect(sendMock).not.toHaveBeenCalled();
    // and a second call is still a skip, not a resend attempt
    expect(await sendMemoryConfirmation({ ...base, to: "stranger@example.net" })).toEqual({ sent: false, skipped: "outbound_disabled" });
  });

  it("claims the row atomically so two concurrent sends produce one email", async () => {
    const [a, b] = await Promise.all([sendMemoryConfirmation(base), sendMemoryConfirmation(base)]);
    expect([a, b].filter((r) => r.sent)).toHaveLength(1);
    // The loser waits on the lock; by the time it decides, the winner is either still at SendGrid (in_progress) or done (already_sent).
    expect([a, b].filter((r) => !r.sent && (r.skipped === "in_progress" || r.skipped === "already_sent"))).toHaveLength(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("does not mark a delivered email FAILED when the SENT bookkeeping throws", async () => {
    dbStub.emailLog.update.mockRejectedValueOnce(new Error("db hiccup"));
    const result = await sendMemoryConfirmation(base);
    expect(result).toEqual({ sent: true, messageId: "msg-1" });
    expect(rows[0]?.status).not.toBe("FAILED");
  });

  it("sends to anyone when OUTBOUND_ENABLED is true", async () => {
    process.env.OUTBOUND_ENABLED = "true";
    resetEnvCache();
    const result = await sendMemoryConfirmation({ ...base, to: "stranger@example.net" });
    expect(result.sent).toBe(true);
  });

  it("does not count FAILED rows against the recipient cap, so retries are never locked out", async () => {
    for (let i = 1; i <= 3; i += 1) {
      rows.push(newRow({ id: `f_${i}`, memoryId: `mem_f${i}`, recipientEmail: base.to, recipientKey: base.to, emailType: "MEMORY_CONFIRMATION", status: "FAILED", attempts: 1, nextAttemptAt: new Date(), errorMessage: "x" }));
    }
    expect((await sendMemoryConfirmation({ ...base, memoryId: "mem_new" })).sent).toBe(true);
  });

  it("caps at fifteen confirmations per address per day (D15)", async () => {
    for (let i = 1; i <= 15; i += 1) {
      const r = await sendMemoryConfirmation({ ...base, memoryId: `mem_${i}` });
      expect(r.sent).toBe(true);
    }
    const sixteenth = await sendMemoryConfirmation({ ...base, memoryId: "mem_16" });
    expect(sixteenth).toEqual({ sent: false, skipped: "recipient_capped" });
    expect(sendMock).toHaveBeenCalledTimes(15);
    expect(rows.find((r) => r.memoryId === "mem_16")).toMatchObject({ status: "SKIPPED", errorMessage: "recipient_capped" });
  });

  it("counts +tag aliases and Gmail dot variants as one inbox for the per-recipient cap (issue #46, D3)", async () => {
    process.env.OUTBOUND_ENABLED = "true";
    resetEnvCache();
    for (let i = 1; i <= RECIPIENT_DAILY_CAP; i += 1) {
      expect((await sendMemoryConfirmation({ ...base, memoryId: `mem_${i}`, to: `Person+${i}@Example.com` })).sent).toBe(true);
    }
    const alias = await sendMemoryConfirmation({ ...base, memoryId: "mem_alias", to: "person+another@example.com" });
    expect(alias).toEqual({ sent: false, skipped: "recipient_capped" });
    // The stored and sent address is the one given (lower-cased); only the cap key is folded.
    expect(rows[0]).toMatchObject({ recipientEmail: "person+1@example.com", recipientKey: "person@example.com" });
    expect((sendMock.mock.calls[0]?.[0] as { to: string[] }).to).toEqual(["person+1@example.com"]);
    // A different inbox at the same domain is not capped by them.
    expect((await sendMemoryConfirmation({ ...base, memoryId: "mem_other", to: "someone.else@example.com" })).sent).toBe(true);

    rows.length = 0;
    sendMock.mockClear();
    for (let i = 1; i <= RECIPIENT_DAILY_CAP; i += 1) {
      expect((await sendMemoryConfirmation({ ...base, memoryId: `g_${i}`, to: `f.i.r.s.t+${i}@gmail.com` })).sent).toBe(true);
    }
    expect(await sendMemoryConfirmation({ ...base, memoryId: "g_dots", to: "first@googlemail.com" })).toEqual({ sent: false, skipped: "recipient_capped" });
    expect(await sendMemoryConfirmation({ ...base, memoryId: "g_more", to: "fir.st@gmail.com" })).toEqual({ sent: false, skipped: "recipient_capped" });
    expect(rows.find((r) => r.memoryId === "g_dots")?.recipientKey).toBe("first@gmail.com");
  });

  it("keeps the subject fixed and carries only fixed copy, kind labels and the link", async () => {
    await sendMemoryConfirmation({ ...base, media: [{ kind: "VOICE", durationSeconds: 134 }] });
    const msg = lastMessage();
    expect(msg.subject).toBe("Thank you for sharing a memory");
    expect(msg.text).toContain("What you sent: your words and a voice recording");
    expect(msg.text).toContain(base.claimLink);
    expect(msg.html).toContain("Thank you.");
  });
});

describe("global outbound ceilings for contributor email (issue #46, D2)", () => {
  beforeEach(() => {
    process.env.OUTBOUND_ENABLED = "true";
    resetEnvCache();
  });

  it("holds the send past the hourly ceiling as a retryable FAILED row, attempts untouched, due when the oldest counted row leaves the hour", async () => {
    process.env.OUTBOUND_HOURLY_CAP = "3";
    resetEnvCache();
    const before = Date.now();
    for (let i = 1; i <= 3; i += 1) {
      expect((await sendMemoryConfirmation({ ...base, memoryId: `mem_${i}`, to: `person${i}@example.net` })).sent).toBe(true);
    }
    const fourth = await sendMemoryConfirmation({ ...base, memoryId: "mem_4", to: "person4@example.net" });
    expect(fourth).toEqual({ sent: false, skipped: "global_capped" });
    expect(sendMock).toHaveBeenCalledTimes(3);
    const held = confirmationRow("mem_4")!;
    expect(held).toMatchObject({ status: "FAILED", attempts: 0, errorMessage: "global_capped", recipientEmail: "person4@example.net", recipientKey: "person4@example.net" });
    expect(held.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(before + HOUR_MS);
    expect(held.nextAttemptAt!.getTime()).toBeLessThan(Date.now() + HOUR_MS + 2 * 60_000);
    // Admin alerts are not contributor email: they are unaffected by this ceiling.
    expect((await sendAdminNewMemory({ ...adminContent, memoryId: "mem_4" })).sent).toBe(true);
    // Once the hour has moved on, the same call sends the held receipt.
    age(HOUR_MS + 1);
    expect(await sendMemoryConfirmation({ ...base, memoryId: "mem_4", to: "person4@example.net" })).toEqual({ sent: true, messageId: "msg-1" });
    expect(confirmationRow("mem_4")?.status).toBe("SENT");
  });

  it("applies the daily ceiling too, and counts send receipts and confirmations together", async () => {
    process.env.OUTBOUND_HOURLY_CAP = "100";
    process.env.OUTBOUND_DAILY_CAP = "2";
    resetEnvCache();
    const send: SubmissionConfirmationInput = {
      anchorMemoryId: "anchor_1",
      to: "person1@example.net",
      memories: [
        { position: 1, hasWords: true, media: [], claimLink: "https://www.jowray.com/m/aaaa", missingFiles: 0 },
        { position: 2, hasWords: false, media: [], claimLink: "https://www.jowray.com/m/bbbb", missingFiles: 0 },
      ],
    };
    expect((await sendSubmissionConfirmation(send)).sent).toBe(true);
    expect((await sendMemoryConfirmation({ ...base, memoryId: "mem_2", to: "person2@example.net" })).sent).toBe(true);
    const third = await sendSubmissionConfirmation({ ...send, anchorMemoryId: "anchor_3", to: "person3@example.net" });
    expect(third).toEqual({ sent: false, skipped: "global_capped" });
    const held = rows.find((r) => r.memoryId === "anchor_3")!;
    expect(held.status).toBe("FAILED");
    expect(held.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(Date.now() + 24 * HOUR_MS - 60_000);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("decides one at a time: two concurrent sends at the last free slot yield exactly one email", async () => {
    process.env.OUTBOUND_HOURLY_CAP = "1";
    resetEnvCache();
    const [a, b] = await Promise.all([
      sendMemoryConfirmation({ ...base, memoryId: "mem_a", to: "a@example.net" }),
      sendMemoryConfirmation({ ...base, memoryId: "mem_b", to: "b@example.net" }),
    ]);
    expect([a, b].filter((r) => r.sent)).toHaveLength(1);
    expect([a, b].filter((r) => !r.sent && r.skipped === "global_capped")).toHaveLength(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("counts the other confirmation type on the same anchor: only this row is left out of its own count (#8)", async () => {
    process.env.OUTBOUND_HOURLY_CAP = "1";
    resetEnvCache();
    const send: SubmissionConfirmationInput = { anchorMemoryId: "mem_anchor", to: "a@example.net", memories: [{ position: 1, hasWords: true, media: [], claimLink: "https://www.jowray.com/m/aaaa", missingFiles: 0 }] };
    expect((await sendSubmissionConfirmation(send)).sent).toBe(true);
    expect(await sendMemoryConfirmation({ ...base, memoryId: "mem_anchor", to: "a@example.net" })).toEqual({ sent: false, skipped: "global_capped" });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("uses the defaults (60 an hour, 300 a day) when the keys are unset: a memorial afternoon of 30 relatives never holds a receipt", async () => {
    for (let i = 1; i <= 60; i += 1) {
      expect((await sendMemoryConfirmation({ ...base, memoryId: `mem_${i}`, to: `p${i}@example.net` })).sent).toBe(true);
    }
    expect(await sendMemoryConfirmation({ ...base, memoryId: "mem_61", to: "p61@example.net" })).toEqual({ sent: false, skipped: "global_capped" });
  });

  it("a malformed cap value in the environment falls back to the default instead of stopping every receipt", async () => {
    process.env.OUTBOUND_HOURLY_CAP = "abc";
    process.env.OUTBOUND_DAILY_CAP = "0";
    resetEnvCache();
    expect((await sendMemoryConfirmation({ ...base, memoryId: "mem_ok", to: "ok@example.net" })).sent).toBe(true);
  });
});

describe("sendAdminNewMemory", () => {
  beforeEach(() => {
    process.env.OUTBOUND_ENABLED = "true";
    resetEnvCache();
  });

  it("sends one message to every configured admin and records the attempted set on an ADMIN_NEW_MEMORY row", async () => {
    const result = await sendAdminNewMemory(adminContent);
    expect(result).toEqual({ sent: true, messageId: "msg-1" });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const msg = lastMessage();
    expect(msg.to).toEqual(["robwray@gmail.com", "rjwray@hotmail.com"]);
    expect(msg.subject).toBe("New memory from Jo Contributor");
    expect(msg.html).not.toContain("href=");
    expect(adminRow()).toMatchObject({ status: "SENT", recipientEmail: "robwray@gmail.com, rjwray@hotmail.com", recipientKey: "robwray@gmail.com, rjwray@hotmail.com", sendgridMessageId: "msg-1" });
    expect(confirmationRow()).toBeUndefined();
  });

  it("is idempotent per memory and claims atomically under concurrency", async () => {
    expect((await sendAdminNewMemory(adminContent)).sent).toBe(true);
    expect(await sendAdminNewMemory(adminContent)).toEqual({ sent: false, skipped: "already_sent" });
    rows.length = 0;
    sendMock.mockClear();
    const [a, b] = await Promise.all([sendAdminNewMemory(adminContent), sendAdminNewMemory(adminContent)]);
    expect([a, b].filter((r) => r.sent)).toHaveLength(1);
    expect([a, b].filter((r) => !r.sent && (r.skipped === "in_progress" || r.skipped === "already_sent"))).toHaveLength(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("has no daily cap: a fourth memory in a day still alerts", async () => {
    for (let i = 1; i <= 4; i += 1) {
      expect((await sendAdminNewMemory({ ...adminContent, memoryId: `mem_${i}` })).sent).toBe(true);
    }
    expect(sendMock).toHaveBeenCalledTimes(4);
  });

  it("past the hourly cap it sends one fixed pause notice, then skips with a row per memory until the hour moves on (issue #46, D4)", async () => {
    process.env.ADMIN_ALERT_HOURLY_CAP = "2";
    resetEnvCache();
    expect((await sendAdminNewMemory({ ...adminContent, memoryId: "mem_1" })).sent).toBe(true);
    expect((await sendAdminNewMemory({ ...adminContent, memoryId: "mem_2" })).sent).toBe(true);
    expect(lastMessage().subject).toBe("New memory from Jo Contributor");
    // The third alert of the hour is the notice: fixed content, no links, no contributor text.
    expect((await sendAdminNewMemory({ ...adminContent, memoryId: "mem_3" })).sent).toBe(true);
    const notice = lastMessage();
    expect(notice.subject).toBe(ADMIN_ALERTS_PAUSED_SUBJECT);
    expect(notice.to).toEqual(["robwray@gmail.com", "rjwray@hotmail.com"]);
    expect(notice.html).not.toContain("href=");
    expect(notice.html).not.toContain("Jo Contributor");
    expect(notice.text).toContain("More than 2 new memories arrived in the last hour");
    expect(adminRow("mem_3")?.status).toBe("SENT");
    // The fourth and later are skipped, each with its own terminal row, so the cron does not re-alert them.
    expect(await sendAdminNewMemory({ ...adminContent, memoryId: "mem_4" })).toEqual({ sent: false, skipped: "admin_capped" });
    expect(await sendAdminNewMemory({ ...adminContent, memoryId: "mem_5" })).toEqual({ sent: false, skipped: "admin_capped" });
    expect(adminRow("mem_4")).toMatchObject({ status: "SKIPPED", errorMessage: "admin_capped" });
    expect(adminRow("mem_5")).toMatchObject({ status: "SKIPPED", errorMessage: "admin_capped" });
    expect(sendMock).toHaveBeenCalledTimes(3);
    // Contributor email is a separate budget.
    expect((await sendMemoryConfirmation({ ...base, memoryId: "mem_6" })).sent).toBe(true);
    // An hour later the alerts resume as normal alerts.
    age(HOUR_MS + 1);
    expect((await sendAdminNewMemory({ ...adminContent, memoryId: "mem_7" })).sent).toBe(true);
    expect(lastMessage().subject).toBe("New memory from Jo Contributor");
  });

  it("with staggered arrivals the notice goes once per hour, later alerts that hour skip, and normal alerts resume on their own (#1, #9)", async () => {
    process.env.ADMIN_ALERT_HOURLY_CAP = "2";
    resetEnvCache();
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
    expect((await sendAdminNewMemory({ ...adminContent, memoryId: "mem_1" })).sent).toBe(true);
    expect((await sendAdminNewMemory({ ...adminContent, memoryId: "mem_2" })).sent).toBe(true);
    adminRow("mem_1")!.updatedAt = minutesAgo(50);
    adminRow("mem_2")!.updatedAt = minutesAgo(40);
    expect((await sendAdminNewMemory({ ...adminContent, memoryId: "mem_3" })).sent).toBe(true);
    expect(lastMessage().subject).toBe(ADMIN_ALERTS_PAUSED_SUBJECT);
    // The first alert leaves the hour; the count of normal alerts is back at the cap, but the notice is still within the hour: skip, no second notice.
    adminRow("mem_1")!.updatedAt = minutesAgo(61);
    expect(await sendAdminNewMemory({ ...adminContent, memoryId: "mem_4" })).toEqual({ sent: false, skipped: "admin_capped" });
    adminRow("mem_2")!.updatedAt = minutesAgo(61);
    expect(await sendAdminNewMemory({ ...adminContent, memoryId: "mem_5" })).toEqual({ sent: false, skipped: "admin_capped" });
    expect(sendMock).toHaveBeenCalledTimes(3);
    // Once the notice itself is an hour old, a normal alert goes again.
    adminRow("mem_3")!.updatedAt = minutesAgo(61);
    expect((await sendAdminNewMemory({ ...adminContent, memoryId: "mem_6" })).sent).toBe(true);
    expect(lastMessage().subject).toBe("New memory from Jo Contributor");
    // The notice row is told apart from the alerts it replaced, so the cron and the admin page can see what happened.
    expect(adminRow("mem_3")).toMatchObject({ status: "SENT", errorMessage: "admin_paused" });
    expect(adminRow("mem_6")).toMatchObject({ status: "SENT", errorMessage: null });
  });

  it("writes no row at all when ADMIN_ALERT_EMAILS is empty, so the cron can alert once it is set", async () => {
    process.env.ADMIN_ALERT_EMAILS = "";
    resetEnvCache();
    expect(await sendAdminNewMemory(adminContent)).toEqual({ sent: false, skipped: "no_recipients" });
    expect(rows).toHaveLength(0);
    expect(sendMock).not.toHaveBeenCalled();
    delete process.env.ADMIN_ALERT_EMAILS;
    resetEnvCache();
    expect(await sendAdminNewMemory(adminContent)).toEqual({ sent: false, skipped: "no_recipients" });
    expect(rows).toHaveLength(0);
  });

  it("sends only to allowlisted admins when outbound is disabled, and records that subset", async () => {
    process.env.OUTBOUND_ENABLED = "false";
    process.env.OUTBOUND_ALLOWLIST = "robwray@gmail.com";
    resetEnvCache();
    expect((await sendAdminNewMemory(adminContent)).sent).toBe(true);
    expect(lastMessage().to).toEqual(["robwray@gmail.com"]);
    expect(adminRow()?.recipientEmail).toBe("robwray@gmail.com");
  });

  it("skips with a terminal SKIPPED row when no admin is allowlisted and outbound is disabled", async () => {
    process.env.OUTBOUND_ENABLED = "false";
    process.env.OUTBOUND_ALLOWLIST = "person@example.com";
    resetEnvCache();
    expect(await sendAdminNewMemory(adminContent)).toEqual({ sent: false, skipped: "outbound_disabled" });
    expect(adminRow()).toMatchObject({ status: "SKIPPED", errorMessage: "outbound_disabled" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("marks FAILED with attempts and nextAttemptAt when SendGrid fails", async () => {
    sendMock.mockRejectedValue(Object.assign(new Error("bad"), { code: 401 }));
    const result = await sendAdminNewMemory(adminContent);
    expect(result).toMatchObject({ sent: false, skipped: "failed" });
    expect(adminRow()).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(adminRow()?.nextAttemptAt).toBeInstanceOf(Date);
  });

  it("never touches the memory's claim hash", async () => {
    memoryUpdateMock.mockClear();
    await sendAdminNewMemory(adminContent);
    expect(memoryUpdateMock).not.toHaveBeenCalled();
    expect(dbStub.$transaction).not.toHaveBeenCalledWith(expect.arrayContaining([expect.anything(), expect.anything()]));
  });

  it("a render error leaves no SENDING row behind (rendering happens before the claim)", async () => {
    const bad = { ...adminContent, media: [{ kind: "PHOTO" as const, originalFilename: "x.jpg", durationSeconds: null, preview: { contentId: "bad id<", contentBase64: "aGVhcnQ=", width: 10, height: 10 } }] };
    await expect(sendAdminNewMemory(bad)).rejects.toThrow(/content id/i);
    expect(rows.filter((r) => r.status === "SENDING")).toHaveLength(0);
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("two email types on one memory", () => {
  beforeEach(() => {
    process.env.OUTBOUND_ENABLED = "true";
    resetEnvCache();
  });

  it("confirmation then admin, and admin then confirmation, each produce their own SENT row", async () => {
    expect((await sendMemoryConfirmation(base)).sent).toBe(true);
    expect((await sendAdminNewMemory(adminContent)).sent).toBe(true);
    expect(confirmationRow()?.status).toBe("SENT");
    expect(adminRow()?.status).toBe("SENT");
    rows.length = 0;
    sendMock.mockClear();
    expect((await sendAdminNewMemory(adminContent)).sent).toBe(true);
    expect((await sendMemoryConfirmation(base)).sent).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(2);
  });

  it("concurrently: both send exactly once", async () => {
    const [a, b] = await Promise.all([sendMemoryConfirmation(base), sendAdminNewMemory(adminContent)]);
    expect(a.sent && b.sent).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("one type failing or skipping never changes the other", async () => {
    sendMock.mockRejectedValueOnce(Object.assign(new Error("bad"), { code: 401 }));
    expect((await sendMemoryConfirmation(base)).sent).toBe(false);
    expect((await sendAdminNewMemory(adminContent)).sent).toBe(true);
    expect(confirmationRow()?.status).toBe("FAILED");
    expect(adminRow()?.status).toBe("SENT");
  });

  it("admin rows never count toward a contributor's daily cap, even when the addresses overlap", async () => {
    process.env.OUTBOUND_ENABLED = "false";
    process.env.OUTBOUND_ALLOWLIST = "robwray@gmail.com";
    process.env.ADMIN_ALERT_EMAILS = "robwray@gmail.com";
    resetEnvCache();
    for (let i = 1; i <= 3; i += 1) {
      expect((await sendAdminNewMemory({ ...adminContent, memoryId: `mem_${i}` })).sent).toBe(true);
    }
    expect((await sendMemoryConfirmation({ ...base, memoryId: "mem_4", to: "robwray@gmail.com" })).sent).toBe(true);
  });
});

describe("replies: memories@jowray.com is forwarded by Cloudflare Email Routing", () => {
  beforeEach(() => {
    process.env.OUTBOUND_ENABLED = "true";
    resetEnvCache();
  });

  // A freemail Reply-To on a jowray.com From costs about 2 SpamAssassin points
  // (FREEMAIL_FORGED_REPLYTO); the From address now receives mail, so none is set.
  function expectFromWithoutReplyTo() {
    const msg = sendMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(msg.from).toBe("memories@jowray.com");
    // Every way the SendGrid helper can carry one: the field, the list form and a raw header.
    expect(msg).not.toHaveProperty("replyTo");
    expect(msg).not.toHaveProperty("replyToList");
    expect(Object.keys((msg.headers ?? {}) as Record<string, unknown>).map((k) => k.toLowerCase())).not.toContain("reply-to");
  }

  it("every email type is From the sending address and sets no Reply-To, so a reader's Reply goes to the forwarded address", async () => {
    expect((await sendMemoryConfirmation(base)).sent).toBe(true);
    expectFromWithoutReplyTo();

    const receipt: SubmissionConfirmationInput = {
      anchorMemoryId: "mem_anchor",
      to: "person@example.com",
      memories: [{ position: 1, hasWords: true, media: [], claimLink: "https://www.jowray.com/m/aaaa", missingFiles: 0 }],
    };
    expect((await sendSubmissionConfirmation(receipt)).sent).toBe(true);
    expectFromWithoutReplyTo();

    expect((await sendAdminNewMemory(adminContent)).sent).toBe(true);
    expectFromWithoutReplyTo();
    expect(sendMock).toHaveBeenCalledTimes(3);
  });
});

describe("transport attachments", () => {
  it("sends inline attachments with a content id and keeps tracking off", async () => {
    const { SendGridTransport } = await import("@/integrations/sendgrid");
    await new SendGridTransport().send({
      to: base.to,
      from: "memories@jowray.com",
      subject: "s",
      text: "t",
      html: '<img src="cid:brand-heart">',
      attachments: [{ filename: "heart.png", contentType: "image/png", contentBase64: "aGVhcnQ=", contentId: "brand-heart" }],
    });
    const msg = sendMock.mock.calls[0]?.[0] as { attachments?: unknown[]; trackingSettings: { openTracking: { enable: boolean }; clickTracking: { enable: boolean } } };
    // `content_id` is the v3 API field name; SendGrid answers 400 "content_id parameter is required if disposition = 'inline'" to `contentId`.
    expect(msg.attachments).toEqual([{ content: "aGVhcnQ=", filename: "heart.png", type: "image/png", disposition: "inline", content_id: "brand-heart" }]);
    expect(msg.trackingSettings.openTracking.enable).toBe(false);
    expect(msg.trackingSettings.clickTracking.enable).toBe(false);
  });

  it("refuses an attachment whose content id or filename breaks the MIME contract", async () => {
    const { SendGridTransport } = await import("@/integrations/sendgrid");
    const message = { to: base.to, from: "memories@jowray.com", subject: "s", text: "t", html: "" };
    await expect(new SendGridTransport().send({ ...message, attachments: [{ filename: "heart.png", contentType: "image/png", contentBase64: "aGVhcnQ=", contentId: "bad id<" }] })).rejects.toThrow(/content id/i);
    await expect(new SendGridTransport().send({ ...message, attachments: [{ filename: "../heart.png\r\n", contentType: "image/png", contentBase64: "aGVhcnQ=", contentId: "ok" }] })).rejects.toThrow(/filename/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("omits the attachments field when a message has none", async () => {
    const { SendGridTransport } = await import("@/integrations/sendgrid");
    await new SendGridTransport().send({ to: base.to, from: "memories@jowray.com", subject: "s", text: "t", html: "<p>t</p>" });
    const msg = sendMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect("attachments" in msg).toBe(false);
  });

  it("passes an array of recipients through as one message", async () => {
    const { SendGridTransport } = await import("@/integrations/sendgrid");
    await new SendGridTransport().send({ to: ["a@example.com", "b@example.org"], from: "memories@jowray.com", subject: "s", text: "t", html: "<p>t</p>" });
    const msg = sendMock.mock.calls[0]?.[0] as { to: unknown };
    expect(msg.to).toEqual(["a@example.com", "b@example.org"]);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("applies the request timeout together with the API key, once per key", async () => {
    // Fresh module state: `configuredKey` lives in the client module, so earlier tests in this file already configured it.
    vi.resetModules();
    setTimeoutMock.mockClear();
    const { getSendGridClient, SENDGRID_REQUEST_TIMEOUT_MS } = await import("@/integrations/sendgrid/client");
    getSendGridClient();
    getSendGridClient();
    expect(SENDGRID_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    expect(SENDGRID_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
    expect(setTimeoutMock).toHaveBeenCalledTimes(1);
    expect(setTimeoutMock).toHaveBeenCalledWith(SENDGRID_REQUEST_TIMEOUT_MS);
  });
});

describe("transport error hygiene", () => {
  it("records a status-coded message and never logs the SendGrid response body", async () => {
    const err = Object.assign(new Error("Bad Request"), { code: 400, response: { body: { errors: [{ message: "The recipient person@example.com is invalid" }] } } });
    sendMock.mockRejectedValue(err);
    const result = await sendMemoryConfirmation(base);
    expect(result.sent).toBe(false);
    expect(rows[0]?.status).toBe("FAILED");
    expect(rows[0]?.errorMessage).toMatch(/^SendGrid 400/);
    expect(rows[0]?.errorMessage).not.toContain("person@example.com");
    expect(result.sent === false && result.error).not.toContain("person@example.com");
  });

  it("does not retry deterministic 4xx responses other than 408 and 429", async () => {
    sendMock.mockRejectedValue(Object.assign(new Error("Payload Too Large"), { code: 413 }));
    await sendMemoryConfirmation(base);
    expect(sendMock).toHaveBeenCalledTimes(1);
    sendMock.mockClear(); rows.length = 0;
    sendMock.mockRejectedValue(Object.assign(new Error("Too Many Requests"), { code: 429 }));
    await sendMemoryConfirmation(base);
    expect(sendMock).toHaveBeenCalledTimes(3);
  }, 15_000);
});

describe("stranded and racing rows", () => {
  it("reclaims a SENDING row that has been stuck for more than 15 minutes", async () => {
    rows.push(newRow({ id: "stuck", memoryId: base.memoryId, recipientEmail: base.to, recipientKey: base.to, emailType: "MEMORY_CONFIRMATION", status: "SENDING", createdAt: new Date(Date.now() - 20 * 60_000), updatedAt: new Date(Date.now() - 20 * 60_000) }));
    expect((await sendMemoryConfirmation(base)).sent).toBe(true);
    expect(rows[0]?.status).toBe("SENT");
  });

  it("does not reclaim a SENDING row that is fresh", async () => {
    rows.push(newRow({ id: "fresh", memoryId: base.memoryId, recipientEmail: base.to, recipientKey: base.to, emailType: "MEMORY_CONFIRMATION", status: "SENDING" }));
    expect(await sendMemoryConfirmation(base)).toEqual({ sent: false, skipped: "in_progress" });
  });

  it("a skip never overwrites a row that is SENDING or SENT: a live claim answers in_progress, a SENT row already_sent", async () => {
    rows.push(newRow({ id: "sending", memoryId: "mem_x", recipientEmail: "stranger@example.net", recipientKey: "stranger@example.net", emailType: "MEMORY_CONFIRMATION", status: "SENDING" }));
    expect(await sendMemoryConfirmation({ ...base, memoryId: "mem_x", to: "stranger@example.net" })).toEqual({ sent: false, skipped: "in_progress" });
    expect(rows[0]?.status).toBe("SENDING");
    rows[0]!.status = "SENT";
    expect(await sendMemoryConfirmation({ ...base, memoryId: "mem_x", to: "stranger@example.net" })).toEqual({ sent: false, skipped: "already_sent" });
    expect(rows[0]?.status).toBe("SENT");
  });

  it("a fresh SENDING row by another sender counts toward the caps; a stale one does not (#2)", async () => {
    process.env.OUTBOUND_ENABLED = "true";
    process.env.OUTBOUND_HOURLY_CAP = "1";
    resetEnvCache();
    rows.push(newRow({ id: "inflight", memoryId: "mem_other", recipientEmail: "o@example.net", recipientKey: "o@example.net", emailType: "MEMORY_CONFIRMATION", status: "SENDING" }));
    expect(await sendMemoryConfirmation({ ...base, memoryId: "mem_me", to: "me@example.net" })).toEqual({ sent: false, skipped: "global_capped" });
    rows[0]!.updatedAt = new Date(Date.now() - 16 * 60_000);
    expect(await sendMemoryConfirmation({ ...base, memoryId: "mem_me", to: "me@example.net" })).toEqual({ sent: true, messageId: "msg-1" });
  });

  it("a fresh SENDING row for the same delivery answers in_progress before any cap can misreport it (#2)", async () => {
    process.env.OUTBOUND_ENABLED = "true";
    process.env.OUTBOUND_HOURLY_CAP = "1";
    resetEnvCache();
    rows.push(newRow({ id: "mine", memoryId: base.memoryId, recipientEmail: base.to, recipientKey: base.to, emailType: "MEMORY_CONFIRMATION", status: "SENDING" }));
    rows.push(newRow({ id: "other", memoryId: "mem_other", recipientEmail: "o@example.net", recipientKey: "o@example.net", emailType: "MEMORY_CONFIRMATION", status: "SENT" }));
    expect(await sendMemoryConfirmation(base)).toEqual({ sent: false, skipped: "in_progress" });
    expect(rows[0]?.status).toBe("SENDING");
    expect(await skipDelivery({ memoryId: base.memoryId, emailType: "MEMORY_CONFIRMATION", reason: "nothing_to_send" })).toEqual({ sent: false, skipped: "in_progress" });
  });

  it("a stale SENDING row is moved on by a skip, a global-cap hold and skipDelivery, never left stuck (#2)", async () => {
    const stale = () => new Date(Date.now() - 16 * 60_000);
    rows.push(newRow({ id: "s1", memoryId: "mem_s1", recipientEmail: "stranger@example.net", recipientKey: "stranger@example.net", emailType: "MEMORY_CONFIRMATION", status: "SENDING", updatedAt: stale() }));
    expect(await sendMemoryConfirmation({ ...base, memoryId: "mem_s1", to: "stranger@example.net" })).toEqual({ sent: false, skipped: "outbound_disabled" });
    expect(rows[0]).toMatchObject({ status: "SKIPPED", errorMessage: "outbound_disabled" });

    process.env.OUTBOUND_ENABLED = "true";
    process.env.OUTBOUND_HOURLY_CAP = "1";
    resetEnvCache();
    rows.push(newRow({ id: "full", memoryId: "mem_full", recipientEmail: "f@example.net", recipientKey: "f@example.net", emailType: "MEMORY_CONFIRMATION", status: "SENT" }));
    rows.push(newRow({ id: "s2", memoryId: "mem_s2", recipientEmail: "two@example.net", recipientKey: "two@example.net", emailType: "MEMORY_CONFIRMATION", status: "SENDING", updatedAt: stale() }));
    expect(await sendMemoryConfirmation({ ...base, memoryId: "mem_s2", to: "two@example.net" })).toEqual({ sent: false, skipped: "global_capped" });
    expect(rows.find((r) => r.id === "s2")).toMatchObject({ status: "FAILED", errorMessage: "global_capped", nextAttemptAt: expect.any(Date) });

    rows.push(newRow({ id: "s3", memoryId: "mem_s3", recipientEmail: "", recipientKey: "", emailType: "SUBMISSION_CONFIRMATION", status: "SENDING", updatedAt: stale() }));
    expect(await skipDelivery({ memoryId: "mem_s3", emailType: "SUBMISSION_CONFIRMATION", reason: "nothing_to_send" })).toEqual({ sent: false, skipped: "nothing_to_send" });
    expect(rows.find((r) => r.id === "s3")).toMatchObject({ status: "SKIPPED", errorMessage: "nothing_to_send" });
  });
});

describe("skipDelivery", () => {
  it("writes a terminal SKIPPED row under the lock, never touching a SENT row", async () => {
    expect(await skipDelivery({ memoryId: "mem_1", emailType: "SUBMISSION_CONFIRMATION", reason: "nothing_to_send" })).toEqual({ sent: false, skipped: "nothing_to_send" });
    expect(rows[0]).toMatchObject({ memoryId: "mem_1", emailType: "SUBMISSION_CONFIRMATION", status: "SKIPPED", errorMessage: "nothing_to_send" });
    expect(dbStub.$executeRaw).toHaveBeenCalled();
    rows[0]!.status = "SENT";
    expect(await skipDelivery({ memoryId: "mem_1", emailType: "SUBMISSION_CONFIRMATION", reason: "nothing_to_send" })).toEqual({ sent: false, skipped: "already_sent" });
    expect(rows[0]?.status).toBe("SENT");
  });
});

describe("rotated token bookkeeping", () => {
  it("writes SENT and the new claim hash in one transaction when a rotated hash is supplied", async () => {
    memoryUpdateMock.mockClear();
    const result = await sendMemoryConfirmation({ ...base, rotateToClaimTokenHash: "f".repeat(64) });
    expect(result.sent).toBe(true);
    expect(dbStub.$transaction).toHaveBeenCalled();
    expect(memoryUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ data: { claimTokenHash: "f".repeat(64) } }));
    expect(rows[0]?.status).toBe("SENT");
  });

  it("retries the SENT bookkeeping before giving up", async () => {
    dbStub.emailLog.update.mockRejectedValueOnce(new Error("blip 1")).mockRejectedValueOnce(new Error("blip 2"));
    const result = await sendMemoryConfirmation(base);
    expect(result.sent).toBe(true);
    expect(rows[0]?.status).toBe("SENT");
  });
});

describe("sendSubmissionConfirmation (Task 15)", () => {
  const send: SubmissionConfirmationInput = {
    anchorMemoryId: "mem_anchor",
    to: "person@example.com",
    memories: [
      { position: 1, hasWords: true, media: [], claimLink: "https://www.jowray.com/m/aaaa", missingFiles: 0 },
      { position: 2, hasWords: true, media: [], claimLink: "https://www.jowray.com/m/bbbb", missingFiles: 0 },
    ],
  };
  function submissionRow(memoryId = "mem_anchor") {
    return rows.find((r) => r.memoryId === memoryId && r.emailType === "SUBMISSION_CONFIRMATION");
  }

  it("writes one SUBMISSION_CONFIRMATION row on the anchor, idempotent and independent of per-memory rows", async () => {
    expect((await sendSubmissionConfirmation(send)).sent).toBe(true);
    expect(submissionRow()).toMatchObject({ status: "SENT", recipientEmail: "person@example.com", recipientKey: "person@example.com" });
    expect(await sendSubmissionConfirmation(send)).toEqual({ sent: false, skipped: "already_sent" });
    // A per-memory confirmation row on the same anchor is a different key: both can exist.
    expect((await sendMemoryConfirmation({ ...base, memoryId: "mem_anchor" })).sent).toBe(true);
    expect(confirmationRow("mem_anchor")?.status).toBe("SENT");
    expect(rows).toHaveLength(2);
    expect(sendMock).toHaveBeenCalledTimes(2);
    const [message] = sendMock.mock.calls[0] as [{ subject: string }];
    expect(message.subject).toBe("Thank you for sharing 2 memories");
  });

  it("the cap counts both confirmation types and a send once: the 15th is allowed, the 16th capped, admin alerts stay separate", async () => {
    for (let i = 1; i <= 7; i += 1) {
      expect((await sendMemoryConfirmation({ ...base, memoryId: `mem_${i}` })).sent).toBe(true);
    }
    for (let i = 8; i <= 14; i += 1) {
      expect((await sendSubmissionConfirmation({ ...send, anchorMemoryId: `anchor_${i}` })).sent).toBe(true);
    }
    expect((await sendSubmissionConfirmation({ ...send, anchorMemoryId: "anchor_15" })).sent).toBe(true);
    expect(await sendSubmissionConfirmation({ ...send, anchorMemoryId: "anchor_16" })).toEqual({ sent: false, skipped: "recipient_capped" });
    expect(await sendMemoryConfirmation({ ...base, memoryId: "mem_16" })).toEqual({ sent: false, skipped: "recipient_capped" });
    process.env.OUTBOUND_ENABLED = "true"; process.env.ADMIN_ALERT_EMAILS = "person@example.com"; resetEnvCache();
    expect((await sendAdminNewMemory({ ...adminContent, memoryId: "mem_admin" })).sent).toBe(true);
  });

  it("writes SENT, then the anchor's hash, then the others in the order given, in one transaction; nothing on skip or failure", async () => {
    memoryUpdateMock.mockClear();
    const order: string[] = [];
    memoryUpdateMock.mockImplementation(async (arg: unknown) => { order.push((arg as { where: { id: string } }).where.id); return {}; });
    const rotations = [{ memoryId: "mem_anchor", claimTokenHash: "a".repeat(64) }, { memoryId: "mem_1", claimTokenHash: "b".repeat(64) }, { memoryId: "mem_2", claimTokenHash: "c".repeat(64) }];
    expect((await sendSubmissionConfirmation({ ...send, rotations })).sent).toBe(true);
    expect(dbStub.$transaction).toHaveBeenCalled();
    const batch = dbStub.$transaction.mock.calls.at(-1)![0] as unknown[];
    expect(Array.isArray(batch)).toBe(true);
    expect(batch).toHaveLength(4);
    expect(order).toEqual(["mem_anchor", "mem_1", "mem_2"]);
    expect(memoryUpdateMock).toHaveBeenNthCalledWith(1, { where: { id: "mem_anchor" }, data: { claimTokenHash: "a".repeat(64) } });
    expect(submissionRow()?.status).toBe("SENT");

    memoryUpdateMock.mockClear();
    sendMock.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: 400 }));
    expect((await sendSubmissionConfirmation({ ...send, anchorMemoryId: "anchor_fail", rotations })).sent).toBe(false);
    expect(memoryUpdateMock).not.toHaveBeenCalled();
    expect(await sendSubmissionConfirmation({ ...send, anchorMemoryId: "anchor_skip", to: "stranger@example.net", rotations })).toEqual({ sent: false, skipped: "outbound_disabled" });
    expect(memoryUpdateMock).not.toHaveBeenCalled();
  });
});

describe("terminal admin share suppression (A1, A3)", () => {
  const tx = dbStub as unknown as Prisma.TransactionClient;

  it("A1: creates the terminal row once without taking the outbound lock", async () => {
    expect(TERMINAL_SKIP_REASONS).toEqual(["admin_shared"]);
    await suppressAdminAlertForDraftShare(tx, adminContent.memoryId);
    const before = structuredClone(rows);
    await suppressAdminAlertForDraftShare(tx, adminContent.memoryId);
    expect(rows).toHaveLength(1);
    expect(rows).toEqual(before);
    expect(adminRow()).toMatchObject({ status: "SKIPPED", errorMessage: "admin_shared", recipientEmail: "", recipientKey: "", attempts: 0, nextAttemptAt: null });
    expect(dbStub.$executeRaw).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it.each(["PENDING", "SENDING", "SENT", "FAILED", "SKIPPED"] as const)("A1: refuses an existing non-terminal %s admin row and leaves it unchanged", async (status) => {
    rows.push(newRow({ memoryId: adminContent.memoryId, emailType: "ADMIN_NEW_MEMORY", recipientEmail: "admin@example.com", status, errorMessage: status === "SKIPPED" ? "outbound_disabled" : null }));
    const before = structuredClone(rows);
    await expect(suppressAdminAlertForDraftShare(tx, adminContent.memoryId)).rejects.toThrow(new Error(`admin alert row already exists for draft memory ${adminContent.memoryId} (status ${status}); share refused`));
    expect(rows).toEqual(before);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("A1: accepts an existing terminal admin row and leaves it unchanged", async () => {
    rows.push(newRow({ memoryId: adminContent.memoryId, emailType: "ADMIN_NEW_MEMORY", recipientEmail: "", recipientKey: "", status: "SKIPPED", errorMessage: "admin_shared" }));
    const before = structuredClone(rows);
    await expect(suppressAdminAlertForDraftShare(tx, adminContent.memoryId)).resolves.toBeUndefined();
    expect(rows).toEqual(before);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("A3: claimableWhere selects only retryable rows, including NULL skips and stale SENDING claims", () => {
    const now = new Date("2026-11-07T03:00:00.000Z").getTime();
    const candidates = [
      { id: "terminal", status: "SKIPPED", errorMessage: "admin_shared" },
      { id: "null-skip", status: "SKIPPED", errorMessage: null },
      { id: "ordinary-skip", status: "SKIPPED", errorMessage: "outbound_disabled" },
      { id: "pending", status: "PENDING" },
      { id: "failed", status: "FAILED" },
      { id: "sent", status: "SENT" },
      { id: "fresh-sending", status: "SENDING" },
      { id: "stale-sending", status: "SENDING", updatedAt: new Date(now - 16 * 60_000) },
    ] as const;
    for (const candidate of candidates) {
      rows.push(newRow({ memoryId: candidate.id, emailType: "ADMIN_NEW_MEMORY", recipientEmail: "", updatedAt: new Date(now), ...candidate }));
    }
    expect(rows.filter((row) => matches(row, claimableWhere(now) as Where)).map((row) => row.id)).toEqual([
      "null-skip", "ordinary-skip", "pending", "failed", "stale-sending",
    ]);
  });

  it.each([true, false])("A3: the real deliver never claims a helper-created terminal row, outbound enabled = %s", async (enabled) => {
    process.env.OUTBOUND_ENABLED = String(enabled);
    resetEnvCache();
    await suppressAdminAlertForDraftShare(tx, adminContent.memoryId);
    age(24 * HOUR_MS);
    const before = structuredClone(rows);
    dbStub.emailLog.updateMany.mockClear();
    dbStub.emailLog.count.mockClear();
    // This is the email-service entry point notifyAdminsQuietly ultimately calls after sender finalize.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(await sendAdminNewMemory({ ...adminContent, media: [{ kind: "PHOTO", durationSeconds: null, originalFilename: "later-photo.jpg", preview: null }] })).toEqual({ sent: false, skipped: "admin_shared" });
    }
    expect(rows).toEqual(before);
    expect(dbStub.emailLog.updateMany).not.toHaveBeenCalled();
    expect(dbStub.emailLog.count).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("A3: never reclaims a pre-existing terminal row when outbound is allowed and caps have room", async () => {
    process.env.OUTBOUND_ENABLED = "true";
    resetEnvCache();
    rows.push(newRow({ memoryId: adminContent.memoryId, emailType: "ADMIN_NEW_MEMORY", recipientEmail: "", recipientKey: "", status: "SKIPPED", errorMessage: "admin_shared" }));
    const before = structuredClone(rows);
    expect(await sendAdminNewMemory(adminContent)).toEqual({ sent: false, skipped: "admin_shared" });
    expect(rows).toEqual(before);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("A3: skipDelivery short-circuits a pre-existing terminal row before attempting an update", async () => {
    rows.push(newRow({ memoryId: adminContent.memoryId, emailType: "ADMIN_NEW_MEMORY", recipientEmail: "", recipientKey: "", status: "SKIPPED", errorMessage: "admin_shared" }));
    const before = structuredClone(rows);
    dbStub.emailLog.updateMany.mockClear();
    expect(await skipDelivery({ memoryId: adminContent.memoryId, emailType: "ADMIN_NEW_MEMORY", reason: "nothing_to_send" })).toEqual({ sent: false, skipped: "admin_shared" });
    expect(dbStub.emailLog.updateMany).not.toHaveBeenCalled();
    expect(rows).toEqual(before);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("A3: skipDelivery cannot overwrite the terminal reason", async () => {
    await suppressAdminAlertForDraftShare(tx, adminContent.memoryId);
    const before = structuredClone(rows);
    dbStub.emailLog.updateMany.mockClear();
    expect(await skipDelivery({ memoryId: adminContent.memoryId, emailType: "ADMIN_NEW_MEMORY", reason: "nothing_to_send" })).toEqual({ sent: false, skipped: "admin_shared" });
    expect(dbStub.emailLog.updateMany).not.toHaveBeenCalled();
    expect(rows).toEqual(before);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it.each([null, "outbound_disabled", "recipient_capped", "admin_capped", "nothing_to_send", "admin_paused"])("keeps a nonterminal SKIPPED row reclaimable (%s), including SQL NULL", async (errorMessage) => {
    process.env.OUTBOUND_ENABLED = "true";
    resetEnvCache();
    rows.push(newRow({ memoryId: adminContent.memoryId, emailType: "ADMIN_NEW_MEMORY", recipientEmail: "", status: "SKIPPED", errorMessage }));
    expect(await sendAdminNewMemory(adminContent)).toEqual({ sent: true, messageId: "msg-1" });
    expect(adminRow()).toMatchObject({ status: "SENT", errorMessage: null });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
