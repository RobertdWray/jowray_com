import type { EmailAttachment, MediaKind, SubmissionConfirmationContent, SubmissionMemoryContent } from "../types";
import { buildMemoryConfirmation, CONFIRMATION_COPY, describeReceived, MEMORY_CONFIRMATION_SUBJECT, type RenderedMemoryConfirmation } from "./memory-confirmation";
import {
  BODY_FONT,
  brandAttachments,
  buildMediaCards,
  type Card,
  cardHeading,
  cardHtml,
  DISPLAY_FONT,
  escapeHtml,
  headlineRow,
  HEART_ROW,
  JO_RED_DEEP,
  leadRow,
  renderCardHtml,
  renderCardText,
  renderDocument,
  STITCHED_HEART_ROW,
  stripControl,
  WALNUT,
  WALNUT_SOFT,
  WOOD_LIGHT,
} from "./shared";

/**
 * The receipt for a whole send of several memories (Task 15, D3/D14). One
 * memory renders exactly as the single-memory confirmation. Several render
 * with every private link first, then one card per memory with a text link
 * instead of the red button.
 *
 * Fixed content (issue #46, D1, 2026-11-05): "Memory N" headings, a "what you
 * sent" line from counts, badge cards by kind and length, a count of files that
 * did not arrive, and the links. No name, relationship, date, place, note,
 * filename or uploaded picture; nothing the visitor typed or uploaded. The Gmail-size fallback no longer shortens words
 * (there are none): a send whose per-file cards would pass the budget renders
 * without the cards, and each memory's "what you sent" line still names the
 * kinds and counts. The largest possible send (ten memories, ten files each)
 * is proven to take that path and stay under the budget by its test.
 *
 * Pure module (no server-only, no env): also usable by `scripts/*` under tsx.
 */

/** Gmail clips HTML over 102 KB (C38); stay under the repo's 100 KB template ceiling with a margin for the clipping marker. */
export const SUBMISSION_HTML_BUDGET_BYTES = 96 * 1024;
const missingLead = (count: number) => (count === 1 ? "One file didn't arrive — add it again from this link:" : `${count} files didn't arrive — add them again from this link:`);
const MEMORY_BUTTON = "See or add to this memory";
const PRIVACY_PLURAL = "Keep these links private: anyone who has one can edit that memory.";
const LINKS_HEADING = "Your private links";
const WORDS_ON_PAGE = "Your words and details are on each memory's private page, exactly as you sent them.";

/** The copy that changes with the number of memories; one memory reaches this layout only when a file is missing. */
function wording(count: number) {
  const several = count > 1;
  return {
    lead: several
      ? `Your ${count} memories are on their way to Richard, Rob and Tracy. We read every single one, usually more than once.`
      : CONFIRMATION_COPY.leadRest,
    linksHeading: several ? LINKS_HEADING : "Your private link",
    privacy: several ? PRIVACY_PLURAL : CONFIRMATION_COPY.privacy,
    linksNote: several ? "keep them private: anyone who has one can edit that memory" : "keep it private: anyone who has it can edit this memory",
  };
}

export function submissionConfirmationSubject(count: number): string {
  return count === 1 ? MEMORY_CONFIRMATION_SUBJECT : `Thank you for sharing ${count} memories`;
}

/** "Memory 2": the stable heading, and nothing the contributor typed. */
export function memoryLabel(memory: { position: number }): string {
  return `Memory ${memory.position}`;
}

interface PreparedMemory {
  position: number;
  label: string;
  link: string;
  cards: Card[];
  attachments: EmailAttachment[];
  badges: Set<MediaKind>;
  missing: number;
  received: string;
}

