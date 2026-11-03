import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCache } from "@/server/config/env";

// --- stubs -------------------------------------------------------------
const sendMock = vi.fn();
vi.mock("@sendgrid/mail", () => ({
  default: { setApiKey: vi.fn(), send: (...args: unknown[]) => sendMock(...args) },
}));

interface Row {
  id: string;
  memoryId: string;
  recipientEmail: string;
  emailType: "MEMORY_CONFIRMATION";
  status: "PENDING" | "SENDING" | "SENT" | "FAILED" | "SKIPPED";
  attempts: number;
  nextAttemptAt: Date | null;
  errorMessage: string | null;
  sendgridMessageId: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
const rows: Row[] = [];
const memoryUpdateMock = vi.fn(async (_arg: unknown) => ({}));
const dbStub = {
  $transaction: vi.fn(async (ops: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) => (typeof ops === "function" ? ops(dbStub) : Promise.all(ops))),
  memory: { update: (arg: unknown) => memoryUpdateMock(arg) },
  emailLog: {
    findUnique: vi.fn(async ({ where }: { where: { memoryId_emailType: { memoryId: string } } }) =>
      rows.find((r) => r.memoryId === where.memoryId_emailType.memoryId) ?? null
    ),
    count: vi.fn(async ({ where }: { where: { recipientEmail: string; createdAt?: { gte: Date }; updatedAt?: { gte: Date }; status?: { in: Row["status"][] } } }) =>
      rows.filter((r) => r.recipientEmail === where.recipientEmail && (where.updatedAt ?? where.createdAt)!.gte <= r.updatedAt && (!where.status || where.status.in.includes(r.status))).length
    ),
    create: vi.fn(async ({ data }: { data: Pick<Row, "memoryId" | "recipientEmail" | "emailType" | "status"> & { errorMessage?: string } }) => {
      if (rows.some((r) => r.memoryId === data.memoryId)) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      const row: Row = { id: `log_${rows.length + 1}`, createdAt: new Date(), updatedAt: new Date(), attempts: 0, nextAttemptAt: null, errorMessage: null, sendgridMessageId: null, sentAt: null, ...data };
      rows.push(row);
      return row;
    }),
    upsert: vi.fn(async ({ where, create }: { where: { memoryId_emailType: { memoryId: string } }; create: Pick<Row, "memoryId" | "recipientEmail" | "emailType" | "status"> }) => {
      const existing = rows.find((r) => r.memoryId === where.memoryId_emailType.memoryId);
      if (existing) {
        return existing;
      }
      const row: Row = {
        id: `log_${rows.length + 1}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        attempts: 0,
        nextAttemptAt: null,
        errorMessage: null,
        sendgridMessageId: null,
        sentAt: null,
        ...create,
      };
      rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) {
        throw new Error("missing row");
      }
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { id?: string; memoryId?: string; OR?: Array<{ status?: { in: Row["status"][] } | Row["status"]; updatedAt?: { lt: Date } }>; status?: { in: Row["status"][] } }; data: Partial<Row> }) => {
      const matchesStatus = (r: Row) => {
        if (where.OR) {
          return where.OR.some((c) => {
            const st = c.status === undefined ? true : typeof c.status === "string" ? r.status === c.status : c.status.in.includes(r.status);
            const stale = c.updatedAt === undefined ? true : r.updatedAt < c.updatedAt.lt;
            return st && stale;
          });
        }
        return where.status ? where.status.in.includes(r.status) : true;
      };
      const row = rows.find((r) => (where.id ? r.id === where.id : r.memoryId === where.memoryId) && matchesStatus(r));
      if (!row) {
        return { count: 0 };
      }
      Object.assign(row, data, { updatedAt: new Date() });
      return { count: 1 };
    }),
  },
};
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));

import { sendMemoryConfirmation } from "@/services/email";

const base = {
  memoryId: "mem_1",
  to: "person@example.com",
  name: "Jo Contributor",
  received: { type: "PHOTO" as const, fileCount: 1 },
  claimLink: "https://www.jowray.com/m/token",
};

beforeEach(() => {
  rows.length = 0;
  sendMock.mockReset();
  sendMock.mockResolvedValue([{ statusCode: 202, headers: { "x-message-id": "msg-1" } }, {}]);
  process.env.SENDGRID_API_KEY = "SG.test";
  process.env.SENDGRID_FROM_EMAIL = "memories@jowray.com";
  process.env.OUTBOUND_ENABLED = "false";
  process.env.OUTBOUND_ALLOWLIST = "person@example.com, Other@Example.org";
  process.env.CONSENT_VERSION = "2026-11-v1";
  resetEnvCache();
});

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
    expect([a, b].filter((r) => !r.sent && r.skipped === "in_progress")).toHaveLength(1);
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
      rows.push({ id: `f_${i}`, memoryId: `mem_f${i}`, recipientEmail: base.to, emailType: "MEMORY_CONFIRMATION", status: "FAILED", attempts: 1, nextAttemptAt: new Date(), errorMessage: "x", sendgridMessageId: null, sentAt: null, createdAt: new Date(), updatedAt: new Date() });
    }
    expect((await sendMemoryConfirmation({ ...base, memoryId: "mem_new" })).sent).toBe(true);
  });

  it("caps at three confirmations per address per day", async () => {
    for (let i = 1; i <= 3; i += 1) {
      const r = await sendMemoryConfirmation({ ...base, memoryId: `mem_${i}` });
      expect(r.sent).toBe(true);
    }
    const fourth = await sendMemoryConfirmation({ ...base, memoryId: "mem_4" });
    expect(fourth).toEqual({ sent: false, skipped: "recipient_capped" });
    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(rows.find((r) => r.memoryId === "mem_4")).toMatchObject({ status: "SKIPPED", errorMessage: "recipient_capped" });
  });

  it("escapes the name in the HTML part and strips control characters in the text part", async () => {
    await sendMemoryConfirmation({ ...base, name: '<a href="https://evil.test">Jo</a>\r\nBcc: x' });
    const msg = sendMock.mock.calls[0]?.[0] as { html: string; text: string; subject: string };
    expect(msg.html).not.toContain('href="https://evil.test"');
    expect(msg.html).toContain("&lt;a href=&quot;https://evil.test&quot;&gt;Jo&lt;/a&gt;");
    expect(msg.text).not.toMatch(/[\r\n]Bcc/);
    expect(msg.subject).not.toContain("Jo");
  });

  it("truncates a long name to 60 characters", async () => {
    await sendMemoryConfirmation({ ...base, name: "x".repeat(200) });
    const msg = sendMock.mock.calls[0]?.[0] as { html: string };
    expect(msg.html).not.toContain("x".repeat(61));
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
    expect(msg.attachments).toEqual([{ content: "aGVhcnQ=", filename: "heart.png", type: "image/png", disposition: "inline", contentId: "brand-heart" }]);
    expect(msg.trackingSettings.openTracking.enable).toBe(false);
    expect(msg.trackingSettings.clickTracking.enable).toBe(false);
  });

  it("omits the attachments field when a message has none", async () => {
    const { SendGridTransport } = await import("@/integrations/sendgrid");
    await new SendGridTransport().send({ to: base.to, from: "memories@jowray.com", subject: "s", text: "t", html: "<p>t</p>" });
    const msg = sendMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect("attachments" in msg).toBe(false);
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
    rows.push({ id: "stuck", memoryId: base.memoryId, recipientEmail: base.to, emailType: "MEMORY_CONFIRMATION", status: "SENDING", attempts: 0, nextAttemptAt: null, errorMessage: null, sendgridMessageId: null, sentAt: null, createdAt: new Date(Date.now() - 20 * 60_000), updatedAt: new Date(Date.now() - 20 * 60_000) });
    expect((await sendMemoryConfirmation(base)).sent).toBe(true);
    expect(rows[0]?.status).toBe("SENT");
  });

  it("does not reclaim a SENDING row that is fresh", async () => {
    rows.push({ id: "fresh", memoryId: base.memoryId, recipientEmail: base.to, emailType: "MEMORY_CONFIRMATION", status: "SENDING", attempts: 0, nextAttemptAt: null, errorMessage: null, sendgridMessageId: null, sentAt: null, createdAt: new Date(), updatedAt: new Date() });
    expect(await sendMemoryConfirmation(base)).toEqual({ sent: false, skipped: "in_progress" });
  });

  it("a skip never overwrites a row that is SENDING or SENT", async () => {
    rows.push({ id: "sent", memoryId: "mem_x", recipientEmail: "stranger@example.net", emailType: "MEMORY_CONFIRMATION", status: "SENDING", attempts: 0, nextAttemptAt: null, errorMessage: null, sendgridMessageId: null, sentAt: null, createdAt: new Date(), updatedAt: new Date() });
    // The service reads `existing` before deciding; simulate the row having moved on by the time skip() runs.
    const result = await sendMemoryConfirmation({ ...base, memoryId: "mem_x", to: "stranger@example.net" });
    expect(result.sent).toBe(false);
    expect(rows[0]?.status).toBe("SENDING");
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
