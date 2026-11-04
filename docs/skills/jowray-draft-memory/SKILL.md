---
name: jowray-draft-memory
description: Turns a condolence email, text message or other note that mentions Jo into a DRAFT memory on jowray.com and drafts Rob's Gmail reply carrying the claim link. Requires the Gmail connector and the jowray_com repo on this machine.
disable-model-invocation: true
---

# Draft a memory of Jo on someone's behalf

Condolence notes arrive in Rob's Gmail with real memories of Jo inside them. This skill saves the sender's own words as a **DRAFT** memory on jowray.com (invisible and silent until the sender presses **Share this memory** on their claim page) and drafts the reply Rob sends from Gmail with the claim link. The site never emails the sender; Rob's reply is the only message they get.

Design and rulings: `docs/plans/2026-11-03-draft-memory-on-behalf.md` in the repo.

## Prerequisites

- The repo at `/Users/rob/Documents/active_work/jowray_com` with `node_modules` installed (Node 20+).
- `/Users/rob/Documents/active_work/jowray_com/.env` holding `ADMIN_API_SECRET` (never print it). Real runs pass `--prod`; a local test sets `ADMIN_API_URL=http://localhost:3000` instead. There is no default target.
- The Gmail connector (`get_thread`, `search_threads`, `list_drafts`, `get_draft`, `create_draft`, `update_draft`). Check which mailbox it is (`authuser=` in any `viewUrl`): the condolence notes may live in a different account from the one this session is connected to.

### Preflight (every run)

The checkout is shared with other agents and can be stale or on a feature branch. Before running the script:

```bash
cd /Users/rob/Documents/active_work/jowray_com && git fetch -q origin main && git diff --quiet origin/main -- scripts/draft-memory.ts lib/source-ref.ts docs/skills/jowray-draft-memory/SKILL.md && echo "script matches origin/main" || echo "STOP: the checkout's script or skill differs from origin/main"
```

Stop if it says STOP (or if `scripts/draft-memory.ts` is missing: the feature has not merged). If `npx tsx` fails on an import, run `npm ci` in that checkout first.

## Hard rules

- **Verbatim.** The memory text is the sender's own paragraphs about Jo, copied exactly. Never paraphrase, polish or summarise. Rob approves the cut before anything is saved.
- **Email required.** A note with no sender email is not drafted until Rob supplies one.
- **Reply to the sender only.** `to` is the sender's address; `cc` stays empty. Never reply-all.
- **Nobody presses Share.** Only the sender does, on their own claim page. Never open a real person's claim link to "check".
- **No phone numbers, no street or unit details** in the relationship field or the reply (the field is PUBLIC by default).
- **Reissue is revocation.** A second claim link for the same draft kills the one already sent. Only on Rob's explicit say-so, and only after step 3's Gmail check below.
- **Rob never presses Share, and never edits a draft on its page.** The only button on a draft's page is Share, and Share is the sender's consent. If Rob opens the link to add an attachment, he uses the file control only and closes the tab; a typo is fixed by telling the sender, or by withdrawing and redrafting (follow-up F12). A `consentedAt` earlier than the time Rob sent the reply means Rob pressed it: flag it.

## Procedure

### 1. Resolve the source

**Gmail popout URL with `thread-f:<decimal>`** → convert to the hex thread id and read the thread:

```bash
printf '%x\n' <decimal>
```

`get_thread(threadId: "<hex>", messageFormat: "PLAIN_TEXT")`. Pick the **sender's** message (not Rob's). Keep **that message's `id`**: it is the `sourceRef` (`gmail:<message id>`), not the thread id.

**`thread-a:r…` URLs cannot be converted.** Use `search_threads` with the sender and subject Rob gives (for example `from:someone@example.com subject:(Jo)`); if nothing matches, ask Rob to paste the message.

**Pasted text or a text message** → use it as given. Ask for the sender's name and email if missing (email is required). For a text message also ask for the number (E.164) and when it arrived (ISO-8601), which only ever appear hashed.

Note whether the message has attachments: the skill cannot download them. The reply invites the sender to add the photo on their own page (step 4); Rob does not add it for them (hard rule above; `--attach` is follow-up F13).

### 2. Propose the excerpt

Show Rob, and wait for his yes or edits:

- Sender name and email.
- Suggested relationship, with no street or unit details ("Neighbor at Broadmead", "Friend from Ticonderoga Methodist").
- The verbatim paragraphs about Jo. Drop greetings, logistics, Dad's health, quoted earlier mail (`>` lines), signatures and "Sent from my iPhone". The **one** normalisation allowed: join lines that a mail client hard-wrapped inside a paragraph; keep the blank-line paragraph breaks. Show the exact string that will be stored in a fenced block, so Rob sees the line breaks the sender will see on their page.
- `approxDateText` and `place` only if the note states them.
- Whether the message has an attachment.

### 3. Save the draft

Build the input JSON in the scratchpad (never in the repo). Describe **where the words came from** in `sourceInput`; the script derives `source` and `sourceRef` through the canonical builders in `lib/source-ref.ts`. Never compute a `sourceRef` by hand.

```json
{
  "contributor": { "name": "<name>", "email": "<email>", "relationship": "<relationship or omit>" },
  "note": "<the verbatim excerpt>",
  "approxDateText": "<or omit>",
  "place": "<or omit>",
  "sourceInput": { "kind": "gmail", "messageId": "<the sender's message id>" }
}
```

