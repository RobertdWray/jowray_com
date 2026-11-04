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
- `/Users/rob/Documents/active_work/jowray_com/.env` holding `ADMIN_API_SECRET` (never print it). `ADMIN_API_URL` is optional and defaults to `https://www.jowray.com`; set it only to point a test at `http://localhost:3000`.
- The Gmail connector (`get_thread`, `search_threads`, `list_drafts`, `create_draft`).

## Hard rules

- **Verbatim.** The memory text is the sender's own paragraphs about Jo, copied exactly. Never paraphrase, polish or summarise. Rob approves the cut before anything is saved.
- **Email required.** A note with no sender email is not drafted until Rob supplies one.
- **Reply to the sender only.** `to` is the sender's address; `cc` stays empty. Never reply-all.
- **Nobody presses Share.** Only the sender does, on their own claim page. Never open a real person's claim link to "check".
- **No phone numbers, no street or unit details** in the relationship field or the reply (the field is PUBLIC by default).
- **Reissue is revocation.** A second claim link for the same draft kills the one already sent. Only on Rob's explicit say-so.

## Procedure

### 1. Resolve the source

**Gmail popout URL with `thread-f:<decimal>`** → convert to the hex thread id and read the thread:

```bash
printf '%x\n' <decimal>
```

`get_thread(threadId: "<hex>", messageFormat: "PLAIN_TEXT")`. Pick the **sender's** message (not Rob's). Keep **that message's `id`**: it is the `sourceRef` (`gmail:<message id>`), not the thread id.

**`thread-a:r…` URLs cannot be converted.** Use `search_threads` with the sender and subject Rob gives (for example `from:someone@example.com subject:(Jo)`); if nothing matches, ask Rob to paste the message.

**Pasted text or a text message** → use it as given. Ask for the sender's name and email if missing (email is required). For a text message also ask for the number (E.164) and when it arrived (ISO-8601), which only ever appear hashed.

Note whether the message has attachments: the skill cannot download them, so Rob adds them through the claim link before he sends the reply, and the reply mentions them.

### 2. Propose the excerpt

Show Rob, and wait for his yes or edits:

- Sender name and email.
- Suggested relationship, with no street or unit details ("Neighbor at Broadmead", "Friend from Ticonderoga Methodist").
- The verbatim paragraphs about Jo. Drop greetings, logistics, Dad's health, quoted earlier mail and sign-offs.
- `approxDateText` and `place` only if the note states them.
- Whether the message has an attachment.

### 3. Save the draft

Build the input JSON in the scratchpad (never in the repo):

```json
{
  "contributor": { "name": "<name>", "email": "<email>", "relationship": "<relationship or omit>" },
  "note": "<the verbatim excerpt>",
  "approxDateText": "<or omit>",
  "place": "<or omit>",
  "source": "EMAIL",
  "sourceRef": "gmail:<sender's message id>"
}
```

`source` is `EMAIL`, `SMS` or `OTHER`. `sourceRef` by the scheme (`lib/source-ref.ts`):
- Gmail: `gmail:<message id>`.
- Text message: `sms:` + first 32 hex of `sha256("<E.164>|<ISO-8601 timestamp>")`.
- Anything else: `other:` + first 32 hex of `sha256("<lower-cased email>|<full original text>")` (the whole original, not the excerpt).

```bash
printf '%s' '+14105551234|2026-11-03T14:05:00Z' | shasum -a 256 | cut -c1-32
```

Run the script (it prints the host it is about to call, then `memoryId` and `claimLink`):

```bash
npx tsx --env-file=/Users/rob/Documents/active_work/jowray_com/.env /Users/rob/Documents/active_work/jowray_com/scripts/draft-memory.ts --input <json-file>
```

Then delete the JSON file.

- **409 duplicate, status DRAFT**: a draft already exists for this message. Offer `--reissue <memoryId>` and warn that any link already sent stops working. Only on Rob's explicit yes:
  `npx tsx --env-file=… scripts/draft-memory.ts --reissue <memoryId>`
- **409 duplicate, status PENDING or later**: the person already shared it. Stop; tell Rob.
- **401**: `ADMIN_API_SECRET` is missing locally or differs from Vercel. Stop.
- **429**: the daily memory budget is spent. Try later.

### 4. Draft Rob's reply

`list_drafts(query: "to:<sender email>")` first. If a draft to this address in this thread already exists, show it to Rob and stop.

Otherwise `create_draft` with:
- `replyToMessageId`: the sender's message id (the same id as in `sourceRef`).
- `to`: `["<sender email>"]`. No `cc`, no `bcc`.
- `subject`: `Re: <original subject>`.
- `body`: plain text, in Rob's voice. Short, warm, first person. Thank them for the specific memory (name it in a few words, do not quote the note back at length). One line that it is saved to Jo's memorial in their own words. The claim link on its own line. "Change anything, add a photo or a recording, and press Share when it's right." A clean exit: "No need to do anything if you'd rather not." If the message had an attachment, one line that the photo can be added on that page. Never grovel, never include anyone's phone number, no "I know you're busy".

Rob reads and sends the draft himself. The skill never sends.

### 5. Report

Give Rob: the Gmail draft `viewUrl`, the claim link (a bearer token: anyone with it can edit the memory), and the reminder that nothing is public until the sender presses Share. Rob watches `Memory.status` move DRAFT → PENDING in Prisma Studio or the Neon console; the family-admin alert email fires once the person shares.

## What the site does with a draft

- `Memory.status = DRAFT`, `consentedAt = null`, `source = EMAIL|SMS|OTHER`, `sourceRef` unique. One Contributor per draft (`contactOptIn` on, like the /share form).
- The claim page shows "A memory of Jo, in your words", the editable fields, the two preference checkboxes and one button, **Share this memory**. Pressing it sets `status = PENDING` and stamps `consentedAt` / `consentVersion`. A repeated press never restamps.
- No site email, before or after Share. The reconcile cron skips these memories, so it never rotates the token behind the link Rob sent.
- Reissue (`--reissue`) is allowed only while DRAFT.
