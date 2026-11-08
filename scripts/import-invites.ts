// Imports a family-approved send list and saves invite links in a private ledger.
// Usage:
//   npx tsx --env-file=<absolute path to the main checkout's .env> scripts/import-invites.ts --prod --in <send_list.csv> --ledger <invites.csv> [--rotate-missing]
//   ADMIN_API_URL=http://localhost:3000 npx tsx --env-file=<absolute path to the main checkout's .env> scripts/import-invites.ts --in <send_list.csv> --ledger <invites.csv>
// Env: ADMIN_API_SECRET and MEMORIAL_SLUG. Input and ledger must be outside git.
// Use http://localhost:3000 for a local server: its link origin must match the
// target exactly. A bearer-protected GET confirms that binding before any POST.
// The ledger is logically append-only; each batch replaces it atomically with
// its prior content plus newly issued links. --rotate-missing is recovery only
// before any message has been sent. Console output never includes private data.
// Ordinary imports post at most 200 rows per batch; rotation posts at most 25
// because it updates rows sequentially inside a 10-second transaction.
// Importing this module does not read env, files or the network.
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { isInviteToken } from "../lib/invite-token";
import { inviteRowSchema, MAX_INVITES_PER_BATCH, type CreateInvitesInput } from "../lib/validations/invite";

import { callAdmin, describeTarget, redactSecret, resolveTarget, type AdminResponse } from "./draft-memory";

/** Only controlled, value-free messages from this module may reach the CLI. */
class ImportRefusal extends Error {}

const RECOVERY_MESSAGE = "The server may have issued invites for this batch. Re-run the same command without --rotate-missing first; use --rotate-missing only before any message has been sent.";
const ORIGIN_MISMATCH = "Invalid admin response: server links use a different origin than the target";

export const ROTATE_BATCH_SIZE = 25;

export interface SendRow {
  rowNumber: number;
  email: string;
  firstName: string;
  lastName?: string;
}

export interface LedgerBinding {
  origin: string;
  memorial: string;
}

export interface Ledger extends LedgerBinding {
  text: string;
  entries: ReadonlyMap<string, string>;
}

export interface LedgerEntry {
  email: string;
  shareUrl: string;
}

type InviteResponseResult =
  | { index: number; status: "created" | "rotated"; token: string; shareUrl: string }
  | { index: number; status: "exists" | "revoked" };

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const csvField = (value: string) => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** Retain physical line numbers for ledger diagnostics, including quoted newlines. */
function csvRecords(raw: string): { fields: string[]; lineNumber: number }[] {
  const text = raw.replace(/^\uFEFF/, "");
  const rows: { fields: string[]; lineNumber: number }[] = [];
  let row: string[] = [];
  let field = "";
  let lineNumber = 1;
  let rowLine = 1;
  let state: "start" | "plain" | "quoted" | "closed" = "start";
  const invalid = () => new ImportRefusal(`Invalid CSV near data row ${Math.max(1, rows.length)}`);
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\r" || (char === "\n" && text[i - 1] !== "\r")) {
      lineNumber++;
    }
    if (state === "quoted") {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          state = "closed";
        }
      } else {
        field += char;
      }
    } else if (char === "," || char === "\r" || char === "\n") {
      row.push(field);
      field = "";
      state = "start";
      if (char !== ",") {
        rows.push({ fields: row, lineNumber: rowLine });
        row = [];
        rowLine = lineNumber;
        if (char === "\r" && text[i + 1] === "\n") {
          i++;
        }
      }
    } else if (char === '"' && state === "start") {
      state = "quoted";
    } else {
      if (state === "closed" || char === '"') {
        throw invalid();
      }
      field += char;
      state = "plain";
    }
  }
  if (state === "quoted") {
    throw invalid();
  }
  if (row.length > 0 || state !== "start") {
    rows.push({ fields: [...row, field], lineNumber: rowLine });
  }
  return rows;
}

