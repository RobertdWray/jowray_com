import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appendLedger,
  main,
  parseCsv,
  parseLedger,
  parseSendList,
  planBatches,
  readLedger,
  validateResponse,
  writeLedgerAtomic,
  type AtomicFileOps,
} from "../../scripts/import-invites";

const ORIGIN = "https://example.com";
const TOKEN = "A123456789_-";
const SECRET = "synthetic-admin-credential".repeat(2);
const BINDING = { origin: ORIGIN, memorial: "example-memorial" };
const HEADER = `# target=${ORIGIN} memorial=${BINDING.memorial}\nemail,share_url\n`;
const ENV = { ADMIN_API_SECRET: SECRET, ADMIN_API_URL: ORIGIN, MEMORIAL_SLUG: BINDING.memorial };
const CSV = "email,first_name,last_name,name,account\nalice@example.com,Alice Example,,,primary\n";
const SERVER_BINDING = { memorialSlug: BINDING.memorial, siteUrl: ORIGIN };
const RECOVERY = "The server may have issued invites for this batch. Re-run the same command without --rotate-missing first; use --rotate-missing only before any message has been sent.";
const issued = (index = 0, status = "created", offset = 0) => {
  const token = String(offset + index + 1).padStart(12, "0");
  return { index, status, token, shareUrl: `${ORIGIN}/s/${token}` };
};
const envelope = (results: unknown[], binding = SERVER_BINDING) => ({ success: true, data: { ...binding, results } });
const response = (results: unknown[], status = 200, binding = SERVER_BINDING) => new Response(JSON.stringify(envelope(results, binding)), { status });

let dir: string;
let inputPath: string;
let ledgerPath: string;
let logs: string[];

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), "invite-import-test-"));
  inputPath = join(dir, "send_list.csv");
  ledgerPath = join(dir, "invites.csv");
  logs = [];
  fs.writeFileSync(inputPath, CSV);
});

afterEach(() => {
  // Applies to every success/refusal case, including errors with attacker-controlled text.
  const output = logs.join("\n");
  expect(output).not.toMatch(/@|Alice|Bob|Carol|Dana|\/s\/|\d{12}/);
  expect(output).not.toContain(TOKEN);
  expect(output).not.toContain(SECRET);
  fs.rmSync(dir, { recursive: true, force: true });
});

function run(fetchImpl: typeof fetch, options: { argv?: string[]; env?: Record<string, string | undefined>; fileOps?: AtomicFileOps } = {}) {
  const env = options.env ?? ENV;
  return main({
    argv: options.argv ?? ["--in", inputPath, "--ledger", ledgerPath],
    env,
    // Existing execution tests track POSTs; preflight behavior has its own tests below.
    fetchImpl: (url, init) => init?.method === "GET"
      ? Promise.resolve(Response.json({ success: true, data: { memorialSlug: env.MEMORIAL_SLUG, siteUrl: env.ADMIN_API_URL ?? "https://www.jowray.com" } }))
      : fetchImpl(url, init),
    fileOps: options.fileOps,
    log: (line: string) => logs.push(line),
  });
}

function writeRows(count: number) {
  fs.writeFileSync(inputPath, "email,first_name,last_name\n" + Array.from({ length: count }, (_, i) => `person${i}@example.com,Alice Example,`).join("\n") + "\n");
}

