import { z } from "zod";

import { MAX_FILES_PER_MEMORY } from "@/lib/media-types";

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

const NEEDS_CONTENT = "Add a file, a recording, or a few words";

/** Who is sending, and the preferences asked once per send (D5). */
const contributorFields = {
  name: optionalText(120),
  relationship: optionalText(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional()
    .refine((value) => value === null || value === undefined || z.email().safeParse(value).success, {
      message: "Enter a valid email address",
    }),
  visibility: z.enum(["PUBLIC", "FAMILY", "PRIVATE"]).default("PUBLIC"),
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

/**
 * Where a validation issue sits in a send: the path `["memories", 2, "files", 0, "size"]`
 * names card 2 and its first file; a top-level field has neither index.
 */
export function submissionIssueLocation(issue: { path: ReadonlyArray<PropertyKey>; message: string }): {
  memoryIndex: number | null;
  fileIndex: number | null;
  message: string;
} {
  const [root, memoryIndex, field, fileIndex] = issue.path;
  const atMemory = root === "memories" && typeof memoryIndex === "number" ? memoryIndex : null;
  const atFile = atMemory !== null && field === "files" && typeof fileIndex === "number" ? fileIndex : null;
  return { memoryIndex: atMemory, fileIndex: atFile, message: issue.message };
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

/** What the family admin sends to draft a memory on a sender's behalf (features/memories/draft-memory.ts). */
export const draftMemoryInputSchema = z.object({
  contributor: z.object({
    name: optionalText(120),
    // Trim and lower-case first, then check the format: zod 4's `z.email().trim()` would check the padded string.
    email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address")),
    relationship: optionalText(120),
    phone: optionalText(40),
  }),
  // Verbatim: the sender's own paragraphs, never trimmed or rewritten here.
  note: z.string().max(10_000).refine((value) => value.trim().length > 0, { message: "The note needs some words" }),
  approxDateText: optionalText(120),
  place: optionalText(200),
  source: z.enum(["EMAIL", "SMS", "OTHER"]),
  sourceRef: z.string().regex(SOURCE_REF_PATTERN, "sourceRef must follow the gmail:/sms:/other: scheme"),
  visibility: z.enum(["PUBLIC", "FAMILY", "PRIVATE"]).default("PUBLIC"),
});
export type DraftMemoryInput = z.infer<typeof draftMemoryInputSchema>;

/** Admin request to rotate a DRAFT's claim link (features/memories/draft-memory.ts). */
export const reissueClaimLinkSchema = z.object({ memoryId: z.uuid() });