/** RFC 4180 fields, with LF accepted alongside CRLF; row numbers count records. */
export function parseCsv(raw: string): string[][] {
  return csvRecords(raw).map(({ fields }) => fields);
}

function emptyRecord(fields: string[], columns: number): boolean {
  // Blank lines have one empty field. Empty CSV rows must still have the right width.
  return (fields.length === 1 || fields.length === columns) && fields.every((field) => field.trim() === "");
}

export function parseSendList(text: string): SendRow[] {
  const [rawHeader, ...records] = parseCsv(text);
  const header = rawHeader?.map((column) => column.trim()) ?? [];
  if (!header.includes("email") || !header.includes("first_name") || new Set(header).size !== header.length) {
    throw new ImportRefusal("Input columns must include email and first_name, with no duplicate columns");
  }
  const seen = new Set<string>();
  return records.flatMap((record, index) => {
    const rowNumber = index + 1;
    if (emptyRecord(record, header.length)) {
      return [];
    }
    if (record.length !== header.length) {
      throw new ImportRefusal(`row ${rowNumber} has the wrong number of CSV fields`);
    }
    const email = normalizeEmail(record[header.indexOf("email")]);
    const firstName = record[header.indexOf("first_name")].trim();
    const lastName = record[header.indexOf("last_name")]?.trim();
    if (!email || !firstName) {
      throw new ImportRefusal(`row ${rowNumber} is missing email or first_name`);
    }
    if (seen.has(email)) {
      throw new ImportRefusal(`row ${rowNumber} has a duplicate email`);
    }
    // Preflight every row before any POST, including server length/format rules.
    const parsed = inviteRowSchema.safeParse({ email, firstName, ...(lastName ? { lastName } : {}) });
    if (!parsed.success) {
      throw new ImportRefusal(`row ${rowNumber} has invalid invite fields`);
    }
    seen.add(email);
    return [{ rowNumber, email, firstName, ...(lastName ? { lastName } : {}) }];
  });
}

function validShareUrl(shareUrl: string, origin: string): boolean {
  const prefix = `${origin}/s/`;
  return shareUrl.startsWith(prefix) && isInviteToken(shareUrl.slice(prefix.length));
}

export function parseLedger(raw: string, binding: LedgerBinding): Ledger {
  const text = raw.replace(/^\uFEFF/, "");
  const newline = text.indexOf("\n");
  const match = /^# target=(\S+) memorial=(\S+)$/.exec(text.slice(0, newline).replace(/\r$/, ""));
  if (newline < 0 || !match) {
    throw new ImportRefusal("Invalid ledger header; refusing");
  }
  if (match[1] !== binding.origin || match[2] !== binding.memorial) {
    throw new ImportRefusal("ledger belongs to another target or memorial; refusing");
  }
  const [header, ...records] = csvRecords(text.slice(newline + 1));
  if (header?.fields.length !== 2 || header.fields[0] !== "email" || header.fields[1] !== "share_url") {
    throw new ImportRefusal("Invalid ledger columns; expected email and share_url");
  }
  const entries = new Map<string, string>();
  const links = new Set<string>();
  for (const { fields: row, lineNumber } of records) {
    const ledgerLine = lineNumber + 1; // Include the target/memorial comment line.
    if (emptyRecord(row, 2)) {
      continue;
    }
    const email = normalizeEmail(row[0] ?? "");
    if (row.length !== 2 || !email) {
      throw new ImportRefusal(`Invalid ledger line ${ledgerLine}`);
    }
    if (!validShareUrl(row[1], binding.origin)) {
      throw new ImportRefusal(`Invalid share URL prefix or token at ledger line ${ledgerLine}; refusing`);
    }
    if (entries.has(email)) {
      throw new ImportRefusal(`Ledger line ${ledgerLine} has a duplicate email; refusing`);
    }
    if (links.has(row[1])) {
      throw new ImportRefusal(`Ledger line ${ledgerLine} has a duplicate share URL; refusing`);
    }
    entries.set(email, row[1]);
    links.add(row[1]);
  }
  return { ...binding, text: raw, entries };
}