describe("CSV and batch planning", () => {
  it("reads BOM, CRLF, commas, escaped quotes and embedded newlines, and omits a blank last name", () => {
    const csv = '\uFEFFemail,first_name,last_name,name,account\r\n" ALICE@Example.com ","Alice, ""Example""", ,"line 1\r\nline 2",primary\r\n';
    expect(parseCsv(csv)[1]).toEqual([" ALICE@Example.com ", 'Alice, "Example"', " ", "line 1\r\nline 2", "primary"]);
    expect(parseSendList(csv)).toEqual([{ rowNumber: 1, email: "alice@example.com", firstName: 'Alice, "Example"' }]);
    expect(parseSendList("email,first_name\nbob@example.com,Bob Sample")).toEqual([{ rowNumber: 1, email: "bob@example.com", firstName: "Bob Sample" }]);
  });

  it.each([
    ["email\nalice@example.com", /columns/],
    ["email,first_name\n,Alice Example", /row 1/],
    ["email,first_name\nalice@example.com, ", /row 1/],
    ["email,first_name\nalice@example.com,Alice Example\n ALICE@Example.com ,Bob Sample", /row 2.*duplicate/i],
    ['email,first_name\n"alice@example.com,Alice Example', /CSV/],
    ['email,first_name\nalice@example.com,Al"ice', /CSV/],
    ['email,first_name\nalice@example.com,"Alice"x', /CSV/],
    ["email,first_name\nalice@example.com,Alice Example,extra", /row 1/],
    ["email,first_name,email\nalice@example.com,Alice Example,bob@example.com", /columns/],
  ])("refuses malformed input without including the field values", (csv, message) => {
    expect(() => parseSendList(csv)).toThrow(message);
  });

  it("plans only missing normalized addresses in batches capped at 200", () => {
    writeRows(450);
    const rows = parseSendList(fs.readFileSync(inputPath, "utf8"));
    const ledger = parseLedger(HEADER + ` PERSON0@Example.com ,${ORIGIN}/s/${TOKEN}\n`, BINDING);
    const batches = planBatches(rows, ledger);
    expect(batches.map((batch) => batch.length)).toEqual([200, 200, 49]);
    expect(batches[0][0].rowNumber).toBe(2);
  });

  it("skips fully empty records while keeping original data row numbers", () => {
    expect(parseSendList("email,first_name\nalice@example.com,Alice Example\n\n,\nbob@example.com,Bob Sample\n\n")).toEqual([
      { rowNumber: 1, email: "alice@example.com", firstName: "Alice Example" },
      { rowNumber: 4, email: "bob@example.com", firstName: "Bob Sample" },
    ]);
    expect(() => parseSendList("email,first_name\n,,\n")).toThrow(/row 1.*number/);
  });
});

