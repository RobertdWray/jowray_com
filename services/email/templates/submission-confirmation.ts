import type { EmailAttachment, MediaKind, MemoryMediaSummary, SubmissionConfirmationContent, SubmissionMemoryContent } from "../types";
import { buildMemoryConfirmation, CONFIRMATION_COPY, describeReceived, MEMORY_CONFIRMATION_SUBJECT, type RenderedMemoryConfirmation } from "./memory-confirmation";
import {
  BODY_FONT,
  brandAttachments,
  buildMediaCards,
  type Card,
  cardHeading,
  cardHtml,
  cleanNote,
  cleanOptional,
  CONTENT_ID,
  detailRow,
  DISPLAY_FONT,
  escapeHtml,
  headlineRow,
  HEART_ROW,
  JO_RED_DEEP,
  leadRow,
  MAX_PREVIEWS,
  NAME_MAX,
  NOTE_MAX,
  noteToHtml,
  renderCardHtml,
  renderCardText,
  renderDocument,
  STITCHED_HEART_ROW,
  stripControl,
  usablePreview,
  WALNUT,
  WALNUT_SOFT,
  WOOD_LIGHT,
} from "./shared";

/**
 * The receipt for a whole send of several memories (Task 15, D3/D14). One
 * memory renders exactly as the single-memory confirmation. Several render
 * with every private link first, then one card per memory with a text link
 * instead of the red button; the words are shortened only when the HTML would
 * otherwise pass Gmail's clipping size, so the links can never be hidden.
 *
 * Pure module (no server-only, no env): also usable by `scripts/*` under tsx.
 */

/** Gmail clips HTML over 102 KB (C38); stay under the repo's 100 KB template ceiling with a margin for the clipping marker. */
export const SUBMISSION_HTML_BUDGET_BYTES = 96 * 1024;
/** Note ceilings tried in turn until the HTML fits the budget; the first is the form's own limit, so a fitting email is never shortened. */
const NOTE_CAPS = [NOTE_MAX, 2_000, 800, 300, 120] as const;
const SHORTENED = "… read it all from its link.";
const missingLead = (count: number) => (count === 1 ? "One file didn't arrive — add it again from this link:" : "These files didn't arrive — add them again from this link:");
const MEMORY_BUTTON = "See or add to this memory";
const PRIVACY_PLURAL = "Keep these links private: anyone who has one can edit that memory.";
const LINKS_HEADING = "Your private links";

export function submissionConfirmationSubject(count: number): string {
  return count === 1 ? MEMORY_CONFIRMATION_SUBJECT : `Thank you for sharing ${count} memories`;
}

/** "Memory 2 · Summer 1985 · Lake George": the stable heading plus whatever details were given. */
export function memoryLabel(memory: { position: number; approxDateText?: string | null; place?: string | null }): string {
  const when = cleanOptional(memory.approxDateText, 120);
  const where = cleanOptional(memory.place, 200);
  return [`Memory ${memory.position}`, when, where].filter((part): part is string => part !== null).join(" · ");
}

interface PreparedMemory {
  position: number;
  label: string;
  when: string | null;
  where: string | null;
  note: string;
  link: string;
  cards: Card[];
  attachments: EmailAttachment[];
  badges: Set<MediaKind>;
  missing: string[];
  received: string;
}

/**
 * At most four previews in the whole send, in order, and every preview id
 * unique across memories (the per-memory builder only checks within one).
 */
function capPreviews(memories: SubmissionMemoryContent[]): MemoryMediaSummary[][] {
  const seen = new Set<string>();
  let previews = 0;
  return memories.map((memory) =>
    memory.media.map((item) => {
      if (!item.preview) {
        return item;
      }
      if (!CONTENT_ID.test(item.preview.contentId)) {
        throw new Error(`preview content id is not cid-safe: ${JSON.stringify(item.preview.contentId)}`);
      }
      if (seen.has(item.preview.contentId)) {
        throw new Error(`duplicate preview content id: ${item.preview.contentId}`);
      }
      seen.add(item.preview.contentId);
      const usable = item.kind !== "VOICE" && usablePreview(item.preview) && previews < MAX_PREVIEWS;
      if (usable) {
        previews += 1;
        return item;
      }
      return { ...item, preview: null };
    })
  );
}

