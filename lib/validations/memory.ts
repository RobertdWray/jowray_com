import { z } from "zod";

import { MAX_FILES_PER_MEMORY } from "@/lib/media-types";
import { CONTRIBUTOR_VISIBILITIES } from "@/lib/visibility";

export const MAX_DURATION_SECONDS = 86_400;
/** Memory cards one send may carry (Task 15). */
export const MAX_MEMORIES_PER_SUBMISSION = 10;

/** What the browser knows about a chosen file or recording. */
export const fileInputSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.string().max(255),
  size: z.number().int().nonnegative(),
  durationSeconds: z.number().int().min(0).max(MAX_DURATION_SECONDS).optional(),
});
export type FileInput = z.infer<typeof fileInputSchema>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

/** A file's own words (the memory keeps its own); the claim page edits them, and a claim-page add or replacement may carry them. */
export const mediaWordsFields = {
  caption: optionalText(2000),
  approxDateText: optionalText(120),
  place: optionalText(200),
} as const;

/** What the browser knows about a file plus, optionally, the contributor's words for that file. */
export const memoryFileInputSchema = fileInputSchema.extend(mediaWordsFields);
export type MemoryFileInput = z.infer<typeof memoryFileInputSchema>;

/**
 * What a memory can be, in one phrase (Rob's ruling R1, 2026-11-06: at least one of the four). The card's helper
 * line, the browser's empty-card message and the server's refusal below are all built from it, so they cannot drift.
 */
export const NEEDS_CONTENT_ITEMS = "a photo, a video, a voice recording or a few words";
const NEEDS_CONTENT = `Add at least one: ${NEEDS_CONTENT_ITEMS}`;

/**
 * Name and email are required since 2026-11-04 (Rob's items 1 and 6, ruling 2):
 * the family must know whom to thank, and the private link has to go somewhere.
 * The messages are the ones the form shows under the field and in its summary;
 * `NAME_REQUIRED_MESSAGE` is DESIGN.md § 5.4 verbatim. Browser and server share
 * these two schemas so trimming, case and length never disagree.
 */
export const NAME_REQUIRED_MESSAGE = "We'll need a name so the family knows who to thank.";
export const EMAIL_REQUIRED_MESSAGE = "Add your email address, please. It's where your private link goes.";
export const EMAIL_INVALID_MESSAGE = "That email address doesn't look quite right. Have a look for a typo.";
export const NAME_TOO_LONG_MESSAGE = "That name is longer than we can keep. 120 characters is the most.";

/** A string that must be there: an omitted or null value gets `message` instead of zod's type error; every other issue keeps its own words. */
const requiredString = (message: string) =>
  z.string({ error: (issue) => (issue.input === undefined || issue.input === null ? message : undefined) }).trim();

export const contributorNameSchema = requiredString(NAME_REQUIRED_MESSAGE).min(1, NAME_REQUIRED_MESSAGE).max(120, NAME_TOO_LONG_MESSAGE);
// Trim and lower-case first, then check the format: zod 4's `z.email()` checks the string as given, so it is piped after the overwrites.
export const contributorEmailSchema = requiredString(EMAIL_REQUIRED_MESSAGE)
  .toLowerCase()
  .min(1, EMAIL_REQUIRED_MESSAGE)
  .max(254, EMAIL_INVALID_MESSAGE)
  .pipe(z.email(EMAIL_INVALID_MESSAGE));

/** Who is sending, and the preferences asked once per send (D5). PRIVATE is the admins' to set (ruling 3). */
const contributorFields = {
  name: contributorNameSchema,
  relationship: optionalText(120),
  email: contributorEmailSchema,
  visibility: z.enum(CONTRIBUTOR_VISIBILITIES).default("PUBLIC"),
  contactOptIn: z.boolean().default(false),
  mailingListOptIn: z.boolean().default(false),
  notifyWhenPosted: z.boolean().default(true),
};

/** What one memory says: when, where and the words. */
const memoryFields = {
  approxDateText: optionalText(120),
  place: optionalText(200),
  note: z.string().max(10_000).optional().nullable(),
};

/** One card of a send: its details plus up to ten files, and it must carry files or words. */
export const submissionMemorySchema = z
  .object({
    ...memoryFields,
    files: z.array(fileInputSchema).max(MAX_FILES_PER_MEMORY),
  })
  .refine((value) => value.files.length > 0 || (value.note ?? "").trim().length > 0, {
    error: NEEDS_CONTENT,
    path: ["note"],
  });
export type SubmissionMemoryInput = z.infer<typeof submissionMemorySchema>;

/** A whole send from /share: the contributor once, then 1–10 memories (Task 15). */
export const createSubmissionInputSchema = z.object({
  ...contributorFields,
  memories: z.array(submissionMemorySchema).min(1, { error: "Add at least one memory" }).max(MAX_MEMORIES_PER_SUBMISSION, {
    error: `That's the most we can take at once: ${MAX_MEMORIES_PER_SUBMISSION} memories`,
  }),
});
export type CreateSubmissionInput = z.infer<typeof createSubmissionInputSchema>;

/** The contributor fields a refusal can point at; null when it points at a card, a file, or nothing in particular. */
export type SubmissionIssueField = "name" | "email" | null;

/**
 * Where a validation issue sits in a send: the path `["memories", 2, "files", 0, "size"]`
 * names card 2 and its first file; `["email"]` names the contributor's email; any
 * other top-level field has neither index nor field.
 */