describe("private ledger", () => {
  it("creates the binding header with mode 0600, and normalizes new entries", () => {
    const ledger = readLedger(ledgerPath, BINDING);
    expect(fs.readFileSync(ledgerPath, "utf8")).toBe(HEADER);
    expect(fs.statSync(ledgerPath).mode & 0o777).toBe(0o600);
    const updated = appendLedger(ledger, [{ email: " ALICE@Example.com ", shareUrl: `${ORIGIN}/s/${TOKEN}` }]);
    expect(updated.text).toBe(HEADER + `alice@example.com,${ORIGIN}/s/${TOKEN}\n`);
    expect(ledger.entries.size).toBe(0);
    expect(updated.entries.get("alice@example.com")).toBe(`${ORIGIN}/s/${TOKEN}`);
    expect(() => appendLedger(updated, [{ email: "alice@example.com", shareUrl: `${ORIGIN}/s/${TOKEN}` }])).toThrow(/already/);
  });

  it.each([
    [HEADER.replace(ORIGIN, "https://other.example.com"), /ledger belongs to .*refusing/],
    [HEADER.replace("example-memorial", "other-memorial"), /ledger belongs to .*refusing/],
    [HEADER + `alice@example.com,https://other.example.com/s/${TOKEN}\n`, /prefix/],
    [HEADER + `alice@example.com,${ORIGIN}.invalid/s/${TOKEN}\n`, /prefix/],
    ["email,share_url\n", /header/],
    [HEADER.replace("email,share_url", "email,wrong"), /columns/],
    [HEADER + `alice@example.com,${ORIGIN}/s/${TOKEN}\n ALICE@Example.com ,${ORIGIN}/s/${TOKEN}\n`, /duplicate/],
  ])("refuses an incompatible or malformed ledger before posting", async (text, message) => {
    fs.writeFileSync(ledgerPath, text, { mode: 0o600 });
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await run(fetchImpl)).toBe(1);
    expect(logs.join("\n")).toMatch(message);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fs.readFileSync(ledgerPath, "utf8")).toBe(text);
  });

  it("refuses a ledger readable by other users", async () => {
    fs.writeFileSync(ledgerPath, HEADER, { mode: 0o644 });
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await run(fetchImpl)).toBe(1);
    expect(logs.join("\n")).toMatch(/0600/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("writes a private same-directory temporary file, fsyncs, then renames the complete content", () => {
    fs.writeFileSync(ledgerPath, HEADER, { mode: 0o600 });
    const events: string[] = [];
    const next = HEADER + `alice@example.com,${ORIGIN}/s/${TOKEN}\n`;
    writeLedgerAtomic(ledgerPath, next, {
      ...fs,
      fsyncSync: (fd) => { events.push(fs.fstatSync(fd).isDirectory() ? "directory sync" : "file sync"); fs.fsyncSync(fd); },
      renameSync: (from, to) => {
        events.push("rename");
        expect(String(from)).toMatch(new RegExp(`^${dir}/`));
        expect(fs.statSync(from).mode & 0o777).toBe(0o600);
        expect(fs.readFileSync(from, "utf8")).toBe(next);
        expect(fs.readFileSync(to, "utf8")).toBe(HEADER);
        fs.renameSync(from, to);
      },
    });
    expect(events).toEqual(["file sync", "rename", "directory sync"]);
    expect(fs.readFileSync(ledgerPath, "utf8")).toBe(next);
    expect(fs.readdirSync(dir).sort()).toEqual(["invites.csv", "send_list.csv"]);
  });

  it.each(["write", "sync", "rename"])("retains the old ledger and cleans the temporary file on %s failure", (step) => {
    fs.writeFileSync(ledgerPath, HEADER, { mode: 0o600 });
    const fail = () => { throw new Error(`Alice alice@example.com ${SECRET} ${ORIGIN}/s/${TOKEN}`); };
    expect(() => writeLedgerAtomic(ledgerPath, "new content", {
      ...fs,
      ...(step === "write" ? { writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => { fs.writeFileSync(args[0], "partial"); fail(); } } : {}),
      ...(step === "sync" ? { fsyncSync: fail } : {}),
      ...(step === "rename" ? { renameSync: fail } : {}),
    })).toThrow(/ledger/);
    expect(fs.readFileSync(ledgerPath, "utf8")).toBe(HEADER);
    expect(fs.readdirSync(dir).sort()).toEqual(["invites.csv", "send_list.csv"]);
  });

  it.each([
    ["empty token", `${ORIGIN}/s/`],
    ["short token", `${ORIGIN}/s/short`],
    ["invalid alphabet", `${ORIGIN}/s/!!!!!!!!!!!!`],
    ["trailing junk", `${ORIGIN}/s/${TOKEN}/extra`],
    ["query", `${ORIGIN}/s/${TOKEN}?extra=1`],
    ["newline after token", `${ORIGIN}/s/${TOKEN}\n`],
    ["crossed link", `${ORIGIN}/s/${TOKEN}`],
  ])("refuses a ledger with %s and identifies its ledger line", async (_label, shareUrl) => {
    const text = HEADER + `alice@example.com,${ORIGIN}/s/${TOKEN}\nbob@example.com,"${shareUrl}"\n`;
    fs.writeFileSync(ledgerPath, text, { mode: 0o600 });
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await run(fetchImpl)).toBe(1);
    expect(logs.join("\n")).toMatch(/ledger line 4/i);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fs.readFileSync(ledgerPath, "utf8")).toBe(text);
  });

  it("accepts empty ledger records and refuses a wrong-width empty record", () => {
    expect(parseLedger(HEADER + `\nalice@example.com,${ORIGIN}/s/${TOKEN}\n,\n\n`, BINDING).entries.size).toBe(1);
    expect(() => parseLedger(HEADER + ",,\n", BINDING)).toThrow(/ledger line 3/i);
  });

  it("counts physical ledger lines across quoted CRLF and blank records", () => {
    const text = HEADER + `"alice@example.com\r\n",${ORIGIN}/s/${TOKEN}\n\nbob@example.com,${ORIGIN}/s/short\n`;
    expect(() => parseLedger(text, BINDING)).toThrow(/ledger line 6/i);
  });

  it("refuses crash leftovers before any request or ledger creation", async () => {
    const leftover = join(dir, `.invite-ledger-${TOKEN}.tmp`);
    fs.writeFileSync(leftover, `Alice alice@example.com ${ORIGIN}/s/${TOKEN}`, { mode: 0o600 });
    const fetchImpl = vi.fn<typeof fetch>();
    const exit = await main({ argv: ["--in", inputPath, "--ledger", ledgerPath], env: ENV, fetchImpl, log: (line) => logs.push(line) });
    expect(exit).toBe(1);
    expect(logs.join("\n")).toMatch(/inspect and remove/i);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fs.existsSync(ledgerPath)).toBe(false);
    expect(fs.existsSync(leftover)).toBe(true);
  });
});