/** Preserve all existing bytes and entries; normalize only new CSV fields. */
export function appendLedger(ledger: Ledger, additions: LedgerEntry[]): Ledger {
  const entries = new Map(ledger.entries);
  const links = new Set(entries.values());
  let text = ledger.text;
  for (const addition of additions) {
    const email = normalizeEmail(addition.email);
    if (!email || !validShareUrl(addition.shareUrl, ledger.origin)) {
      throw new ImportRefusal("Invalid new ledger entry; refusing");
    }
    if (entries.has(email)) {
      throw new ImportRefusal("Invite already has a ledger entry; refusing to overwrite it");
    }
    if (links.has(addition.shareUrl)) {
      throw new ImportRefusal("Duplicate share URL in new ledger entries; refusing");
    }
    entries.set(email, addition.shareUrl);
    links.add(addition.shareUrl);
    text += `${text.endsWith("\n") ? "" : "\n"}${csvField(email)},${csvField(addition.shareUrl)}\n`;
  }
  return { ...ledger, entries, text };
}

export type AtomicFileOps = Pick<typeof fs, "openSync" | "writeFileSync" | "fsyncSync" | "closeSync" | "renameSync" | "unlinkSync">;

/** Failures before rename retain the old ledger; after rename, the new complete file remains. */
export function writeLedgerAtomic(path: string, text: string, io: AtomicFileOps = fs): void {
  const temporary = join(dirname(path), `.invite-ledger-${randomUUID()}.tmp`);
  let fd: number | undefined;
  let created = false;
  let renamed = false;
  try {
    fd = io.openSync(temporary, "wx", 0o600);
    created = true;
    io.writeFileSync(fd, text, "utf8");
    io.fsyncSync(fd);
    io.closeSync(fd);
    fd = undefined;
    io.renameSync(temporary, path);
    renamed = true;
    fd = io.openSync(dirname(path), "r");
    io.fsyncSync(fd);
    io.closeSync(fd);
    fd = undefined;
  } catch (cause) {
    try {
      if (fd !== undefined) {
        io.closeSync(fd);
      }
      if (created && !renamed) {
        io.unlinkSync(temporary);
      }
    } catch (cleanupCause) {
      throw new ImportRefusal("Unable to write ledger; private temporary file cleanup also failed", { cause: new AggregateError([cause, cleanupCause]) });
    }
    throw new ImportRefusal(renamed
      ? "Ledger replaced, but directory durability could not be confirmed; import stopped"
      : "Unable to write ledger atomically; prior ledger retained; import stopped", { cause });
  }
}

function missingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Walk both lexical and resolved parents so symlinks cannot bypass the guard. */
export function guardGitPath(path: string): void {
  const walk = (start: string) => {
    let directory = start;
    for (;;) {
      let found = false;
      try {
        fs.lstatSync(join(directory, ".git"));
        found = true;
      } catch (cause) {
        if (!missingFile(cause)) {
          throw new ImportRefusal("Unable to check private file directory; refusing", { cause });
        }
      }
      if (found) {
        throw new ImportRefusal("Private files must be outside a git work tree; refusing");
      }
      const parent = dirname(directory);
      if (parent === directory) {
        break;
      }
      directory = parent;
    }
  };
  const absolute = resolve(path);
  walk(dirname(absolute));
  try {
    walk(fs.realpathSync(dirname(absolute)));
    let exists = false;
    try {
      fs.lstatSync(absolute);
      exists = true;
    } catch (cause) {
      if (!missingFile(cause)) {
        throw cause;
      }
    }
    if (exists) {
      walk(dirname(fs.realpathSync(absolute)));
    }
  } catch (cause) {
    if (cause instanceof ImportRefusal) {
      throw cause;
    }
    throw new ImportRefusal("Unable to resolve private file directory; refusing", { cause });
  }
}