`sourceInput` is one of:
- `{ "kind": "gmail", "messageId": "<sender's message id>" }` → `source: EMAIL`.
- `{ "kind": "sms", "number": "<E.164>", "sentAt": "<ISO-8601 with an explicit zone, e.g. 2026-11-03T14:05-05:00>", "text": "<the full text message>" }` → `source: SMS`. The zone is required (a zone-less time would hash differently on another machine). Keyed on number, the minute (UTC) and the text, so a retyped zone or seconds cannot make a second draft and two texts in one minute stay distinct.
- `{ "kind": "other", "originalText": "<the whole original message, not the excerpt>" }` → `source: OTHER`. The dedup key uses `contributor.email`; an `email` field here must match it.

Run the script (it prints the host it is about to call, then `memoryId` and `claimLink`):

```bash
npx tsx --env-file=/Users/rob/Documents/active_work/jowray_com/.env /Users/rob/Documents/active_work/jowray_com/scripts/draft-memory.ts --prod --input <json-file>
```

Then delete the JSON file.

- **409 duplicate, status DRAFT**: a draft already exists for this message, and a link for it may already be in Gmail. **Check Gmail before offering anything.** Look in **this sender's thread** (the `threadId` from step 1; for a text or pasted note, `list_drafts(query: "to:<sender email>")` and `search_threads(query: "in:sent to:<sender email> jowray.com/m/")`):
  - A Gmail **draft** in that thread with a `/m/` link → probably the link for this memory, and probably still live. The site cannot confirm a link without its token, so say so: show Rob the draft and the `memoryId` from the 409, and let him decide between sending it as is and a reissue (which replaces the link in that draft).
  - A **sent** reply in that thread with a `/m/` link → the person most likely holds a working link. Do not reissue unless Rob says, in so many words, that he wants to revoke it (for example because it leaked or he knows a reissue happened after it was sent).
  - Neither → the link was lost (a session died between the POST and the Gmail draft). Offer `--prod --reissue <memoryId>` and say that any link already sent stops working. Only on Rob's explicit yes.
  - After any reissue, put the new link into the existing Gmail draft with `update_draft` if one exists; never leave a draft carrying a dead link. A `/m/` link found for the same person but in another thread belongs to another memory: leave it alone.
- **409 duplicate, status PENDING or later**: the person already shared it. Stop; tell Rob.
- **401**: `ADMIN_API_SECRET` is missing locally or differs from Vercel. Stop.
- **429**: the daily memory budget is spent. Try later.

### 4. Draft Rob's reply

`list_drafts(query: "to:<sender email>")` first. If a draft to this address in this thread already exists: if it already carries this memory's `claimLink`, show it to Rob and stop; if it does not (Rob started a reply by hand), `update_draft` it to add the link and the lines below, keeping his words, and show him the result.

Otherwise `create_draft`:
- **Gmail source** (`sourceInput.kind = gmail`): `replyToMessageId` = the sender's message id (the same id as in `sourceRef`); `subject` = `Re: <original subject>` with any existing leading `Re:` / `RE:` / `Fwd:` stripped first, so it never reads `Re: Re:`.
- **Text message or pasted note** (no Gmail message to reply to): omit `replyToMessageId`; `subject` = `A memory of Jo`.
- `to`: `["<sender email>"]`. No `cc`, no `bcc`. The connector does **not** inherit recipients from the original (probe, 2026-11-04), so this list is exactly who gets the link.
- `body`: plain text, in Rob's voice. Short, warm, first person. Thank them for the specific memory (name it in a few words, do not quote the note back at length). One line that it is saved to Jo's memorial in their own words. The claim link on its own line. "Change anything, add a photo or a recording, and press Share when it's right." A clean exit: "No need to do anything if you'd rather not." If the message had an attachment, one line that the photo can be added on that page (Rob does not add it for them). Never grovel, never include anyone's phone number, no "I know you're busy".

**Then read the draft back** (`get_draft`, or `list_drafts` with `DRAFT_VIEW_FULL`) and stop if `to` is not exactly the sender, or `cc` / `bcc` is not empty: a CC'd person would hold the bearer link and could edit or Share the memory.

Rob reads and sends the draft himself. The skill never sends.

### 5. Report

Give Rob: the Gmail draft `viewUrl`, the claim link (a bearer token: anyone with it can edit the memory), and the reminder that nothing is public until the sender presses Share. Rob watches `Memory.status` move DRAFT → PENDING in Prisma Studio or the Neon console; the family-admin alert email fires once the person shares.

## What the site does with a draft

- `Memory.status = DRAFT`, `consentedAt = null`, `source = EMAIL|SMS|OTHER`, `sourceRef` unique. One Contributor per draft, with `contactOptIn` **off** until the person presses Share (the page prefills both checkboxes on, like /share, and Share records their choice).
- The claim page shows "A memory of Jo, in your words", the editable fields, the two preference checkboxes and one button, **Share this memory**. Pressing it sets `status = PENDING` and stamps `consentedAt` / `consentVersion`. A repeated press never restamps.
- No site email, before or after Share. The reconcile cron skips these memories, so it never rotates the token behind the link Rob sent.
- Reissue (`--reissue`) is allowed only while DRAFT.
- The family-admin alert is not sent for a DRAFT; the cron sends it within ten minutes of the person pressing Share, dated by that moment.