describe("import execution", () => {
  it("posts only missing rows, refuses redirects, omits blank surnames, and posts nothing on a second run", async () => {
    fs.writeFileSync(inputPath, CSV.replace("alice@example.com", " ALICE@Example.com ") + "bob@example.com,Bob, Sample ,,primary\n");
    fs.writeFileSync(ledgerPath, HEADER + `alice@example.com,${ORIGIN}/s/${TOKEN}\n`, { mode: 0o600 });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response([issued()]));
    expect(await run(fetchImpl)).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(`${ORIGIN}/api/admin/invites`);
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toMatchObject({ authorization: `Bearer ${SECRET}` });
    expect(JSON.parse(String(init?.body))).toEqual({ invites: [{ email: "bob@example.com", firstName: "Bob", lastName: "Sample" }] });
    expect(logs).toEqual(["rows: 2", "already in ledger: 1", "created: 1", "rotated: 0", "posted batches: 1"]);
    expect(await run(fetchImpl)).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(logs.slice(-5)).toEqual(["rows: 2", "already in ledger: 2", "created: 0", "rotated: 0", "posted batches: 0"]);
  });

  it("posts 450 rows in 200/200/50 batches and joins reversed results by index", async () => {
    writeRows(450);
    const sizes: number[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { invites: unknown[] };
      sizes.push(body.invites.length);
      expect(body.invites[0]).not.toHaveProperty("lastName");
      return response(body.invites.map((_, index) => {
        const token = String(sizes.length * 1000 + index).padStart(12, "0");
        return { index, status: "created", token, shareUrl: `${ORIGIN}/s/${token}` };
      }).reverse());
    });
    expect(await run(fetchImpl)).toBe(0);
    expect(sizes).toEqual([200, 200, 50]);
    const ledger = readLedger(ledgerPath, BINDING);
    expect(ledger.entries.size).toBe(450);
    expect(ledger.entries.get("person200@example.com")).toBe(`${ORIGIN}/s/000000002000`);
    expect(logs).toContain("posted batches: 3");
  });

  it("rotates only missing rows when explicitly requested", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response([issued(0, "rotated")]));
    expect(await run(fetchImpl, { argv: ["--in", inputPath, "--ledger", ledgerPath, "--rotate-missing"] })).toBe(0);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ invites: [{ firstName: "Alice Example", email: "alice@example.com" }], rotate: true });
    expect(logs).toContain("rotated: 1");
  });

  it.each(["exists", "revoked"])("saves issued tokens in a valid batch, then stops on %s with the input row number", async (status) => {
    writeRows(202);
    fs.writeFileSync(ledgerPath, HEADER + `person0@example.com,${ORIGIN}/s/${TOKEN}\n`, { mode: 0o600 });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(Array.from({ length: 200 }, (_, index) => index === 1 ? { index, status } : issued(index))));
    expect(await run(fetchImpl)).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readLedger(ledgerPath, BINDING).entries.size).toBe(200);
    expect(logs.join("\n")).toContain(status === "exists"
      ? "row 3 already has an invite but no ledger entry; re-run with --rotate-missing (only before any message has been sent)"
      : "row 3's invite is revoked");
    expect(logs).not.toContain(RECOVERY);
  });

  it.each(["exists", "revoked"])("stops on %s without uncertain-commit advice when no new credentials were issued", async (status) => {
    fs.writeFileSync(ledgerPath, HEADER, { mode: 0o600 });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response([{ index: 0, status }]));
    expect(await run(fetchImpl)).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(ledgerPath, "utf8")).toBe(HEADER);
    expect(logs.join("\n")).toContain(status === "exists" ? "row 1 already has an invite" : "row 1's invite is revoked");
    expect(logs).not.toContain(RECOVERY);
  });

  it.each([
    ["no target", { ...ENV, ADMIN_API_URL: undefined }, [], /--prod.*ADMIN_API_URL/],
    ["conflicting targets", ENV, ["--prod"], /--prod.*ADMIN_API_URL/],
    ["remote http", { ...ENV, ADMIN_API_URL: "http://Alice.example.com" }, [], /https/i],
    ["bad URL", { ...ENV, ADMIN_API_URL: "Alice alice@example.com" }, [], /target/i],
    ["missing secret", { ...ENV, ADMIN_API_SECRET: undefined }, [], /ADMIN_API_SECRET/],
    ["missing memorial", { ...ENV, MEMORIAL_SLUG: undefined }, [], /MEMORIAL_SLUG/],
    ["multiline memorial", { ...ENV, MEMORIAL_SLUG: "Alice\nBob" }, [], /MEMORIAL_SLUG/],
    ["credentials in URL", { ...ENV, ADMIN_API_URL: "https://alice@example.com" }, [], /target/i],
  ])("refuses %s before touching the ledger or posting", async (_label, env, extra, message) => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await run(fetchImpl, { env, argv: ["--in", inputPath, "--ledger", ledgerPath, ...extra] })).toBe(1);
    expect(logs.join("\n")).toMatch(message);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fs.existsSync(ledgerPath)).toBe(false);
  });

  it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000", "https://www.jowray.com"])("allows the explicit target %s", async (origin) => {
    const prod = origin === "https://www.jowray.com";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response([{ ...issued(), shareUrl: `${origin}/s/${issued().token}` }], 200, { ...SERVER_BINDING, siteUrl: origin }));
    expect(await run(fetchImpl, {
      env: { ...ENV, ADMIN_API_URL: prod ? undefined : origin },
      argv: ["--in", inputPath, "--ledger", ledgerPath, ...(prod ? ["--prod"] : [])],
    })).toBe(0);
    expect(fs.readFileSync(ledgerPath, "utf8")).toContain(`# target=${origin} memorial=`);
  });

  it.each([[], ["--in"], ["--wat", "Alice"], ["--prod", "--prod"], ["--ledger", "x", "--ledger", "y"]].map((argv) => ({ argv })))("rejects invalid arguments without echoing them: $argv", async ({ argv }) => {
    expect(await run(vi.fn<typeof fetch>(), { argv })).toBe(1);
    expect(logs.join("\n")).toMatch(/usage/);
  });

  it.each(["input", "ledger", "symlink"])("refuses a %s path inside a git work tree, including linked worktrees", async (kind) => {
    const repo = join(dir, "repo");
    fs.mkdirSync(join(repo, "nested"), { recursive: true });
    fs.writeFileSync(join(repo, ".git"), "gitdir: elsewhere\n");
    if (kind === "input") {
      inputPath = join(repo, "nested", "send_list.csv");
      fs.writeFileSync(inputPath, CSV);
    } else if (kind === "ledger") {
      ledgerPath = join(repo, "nested", "invites.csv");
    } else {
      fs.symlinkSync(repo, join(dir, "link"));
      ledgerPath = join(dir, "link", "nested", "invites.csv");
    }
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await run(fetchImpl)).toBe(1);
    expect(logs.join("\n")).toMatch(/git work tree/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["input", "network", "csv"])("keeps %s error output neutral", async (kind) => {
    if (kind === "input") {
      inputPath = join(dir, "Alice-alice@example.com.csv");
    }
    if (kind === "csv") {
      fs.writeFileSync(inputPath, "email,first_name\nalice@example.com,Alice Example\n ALICE@Example.com ,Bob Sample\n");
    }
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error(`Alice alice@example.com ${SECRET} ${ORIGIN}/s/${TOKEN}`));
    expect(await run(fetchImpl)).toBe(1);
    expect(logs.length).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledTimes(kind === "network" ? 1 : 0);
  });

  it.each(["network", "write", "directory sync"])("prints recovery guidance and stops further POSTs after a possible commit and %s failure", async (failure) => {
    writeRows(450);
    fs.writeFileSync(ledgerPath, HEADER, { mode: 0o600 });
    const privateError = new Error(`Alice alice@example.com ${SECRET} ${ORIGIN}/s/${TOKEN}`);
    const fetchImpl = vi.fn<typeof fetch>();
    if (failure === "network") {
      fetchImpl.mockRejectedValue(privateError);
    } else {
      fetchImpl.mockResolvedValue(response(Array.from({ length: 200 }, (_, index) => issued(index))));
    }
    const fileOps: AtomicFileOps = {
      ...fs,
      writeFileSync: (...args) => {
        if (failure === "write") {
          fs.writeFileSync(args[0], "partial");
          throw privateError;
        }
        fs.writeFileSync(...args);
      },
      fsyncSync: (fd) => {
        if (failure === "directory sync" && fs.fstatSync(fd).isDirectory()) {
          throw privateError;
        }
        fs.fsyncSync(fd);
      },
    };
    expect(await run(fetchImpl, { fileOps })).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(logs.filter((line) => line === RECOVERY)).toHaveLength(1);
    expect(logs.join("\n")).not.toContain("reconcile the private ledger");
    if (failure === "directory sync") {
      expect(readLedger(ledgerPath, BINDING).entries.size).toBe(200);
      expect(logs.join("\n")).not.toContain("prior ledger retained");
    } else {
      expect(fs.readFileSync(ledgerPath, "utf8")).toBe(HEADER);
    }
    expect(fs.readdirSync(dir).sort()).toEqual(["invites.csv", "send_list.csv"]);
  });

  it.each(["exists", "revoked"])("reports the original row and retains earlier batches when %s occurs in a later batch", async (status) => {
    writeRows(450);
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(Array.from({ length: 200 }, (_, index) => issued(index))))
      .mockResolvedValueOnce(response(Array.from({ length: 200 }, (_, index) => index === 3 ? { index, status } : issued(index, "created", 200))));
    expect(await run(fetchImpl)).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(logs.join("\n")).toContain(status === "exists" ? "row 204 already has an invite" : "row 204's invite is revoked");
    expect(logs).not.toContain(RECOVERY);
    const ledger = readLedger(ledgerPath, BINDING);
    expect(ledger.entries.size).toBe(399);
    for (let i = 0; i < 200; i++) {
      expect(ledger.entries.get(`person${i}@example.com`)).toBe(issued(i).shareUrl);
    }
    expect(ledger.entries.has("person203@example.com")).toBe(false);
    expect(ledger.entries.has("person400@example.com")).toBe(false);
  });
});