function prepare(memories: SubmissionMemoryContent[], noteCap: number): PreparedMemory[] {
  const media = capPreviews(memories);
  return memories.map((memory, i) => {
    const full = memory.note ? cleanNote(memory.note) : "";
    const note = full.length > noteCap ? `${full.slice(0, noteCap).trimEnd()}${SHORTENED}` : full;
    const { cards, attachments, badges } = buildMediaCards(media[i]!);
    return {
      position: memory.position,
      label: memoryLabel(memory),
      when: cleanOptional(memory.approxDateText, 120),
      where: cleanOptional(memory.place, 200),
      note,
      link: stripControl(memory.claimLink),
      cards,
      attachments: attachments.map((a) => ({ ...a, filename: `memory-${memory.position}-${a.filename}` })),
      badges,
      missing: memory.missingFiles.map((name) => cleanOptional(name, 255)).filter((name): name is string => name !== null),
      received: describeReceived(media[i]!, full.length > 0),
    };
  });
}

function textLinkRow(link: string): string {
  const safeLink = escapeHtml(link);
  return [
    `<tr><td style="padding:18px 0 0 0;font-family:${BODY_FONT};font-size:20px;line-height:1.5;"><a href="${safeLink}" style="color:${JO_RED_DEEP};font-weight:700;text-decoration:underline;">${escapeHtml(MEMORY_BUTTON)}</a></td></tr>`,
    `<tr><td style="padding:6px 0 0 0;font-family:${BODY_FONT};font-size:15px;line-height:1.5;color:${WALNUT_SOFT};word-break:break-all;">Or copy this link: <a href="${safeLink}" style="color:${JO_RED_DEEP};text-decoration:underline;">${safeLink}</a></td></tr>`,
  ].join("\n");
}