export function submissionIssueLocation(issue: { path: ReadonlyArray<PropertyKey>; message: string }): {
  memoryIndex: number | null;
  fileIndex: number | null;
  field: SubmissionIssueField;
  message: string;
} {
  const [root, memoryIndex, memoryField, fileIndex] = issue.path;
  if (issue.path.length === 1 && (root === "name" || root === "email")) {
    return { memoryIndex: null, fileIndex: null, field: root, message: issue.message };
  }
  const atMemory = root === "memories" && typeof memoryIndex === "number" ? memoryIndex : null;
  const atFile = atMemory !== null && memoryField === "files" && typeof fileIndex === "number" ? fileIndex : null;
  return { memoryIndex: atMemory, fileIndex: atFile, field: null, message: issue.message };
}

const claimTokenSchema = z.string().min(16).max(128);

/** A ticket for one PENDING row of a memory the caller holds the claim token for. */
export const issueTicketRequestSchema = z.object({
  claimToken: claimTokenSchema,
  mediaId: z.string().min(1).max(64),
});

/** Completion of a send: every live memory's raw token, so the email can carry every link. */
export const completeSubmissionSchema = z.object({
  claimTokens: z.array(claimTokenSchema).min(1).max(MAX_MEMORIES_PER_SUBMISSION),
});

export const uploadTicketRequestSchema = z.object({
  claimToken: claimTokenSchema,
  file: memoryFileInputSchema,
});

/**
 * `Memory.sourceRef`: an opaque, unique reference to where an admin-drafted
 * memory's words came from. Never an address or a number in clear:
 * `gmail:<sender's message id>`, `sms:<32 hex of sha256(E.164|UTC minute|canonical text)>`,
 * `other:<32 hex of sha256(lower-cased email|full original text)>`.
 * The builders live in `lib/source-ref.ts`.
 */
export const SOURCE_REF_PATTERN = /^(?:gmail:[0-9a-f]{8,32}|sms:[0-9a-f]{32}|other:[0-9a-f]{32})$/;

const SOURCE_REF_PREFIX = { EMAIL: "gmail:", SMS: "sms:", OTHER: "other:" } as const;

/**
 * A memory's map position: WGS 84 decimal degrees (RFC 7946 §4), named fields so
 * latitude and longitude are never swapped. For the named place (a town, a
 * facility or community campus, a church, a park), never a residence or unit.
 * Set through /api/mcp and the admin draft API (POST /api/admin/memories), read
 * only through /api/mcp; the database CHECKs repeat both ranges
 * and keep the two columns together (migration 20261106120000_memory_coordinates).
 */
export const coordinatesSchema = z
  .object({
    latitude: z.number().min(-90).max(90).describe("WGS 84 decimal degrees, -90 to 90"),
    longitude: z.number().min(-180).max(180).describe("WGS 84 decimal degrees, -180 to 180"),
  })
  .strict();
export type Coordinates = z.infer<typeof coordinatesSchema>;

/** A row's pair as the API shows it: null unless both columns are set (the CHECK keeps them together). */
export function coordinatesOf(row: { latitude: number | null; longitude: number | null }): Coordinates | null {
  return row.latitude === null || row.longitude === null ? null : { latitude: row.latitude, longitude: row.longitude };
}

/**
 * The fields of an admin draft, without the cross-field refines below. Exported
 * so the MCP tool's input schema derives from the same fields
 * (lib/validations/mcp.ts); `draftMemoryInputSchema` is what `draftMemory` parses.
 */
export const draftMemoryObjectSchema = z.object({
  contributor: z.object({
    name: optionalText(120),
    // Trim and lower-case first, then check the format: zod 4's `z.email().trim()` would check the padded string.
    email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address")),
    relationship: optionalText(120),
    phone: optionalText(40),
  }),
  // The words to store: the sender's verbatim paragraphs, or the light rewrite Rob approved on their behalf. Never trimmed here.
  note: z.string().max(10_000).refine((value) => value.trim().length > 0, { message: "The note needs some words" }),
  // The sender's verbatim excerpt when `note` is a light rewrite of it. Recorded in the ADMIN revision's `before`,
  // never on the row, so the admin History shows exactly what they wrote and what changed. Same limits as `note`, untrimmed.
  originalNote: z.string().max(10_000).refine((value) => value.trim().length > 0, { message: "The original needs some words" }).optional(),
  approxDateText: optionalText(120),
  place: optionalText(200),
  source: z.enum(["EMAIL", "SMS", "OTHER"]),
  sourceRef: z.string().regex(SOURCE_REF_PATTERN, "sourceRef must follow the gmail:/sms:/other: scheme"),
  visibility: z.enum(["PUBLIC", "FAMILY", "PRIVATE"]).default("PUBLIC"),
  // Optional: the named place's position (coordinatesSchema); absent or null stores none.
  coordinates: coordinatesSchema.nullable().optional(),
});

/** What the family admin sends to draft a memory on a sender's behalf (features/memories/draft-memory.ts). */
export const draftMemoryInputSchema = draftMemoryObjectSchema
  .refine((value) => value.sourceRef.startsWith(SOURCE_REF_PREFIX[value.source]), {
    message: "sourceRef must match source (EMAIL ↔ gmail:, SMS ↔ sms:, OTHER ↔ other:)",
    path: ["sourceRef"],
  })
  // An "original" identical to the stored words is a verbatim save mislabelled as a rewrite: the revision would show
  // no change and the sender would be told their note was trimmed. The skill omits originalNote in that case.
  .refine((value) => value.originalNote === undefined || value.originalNote !== value.note, {
    message: "originalNote must differ from note; omit it for a verbatim save",
    path: ["originalNote"],
  });
export type DraftMemoryInput = z.infer<typeof draftMemoryInputSchema>;

/** Admin request to rotate a DRAFT's claim link (features/memories/draft-memory.ts). */
export const reissueClaimLinkSchema = z.object({ memoryId: z.uuid() });