describe("server binding preflight", () => {
  it("checks the bearer-protected binding with redirects refused before its first POST", async () => {
    const methods: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe(`${ORIGIN}/api/admin/invites`);
      expect(init?.headers).toMatchObject({ authorization: `Bearer ${SECRET}` });
      expect(init?.redirect).toBe("error");
      methods.push(init?.method ?? "");
      if (init?.method === "GET") {
        expect(init.body).toBeUndefined();
        return Response.json({ success: true, data: SERVER_BINDING });
      }
      return response([issued()]);
    });
    expect(await main({ argv: ["--in", inputPath, "--ledger", ledgerPath], env: ENV, fetchImpl, log: (line) => logs.push(line) })).toBe(0);
    expect(methods).toEqual(["GET", "POST"]);
  });

  it.each([
    ["wrong origin", 200, { success: true, data: { ...SERVER_BINDING, siteUrl: "http://localhost:3000" } }, /different origin/i],
    ["wrong memorial", 200, { success: true, data: { ...SERVER_BINDING, memorialSlug: "another-memorial" } }, /memorial/i],
    ["missing binding", 200, { success: true, data: {} }, /binding|memorial|origin/i],
    ["error", 500, { error: { message: `Alice ${SECRET}` } }, /HTTP/],
    ["false success", 200, { success: false, data: SERVER_BINDING }, /response/i],
    ["non-JSON", 200, "Alice alice@example.com", /preflight|response/i],
  ])("refuses %s before any POST", async (label, status, body, message) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));
    expect(await main({ argv: ["--in", inputPath, "--ledger", ledgerPath], env: { ...ENV, ADMIN_API_URL: "http://127.0.0.1:3000" }, fetchImpl, log: (line) => logs.push(line) })).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]?.method).toBe("GET");
    expect(logs.join("\n")).toMatch(message);
    if (label === "wrong origin" || label === "wrong memorial") {
      expect(logs.join("\n")).toContain("nothing was posted");
      expect(logs.join("\n")).not.toContain("nothing more was posted");
    }
    expect(logs).not.toContain(RECOVERY);
    expect(readLedger(ledgerPath, { ...BINDING, origin: "http://127.0.0.1:3000" }).entries.size).toBe(0);
  });
});