function missingRows(missing: string[]): string {
  if (missing.length === 0) {
    return "";
  }
  return `<tr><td style="padding:18px 0 0 0;font-family:${BODY_FONT};font-size:17px;line-height:1.5;color:${WALNUT};">
<div style="font-weight:700;">${escapeHtml(missingLead(missing.length))}</div>
${missing.map((name) => `<div style="word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(name)}</div>`).join("\n")}
</td></tr>`;
}

function render(input: SubmissionConfirmationContent, noteCap: number): RenderedMemoryConfirmation {
  const name = cleanOptional(input.name, NAME_MAX);
  const relationship = cleanOptional(input.relationship, 120);
  const memories = prepare(input.memories, noteCap);
  const count = memories.length;
  const greeting = name ? `Thank you, ${name}.` : "Thank you.";
  const lead = `Your ${count} memories are on their way to Richard, Rob and Tracy. We read every single one, usually more than once.`;
  const subject = submissionConfirmationSubject(count);

  // ---- text part -----------------------------------------------------------
  const text = [
    CONFIRMATION_COPY.headline,
    "",
    `${greeting} ${lead}`,
    "",
    `${LINKS_HEADING} (${PRIVACY_PLURAL.charAt(0).toLowerCase()}${PRIVACY_PLURAL.slice(1, -1)}):`,
    ...memories.flatMap((m) => [`- ${m.label}`, `  ${m.link}`]),
    ...(name || relationship ? ["", ...(name ? [`Your name: ${name}`] : []), ...(relationship ? [`How you knew Jo: ${relationship}`] : [])] : []),
    ...memories.flatMap((m) => [
      "",
      m.label,
      `What you sent: ${m.received}`,
      ...(m.when ? [`When: ${m.when}`] : []),
      ...(m.where ? [`Where: ${m.where}`] : []),
      ...(m.note.length > 0 ? ["Your memory of Jo:", m.note] : []),
      ...(m.cards.length > 0 ? ["Files:", ...m.cards.map(renderCardText)] : []),
      ...(m.missing.length > 0 ? [missingLead(m.missing.length), ...m.missing.map((f) => `- ${f}`)] : []),
      `${MEMORY_BUTTON}:`,
      m.link,
    ]),
    "",
    CONFIRMATION_COPY.closer,
    "",
    CONFIRMATION_COPY.madeWithLove,
    CONFIRMATION_COPY.questions,
    "",
    PRIVACY_PLURAL,
  ].join("\n");

  // ---- html part -----------------------------------------------------------
  const linksCard = cardHtml(
    [
      cardHeading(LINKS_HEADING, 12),
      ...memories.map(
        (m) =>
          `<tr><td style="padding:0 0 12px 0;font-family:${BODY_FONT};font-size:20px;line-height:1.5;"><a href="${escapeHtml(m.link)}" style="color:${JO_RED_DEEP};font-weight:700;text-decoration:underline;">${escapeHtml(m.label)}</a></td></tr>`
      ),
      `<tr><td style="padding:6px 0 0 0;font-family:${BODY_FONT};font-size:17px;line-height:1.5;color:${WALNUT_SOFT};">${escapeHtml(PRIVACY_PLURAL)}</td></tr>`,
    ].join("\n")
  );
  const whoRows = [name ? detailRow("Your name", name) : "", relationship ? detailRow("How you knew Jo", relationship) : ""].join("");
  const whoCard = whoRows.length > 0 ? cardHtml([cardHeading("About you", 12), whoRows].join("\n")) : "";
  const memoryCards = memories.map((m) =>
    cardHtml(
      [
        cardHeading(m.label),
        `<tr><td style="padding:0 0 18px 0;font-family:${BODY_FONT};font-size:17px;line-height:1.4;color:${WALNUT_SOFT};">${escapeHtml(m.received.charAt(0).toUpperCase() + m.received.slice(1))}.</td></tr>`,
        m.when ? detailRow("When", m.when) : "",
        m.where ? detailRow("Where", m.where) : "",
        m.note.length > 0
          ? `<tr><td style="padding:4px 0 0 0;font-family:${BODY_FONT};">
<div style="padding:0 0 6px 0;font-size:17px;line-height:1.4;color:${WALNUT_SOFT};">Your memory of Jo</div>
<div style="font-size:20px;line-height:1.5;color:${WALNUT};white-space:pre-wrap;word-break:break-word;">${noteToHtml(m.note)}</div>
</td></tr>`
          : "",
        m.cards.map((c) => renderCardHtml(c, m.link)).join("\n"),
        missingRows(m.missing),
        textLinkRow(m.link),
      ].join("\n")
    )
  );
  const spacer = `<tr><td style="padding:0 0 20px 0;border-bottom:0 solid ${WOOD_LIGHT};"></td></tr>`;
  const body = [
    HEART_ROW,
    "",
    headlineRow(CONFIRMATION_COPY.headline),
    leadRow(`${escapeHtml(greeting)} ${escapeHtml(lead)}`),
    "",
    linksCard,
    spacer,
    ...(whoCard ? [whoCard, spacer] : []),
    ...memoryCards.flatMap((card) => [card, spacer]),
    `<tr><td align="center" style="padding:12px 0 36px 0;font-family:${DISPLAY_FONT};font-size:20px;line-height:1.5;font-style:italic;color:${WALNUT_SOFT};">${escapeHtml(CONFIRMATION_COPY.closer)}</td></tr>`,
    "",
    STITCHED_HEART_ROW,
    `<tr><td align="center" style="padding:0 0 8px 0;font-family:${DISPLAY_FONT};font-size:20px;line-height:1.4;color:${WALNUT};">${escapeHtml(CONFIRMATION_COPY.madeWithLove)}</td></tr>`,
    CONFIRMATION_COPY.questionsHtml(BODY_FONT, JO_RED_DEEP),
  ].join("\n");
  const html = renderDocument({ title: subject, preheader: CONFIRMATION_COPY.preheader, body });

  const badges = new Set<MediaKind>();
  for (const m of memories) {
    for (const kind of m.badges) {
      badges.add(kind);
    }
  }
  const attachments: EmailAttachment[] = [...brandAttachments(badges), ...memories.flatMap((m) => m.attachments)];
  return { subject, text, html, attachments };
}

export function buildSubmissionConfirmation(input: SubmissionConfirmationContent): RenderedMemoryConfirmation {
  if (input.memories.length === 0) {
    throw new Error("a send receipt needs at least one memory");
  }
  const [only] = input.memories;
  if (input.memories.length === 1 && only && only.missingFiles.length === 0) {
    // One memory: exactly today's confirmation (D14 leaves one-memory emails unchanged).
    return buildMemoryConfirmation({
      name: input.name,
      relationship: input.relationship,
      approxDateText: only.approxDateText,
      place: only.place,
      note: only.note,
      media: only.media,
      claimLink: only.claimLink,
    });
  }
  let rendered = render(input, NOTE_CAPS[0]);
  for (const cap of NOTE_CAPS.slice(1)) {
    if (Buffer.byteLength(rendered.html, "utf8") <= SUBMISSION_HTML_BUDGET_BYTES) {
      break;
    }
    rendered = render(input, cap);
  }
  return rendered;
}