export function readLedger(path: string, binding: LedgerBinding, io: AtomicFileOps = fs): Ledger {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(path);
  } catch (cause) {
    if (!missingFile(cause)) {
      throw new ImportRefusal("Unable to read ledger; refusing", { cause });
    }
    const text = `# target=${binding.origin} memorial=${binding.memorial}\nemail,share_url\n`;
    const ledger = parseLedger(text, binding);
    writeLedgerAtomic(path, text, io);
    return ledger;
  }
  if (!stats.isFile() || (stats.mode & 0o777) !== 0o600) {
    throw new ImportRefusal("Ledger must be a regular private file with mode 0600; refusing");
  }
  let text: string;
  try {
    text = fs.readFileSync(path, "utf8");
  } catch (cause) {
    throw new ImportRefusal("Unable to read ledger; refusing", { cause });
  }
  return parseLedger(text, binding);
}

export function planBatches(rows: SendRow[], ledger: Ledger, rotateMissing = false): SendRow[][] {
  const missing = rows.filter(({ email }) => !ledger.entries.has(normalizeEmail(email)))
    .map((row) => ({ ...row, email: normalizeEmail(row.email) }));
  const batches: SendRow[][] = [];
  const batchSize = rotateMissing ? ROTATE_BATCH_SIZE : MAX_INVITES_PER_BATCH;
  for (let i = 0; i < missing.length; i += batchSize) {
    batches.push(missing.slice(i, i + batchSize));
  }
  return batches;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** GET and POST must both attest to the ledger's memorial and exact target origin. */
function validateBinding(response: AdminResponse, binding: LedgerBinding, phase: "preflight" | "batch"): Record<string, unknown> {
  const { status, body } = response;
  if (status !== 200) {
    // A proxy/server may echo any input, so even its error message stays private.
    throw new ImportRefusal(`Admin response HTTP ${status}; import stopped`);
  }
  if (!isRecord(body) || body.success !== true || !isRecord(body.data)) {
    throw new ImportRefusal("Invalid admin response: expected success and server binding");
  }
  const posting = phase === "preflight" ? "nothing was posted" : "nothing more was posted";
  if (body.data.memorialSlug !== binding.memorial) {
    throw new ImportRefusal(`Invalid admin response: server memorial differs from the ledger binding; ${posting}`);
  }
  if (body.data.siteUrl !== binding.origin) {
    throw new ImportRefusal(`${ORIGIN_MISMATCH}; ${posting}`);
  }
  return body.data;
}

/** Fully validate before returning any credentials to the ledger writer. */
export function validateResponse(response: AdminResponse, batchLength: number, binding: LedgerBinding, rotateMissing = false): InviteResponseResult[] {
  const data = validateBinding(response, binding, "batch");
  if (!Array.isArray(data.results)) {
    throw new ImportRefusal("Invalid admin response: expected results");
  }
  if (data.results.length !== batchLength) {
    throw new ImportRefusal("Invalid admin response: results length differs from batch");
  }
  const seen = new Set<number>();
  const tokens = new Set<string>();
  const results: InviteResponseResult[] = [];
  for (const result of data.results) {
    if (!isRecord(result) || typeof result.index !== "number" || !Number.isInteger(result.index) || result.index < 0 || result.index >= batchLength || seen.has(result.index)) {
      throw new ImportRefusal("Invalid admin response: missing, duplicate or out-of-range result index");
    }
    seen.add(result.index);
    if ((result.status === "rotated" && !rotateMissing) || (result.status === "exists" && rotateMissing)) {
      throw new ImportRefusal("Invalid admin response: result status contradicts --rotate-missing");
    }
    if (result.status === "exists" || result.status === "revoked") {
      results.push({ index: result.index, status: result.status });
    } else if (result.status === "created" || result.status === "rotated") {
      if (typeof result.shareUrl === "string") {
        let url: URL;
        try {
          url = new URL(result.shareUrl);
        } catch (cause) {
          throw new ImportRefusal("Invalid admin response: malformed share URL", { cause });
        }
        if (url.origin !== binding.origin) {
          throw new ImportRefusal(`${ORIGIN_MISMATCH}; nothing more was posted`);
        }
      }
      if (typeof result.token !== "string" || !isInviteToken(result.token) || typeof result.shareUrl !== "string" || result.shareUrl !== `${binding.origin}/s/${result.token}`) {
        throw new ImportRefusal("Invalid admin response: issued token or share URL does not match the target");
      }
      if (tokens.has(result.token)) {
        throw new ImportRefusal("Invalid admin response: duplicate issued token across results");
      }
      tokens.add(result.token);
      results.push({ index: result.index, status: result.status, token: result.token, shareUrl: result.shareUrl });
    } else {
      throw new ImportRefusal("Invalid admin response: unknown result status");
    }
  }
  // Equal length plus unique in-range integer indices guarantees full coverage.
  return results.sort((a, b) => a.index - b.index);
}

async function preflight(target: URL, secret: string, binding: LedgerBinding, fetchImpl: typeof fetch): Promise<void> {
  let response: AdminResponse;
  try {
    const result = await fetchImpl(new URL("/api/admin/invites", target), {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: { authorization: `Bearer ${secret}`, accept: "application/json" },
    });
    response = { status: result.status, body: result.status === 200 ? await result.json() : undefined };
  } catch (cause) {
    throw new ImportRefusal("Admin preflight request failed; no invites were posted", { cause });
  }
  validateBinding(response, binding, "preflight");
}

function refuseLedgerLeftovers(path: string): void {
  let files: string[];
  try {
    files = fs.readdirSync(dirname(path));
  } catch (cause) {
    throw new ImportRefusal("Unable to check ledger directory for temporary files; refusing", { cause });
  }
  if (files.some((file) => /^\.invite-ledger-.*\.tmp$/.test(file))) {
    throw new ImportRefusal("A private ledger temporary file remains; inspect and remove it before retrying (it may hold share URLs)");
  }
}

export function parseArgs(argv: string[]): { inputPath: string; ledgerPath: string; prod: boolean; rotateMissing: boolean } {
  const usage = "usage: import-invites.ts [--prod] --in <send_list.csv> --ledger <invites.csv> [--rotate-missing]";
  const seen = new Set<string>();
  let inputPath: string | undefined;
  let ledgerPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag) || !["--prod", "--in", "--ledger", "--rotate-missing"].includes(flag)) {
      throw new ImportRefusal(usage);
    }
    seen.add(flag);
    if (flag === "--in" || flag === "--ledger") {
      const value = argv[++i];
      if (!value?.trim() || value.startsWith("-")) {
        throw new ImportRefusal(usage);
      }
      if (flag === "--in") {
        inputPath = value;
      } else {
        ledgerPath = value;
      }
    }
  }
  if (!inputPath || !ledgerPath) {
    throw new ImportRefusal(usage);
  }
  return { inputPath, ledgerPath, prod: seen.has("--prod"), rotateMissing: seen.has("--rotate-missing") };
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  log = console.log,
  fileOps = fs,
}: {
  argv?: string[];
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
  fileOps?: AtomicFileOps;
} = {}): Promise<number> {
  const secret = env.ADMIN_API_SECRET ?? "";
  const emit = (line: string) => log(redactSecret([line], secret)[0]);
  let batchMayHaveCommitted = false;
  try {
    const args = parseArgs(argv);
    if (!secret.trim()) {
      throw new ImportRefusal("ADMIN_API_SECRET is not set (run with --env-file=<absolute env file>)");
    }
    let target: URL;
    try {
      target = resolveTarget(env.ADMIN_API_URL, args.prod);
      if (!describeTarget(target) || target.username || target.password) {
        throw new Error("Invalid target");
      }
    } catch (cause) {
      throw new ImportRefusal("Invalid target: use --prod or ADMIN_API_URL, never both; require https except on loopback, without URL credentials", { cause });
    }
    const memorial = env.MEMORIAL_SLUG;
    if (!memorial || !/^[^\s=]+$/.test(memorial)) {
      throw new ImportRefusal("MEMORIAL_SLUG must be set to a nonempty value without whitespace");
    }
    guardGitPath(args.inputPath);
    guardGitPath(args.ledgerPath);
    refuseLedgerLeftovers(args.ledgerPath);
    let csv: string;
    try {
      csv = fs.readFileSync(args.inputPath, "utf8");
    } catch (cause) {
      throw new ImportRefusal("Unable to read input CSV; refusing", { cause });
    }
    const rows = parseSendList(csv);
    let ledger = readLedger(args.ledgerPath, { origin: target.origin, memorial }, fileOps);
    const batches = planBatches(rows, ledger, args.rotateMissing);
    if (batches.length > 0) {
      await preflight(target, secret, ledger, fetchImpl);
    }
    const alreadyInLedger = rows.length - batches.reduce((count, batch) => count + batch.length, 0);
    let created = 0;
    let rotated = 0;
    let postedBatches = 0;
    for (const batch of batches) {
      const body: CreateInvitesInput = {
        invites: batch.map(({ email, firstName, lastName }) => ({ email: normalizeEmail(email), firstName, ...(lastName ? { lastName } : {}) })),
        ...(args.rotateMissing ? { rotate: true } : {}),
      };
      let response: AdminResponse;
      batchMayHaveCommitted = true;
      try {
        response = await callAdmin({ target, secret, path: "/api/admin/invites", body, fetchImpl });
      } catch (cause) {
        throw new ImportRefusal("Admin request failed; nothing more was posted", { cause });
      }
      postedBatches++;
      const results = validateResponse(response, batch.length, ledger, args.rotateMissing);
      const additions: LedgerEntry[] = [];
      for (const result of results) {
        if (result.status === "created" || result.status === "rotated") {
          additions.push({ email: batch[result.index].email, shareUrl: result.shareUrl });
          if (result.status === "created") {
            created++;
          } else {
            rotated++;
          }
        }
      }
      // A valid mixed batch has already issued credentials. Keep all of them
      // before stopping on a missing/revoked invite; never discard known tokens.
      if (additions.length > 0) {
        const updated = appendLedger(ledger, additions);
        writeLedgerAtomic(args.ledgerPath, updated.text, fileOps);
        ledger = updated;
      }
      // The response is validated and every issued credential is durable (or
      // none was issued). Known status stops need only their specific advice.
      batchMayHaveCommitted = false;
      for (const result of results) {
        const row = batch[result.index].rowNumber;
        if (result.status === "exists") {
          throw new ImportRefusal(`row ${row} already has an invite but no ledger entry; re-run with --rotate-missing (only before any message has been sent)`);
        }
        if (result.status === "revoked") {
          throw new ImportRefusal(`row ${row}'s invite is revoked`);
        }
      }
    }
    if (rows.some(({ email }) => !ledger.entries.has(normalizeEmail(email)))) {
      throw new ImportRefusal("Import incomplete: an input row has no ledger entry");
    }
    for (const line of [`rows: ${rows.length}`, `already in ledger: ${alreadyInLedger}`, `created: ${created}`, `rotated: ${rotated}`, `posted batches: ${postedBatches}`]) {
      emit(line);
    }
    return 0;
  } catch (error) {
    emit(error instanceof ImportRefusal ? error.message : "Import failed unexpectedly; stopped before posting another batch");
    if (batchMayHaveCommitted) {
      emit(RECOVERY_MESSAGE);
    }
    return 1;
  }
}

const isEntrypoint = basename(process.argv[1] ?? "").replace(/\.ts$/, "") === "import-invites";
if (isEntrypoint) {
  void main().then((code) => { process.exitCode = code; });
}