describe("response validation", () => {
  const invalid: [string, number, unknown, number?][] = [
    ["non-200", 500, { error: { message: `Alice alice@example.com ${SECRET} ${ORIGIN}/s/${TOKEN}` } }],
    ["non-JSON", 200, `Alice alice@example.com ${SECRET}`],
    ["success false", 200, { ...envelope([issued()]), success: false }],
    ["success absent", 200, { data: { results: [issued()] } }],
    ["missing results", 200, { success: true, data: {} }],
    ["null body", 200, null],
    ["short results", 200, envelope([])],
    ["long results", 200, envelope([issued(), issued()])],
    ["duplicate index", 200, envelope([issued(0), issued(0)])],
    ["large index", 200, envelope([issued(1)])],
    ["negative index", 200, envelope([issued(-1)])],
    ["fractional index", 200, envelope([issued(0.5)])],
    ["string index", 200, envelope([{ ...issued(), index: "0" }])],
    ["missing index", 200, envelope([{ status: "exists" }])],
    ["null result", 200, envelope([null])],
    ["unknown status", 200, envelope([{ index: 0, status: "Alice" }])],
    ["missing token", 200, envelope([{ index: 0, status: "created", shareUrl: `${ORIGIN}/s/${TOKEN}` }])],
    ["bad token", 200, envelope([{ ...issued(), token: "a".repeat(11) }])],
    ["invalid token alphabet", 200, envelope([{ ...issued(), token: "!".repeat(12) }])],
    ["missing shareUrl", 200, envelope([{ index: 0, status: "created", token: TOKEN }])],
    ["wrong prefix", 200, envelope([{ ...issued(), shareUrl: `https://other.example.com/s/${TOKEN}` }])],
    ["wrong token suffix", 200, envelope([{ ...issued(), shareUrl: `${ORIGIN}/s/B123456789_-` }])],
    ["rotated invalid", 200, envelope([{ index: 0, status: "rotated" }])],
    ["duplicate token", 200, envelope([issued(), { ...issued(), index: 1 }]), 2],
    ["newline after token", 200, envelope([{ ...issued(), token: `${TOKEN}\n`, shareUrl: `${ORIGIN}/s/${TOKEN}\n` }])],
    ["wrong memorial", 200, envelope([issued()], { ...SERVER_BINDING, memorialSlug: "another-memorial" })],
    ["wrong site", 200, envelope([issued()], { ...SERVER_BINDING, siteUrl: "https://other.example.com" })],
    ["missing memorial", 200, { success: true, data: { siteUrl: ORIGIN, results: [issued()] } }],
    ["missing site", 200, { success: true, data: { memorialSlug: BINDING.memorial, results: [issued()] } }],
    ["multi-row invalid with a further batch pending", 200, envelope(Array.from({ length: 200 }, (_, index) => index === 199 ? issued(200) : issued(index))), 200],
  ];

  it.each(invalid)("refuses %s without changing the batch's ledger or posting more", async (label, status, body, batchSize) => {
    const size = batchSize ?? (label === "duplicate index" ? 2 : 1);
    writeRows(size === 200 ? 450 : size);
    fs.writeFileSync(ledgerPath, HEADER, { mode: 0o600 });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));
    expect(() => validateResponse({ status, body }, size, BINDING)).toThrow();
    expect(await run(fetchImpl)).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(ledgerPath, "utf8")).toBe(HEADER);
    expect(logs.join("\n")).toMatch(/response|HTTP/);
    expect(logs).toContain(RECOVERY);
    if (label === "wrong prefix" || label === "wrong site") {
      expect(logs.join("\n")).toMatch(/server links use a different origin than the target; nothing more was posted/i);
    }
    if (label === "wrong memorial") {
      expect(logs.join("\n")).toContain("nothing more was posted");
    }
  });

  it.each([
    ["rotated without flag", false, "rotated"],
    ["exists with flag", true, "exists"],
  ])("refuses %s as an invalid response before any ledger append", async (_label, rotate, status) => {
    writeRows(450);
    fs.writeFileSync(ledgerPath, HEADER, { mode: 0o600 });
    const results = Array.from({ length: 200 }, (_, index) => index === 1 ? issued(index, status) : issued(index));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(results));
    expect(await run(fetchImpl, { argv: ["--in", inputPath, "--ledger", ledgerPath, ...(rotate ? ["--rotate-missing"] : [])] })).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(ledgerPath, "utf8")).toBe(HEADER);
    expect(logs.join("\n")).toMatch(/status.*rotate-missing/);
    expect(logs).toContain(RECOVERY);
  });

  it("refuses a newly issued link already assigned to another email in the ledger", async () => {
    fs.writeFileSync(ledgerPath, HEADER + `bob@example.com,${ORIGIN}/s/${TOKEN}\n`, { mode: 0o600 });
    const before = fs.readFileSync(ledgerPath, "utf8");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response([{ ...issued(), token: TOKEN, shareUrl: `${ORIGIN}/s/${TOKEN}` }]));
    expect(await run(fetchImpl)).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(ledgerPath, "utf8")).toBe(before);
    expect(logs.join("\n")).toMatch(/duplicate share URL/i);
    expect(logs).toContain(RECOVERY);
  });

  it("preserves earlier successful batches when a later response is invalid", async () => {
    writeRows(450);
    let beforeFailure = "";
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(Array.from({ length: 200 }, (_, i) => issued(i))))
      .mockImplementationOnce(async () => {
        beforeFailure = fs.readFileSync(ledgerPath, "utf8");
        return response([issued()]);
      });
    expect(await run(fetchImpl)).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(readLedger(ledgerPath, BINDING).entries.size).toBe(200);
    expect(fs.readFileSync(ledgerPath, "utf8")).toBe(beforeFailure);
  });
});