function prepare(memories: SubmissionMemoryContent[], withCards: boolean): PreparedMemory[] {
  return memories.map((memory) => {
    const { cards, attachments, badges } = withCards ? buildMediaCards(memory.media, "contributor") : { cards: [], attachments: [], badges: new Set<MediaKind>() };
    return {
      position: memory.position,
      label: memoryLabel(memory),
      link: stripControl(memory.claimLink),
      cards,
      attachments: attachments.map((a) => ({ ...a, filename: `memory-${memory.position}-${a.filename}` })),
      badges,
      missing: Math.max(0, Math.floor(memory.missingFiles)),
      received: describeReceived(memory.media, memory.hasWords),
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

function missingRow(missing: number): string {
  if (missing === 0) {
    return "";
  }
  return `<tr><td style="padding:18px 0 0 0;font-family:${BODY_FONT};font-size:17px;line-height:1.5;color:${WALNUT};font-weight:700;">${escapeHtml(missingLead(missing))}</td></tr>`;
}

function render(input: SubmissionConfirmationContent, options: { cards: boolean }): RenderedMemoryConfirmation {
  const memories = prepare(input.memories, options.cards);
  const count = memories.length;
  const greeting = CONFIRMATION_COPY.greeting;
  const words = wording(count);
  const lead = words.lead;
  const subject = submissionConfirmationSubject(count);

  // ---- text part -----------------------------------------------------------
  const text = [
    CONFIRMATION_COPY.headline,
    "",
    `${greeting} ${lead}`,
    "",
    `${words.linksHeading} (${words.linksNote}):`,
    ...memories.flatMap((m) => [`- ${m.label}`, `  ${m.link}`]),
    "",
    WORDS_ON_PAGE,
    ...memories.flatMap((m) => [
      "",
      m.label,
      `What you sent: ${m.received}`,
      ...(m.cards.length > 0 ? ["Files:", ...m.cards.map(renderCardText)] : []),
      ...(m.missing > 0 ? [missingLead(m.missing)] : []),
      `${MEMORY_BUTTON}:`,
      m.link,
    ]),
    "",
    CONFIRMATION_COPY.closer,
    "",
    CONFIRMATION_COPY.madeWithLove,
    CONFIRMATION_COPY.questions,
    "",
    words.privacy,
  ].join("\n");

  // ---- html part -----------------------------------------------------------
  const linksCard = cardHtml(
    [
      cardHeading(words.linksHeading, 12),
      ...memories.map(
        (m) =>
          `<tr><td style="padding:0 0 12px 0;font-family:${BODY_FONT};font-size:20px;line-height:1.5;"><a href="${escapeHtml(m.link)}" style="color:${JO_RED_DEEP};font-weight:700;text-decoration:underline;">${escapeHtml(m.label)}</a></td></tr>`
      ),
      `<tr><td style="padding:6px 0 0 0;font-family:${BODY_FONT};font-size:17px;line-height:1.5;color:${WALNUT_SOFT};">${escapeHtml(words.privacy)}</td></tr>`,
      `<tr><td style="padding:12px 0 0 0;font-family:${BODY_FONT};font-size:17px;line-height:1.5;color:${WALNUT};">${escapeHtml(WORDS_ON_PAGE)}</td></tr>`,
    ].join("\n")
  );
  const memoryCards = memories.map((m) =>
    cardHtml(
      [
        cardHeading(m.label),
        `<tr><td style="padding:0 0 18px 0;font-family:${BODY_FONT};font-size:17px;line-height:1.4;color:${WALNUT_SOFT};">${escapeHtml(m.received.charAt(0).toUpperCase() + m.received.slice(1))}.</td></tr>`,
        m.cards.map((c) => renderCardHtml(c, m.link)).join("\n"),
        missingRow(m.missing),
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
  if (input.memories.length === 1 && only && only.missingFiles === 0) {
    // One memory: exactly today's confirmation (D14 leaves one-memory emails unchanged).
    return buildMemoryConfirmation({ hasWords: only.hasWords, media: only.media, claimLink: only.claimLink });
  }
  const withCards = render(input, { cards: true });
  if (Buffer.byteLength(withCards.html, "utf8") <= SUBMISSION_HTML_BUDGET_BYTES) {
    return withCards;
  }
  // Too big for Gmail with every file as a card: keep the links and the per-memory counts, drop the cards.
  return render(input, { cards: false });
}
