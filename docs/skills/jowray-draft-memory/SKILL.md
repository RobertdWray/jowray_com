---
name: jowray-draft-memory
description: Turns a condolence email, text message or other note that mentions Jo into a DRAFT memory on jowray.com and drafts Rob's Gmail reply carrying the claim link. Requires the Gmail connector and the jowray connector (or, as a fallback, the jowray_com repo on Rob's Mac).
disable-model-invocation: true
---

# Draft a memory of Jo on someone's behalf

Condolence notes arrive in Rob's Gmail with real memories of Jo inside them. This skill saves the sender's words as a **DRAFT** memory on jowray.com (invisible and silent until the sender presses **Share this memory** on their claim page) and drafts the reply Rob sends from Gmail with the claim link. The site never emails the sender; Rob's reply is the only message they get.

Design and rulings: `docs/plans/2026-11-03-draft-memory-on-behalf.md` (the feature), `docs/plans/2026-11-05-draft-skill-rewrite-prompts.md` (verbatim-or-rewrite choice, prompts, `originalNote`) and `docs/plans/2026-11-06-mcp-endpoint.md` (the connector and coordinates) in the repo.

## Prerequisites

- **The jowray connector** (the custom connector at `https://www.jowray.com/api/mcp`; setup in `docs/environment.md`, "MCP connector"): `list_memories`, `get_memory`, `draft_memory`, `set_coordinates`, `reissue_claim_link`, and `update_memory` for the 409 fixes in step 3. It works from any Claude surface. The five tools that change data ask Rob before they run; an approval prompt is not Rob's answer to a step 2b question, and answering a question is not approval of a tool call.
- **Fallback, only when the connector's tools are absent:** the repo at `/Users/rob/Documents/active_work/jowray_com` with `node_modules` installed (Node 20+), and its `.env` holding `ADMIN_API_SECRET` (never print it). Real runs pass `--prod`; a local test sets `ADMIN_API_URL=http://localhost:3000` instead. There is no default target. This path takes the same JSON (coordinates included) but runs only on Rob's Mac.
- The Gmail connector (`get_thread`, `search_threads`, `list_drafts`, `get_draft`, `create_draft`, `update_draft`). Check which mailbox it is (`authuser=` in any `viewUrl`): the condolence notes may live in a different account from the one this session is connected to.
- Rewrites need the production site to be at or past the merge of the 2026-11-05 plan's PR: `draft_memory` then answers `originalNoteRecorded: true` after a rewrite (the script prints `originalNote: recorded`). Until it does, save verbatim only.

### Preflight (every run)

**With the connector present, skip this check:** the tools run the code production serves, and step 3 reads `originalNoteRecorded` from the answer.

**Script fallback only.** The checkout is shared with other agents and can be stale or on a feature branch. Before running the script:

```bash
cd /Users/rob/Documents/active_work/jowray_com && git fetch -q origin main && git diff --quiet origin/main -- scripts/draft-memory.ts lib/source-input.ts lib/source-ref.ts docs/skills/jowray-draft-memory/SKILL.md && echo "script matches origin/main" || echo "STOP: the checkout's script or skill differs from origin/main"
```

Stop if it says STOP (or if `scripts/draft-memory.ts` is missing: the feature has not merged). If `npx tsx` fails on an import, run `npm ci` in that checkout first. This check proves the local script matches `origin/main`; it says nothing about what production is serving, which is why step 3 reads the `originalNote:` line.

## Hard rules

- **Their words, their choice.** Each memory is saved either as a verbatim copy of the sender's paragraphs about Jo or as a light rewrite that Rob picks and approves, text in hand, before anything is saved. A rewrite is as light and surgical as the note allows (step 2); when the approved text differs from the verbatim cut, the cut is sent as `originalNote` so it sits in the memory's history. Text that ends up identical to the cut is a verbatim save, whatever path led there (the API refuses an `originalNote` equal to `note`). Never save text Rob has not seen.
- **Only an answered question authorises a save.** A question that was cancelled, timed out, closed with partial selections, or answered in chat with an instruction rather than a choice does not authorise anything. PUBLIC being the API default is not a visibility choice. Re-ask.
- **Rob's typed text is either a replacement or an instruction.** Text that reads as the memory itself ("Jo always stopped…") is the approved note. Text that reads as a direction ("use the rewrite but keep 'Dad'") is an instruction: produce a revised proposal and ask again. Newly generated wording always goes back through step 2b.
- **Never tell the sender the words are exactly theirs when they were rewritten.** The reply says what was done (step 4).
- **A `duplicate` (the script's 409) means nothing from this attempt was saved.** Not the words, not the visibility, not the details, not the coordinates. Never describe them as saved, never write a reply that assumes them, never change `sourceInput` to get past the duplicate. Resume from the existing draft (step 3).
- **A rewrite that was sent but not recorded is a defect, not a success.** After a successful save of a payload that carried `originalNote`, `draft_memory` must answer `originalNoteRecorded: true` (the script must print `originalNote: recorded`). `false`, `NOT recorded`, or no `originalNote:` line at all, means production is older than this skill: stop, tell Rob the row holds only the rewrite and the sender's words survive only in the source message, and leave the fix to Rob (step 3's 409 branch shows how to put the verbatim words back). Draft no reply; the claim link is live but stays unsent. A verbatim save answers `false` (prints `NOT recorded` or nothing), which is correct. A `duplicate` carries no such field and follows the duplicate rule instead.
- **Email required.** A note with no sender email is not drafted until Rob supplies one.
- **Reply to the sender only.** `to` is the sender's address; `cc` stays empty. Never reply-all.
- **Nobody presses Share.** Only the sender does, on their own claim page. Never open a real person's claim link to "check".
- **No phone numbers, no street or unit details** in the relationship field or the reply (the field is PUBLIC by default).
- **Coordinates pin a place, never a home.** Only for a named place: a town, a facility or community campus (Broadmead is a place), a church, a park, a lake. Never a residence, a street address or a unit inside a place ("her apartment at Broadmead" gets none). Never saved without Rob's answer to the Coordinates question.
- **Reissue is revocation.** A second claim link for the same draft kills the one already sent. Only on Rob's explicit say-so, and only after step 3's Gmail check below.
- **Rob never presses Share, and never edits a draft on its page.** The only button on a draft's page is Share, and Share is the sender's consent. If Rob opens the link to add an attachment, he uses the file control only and closes the tab; a typo is fixed on the admin page or by telling the sender. A `consentedAt` earlier than the time Rob sent the reply means Rob pressed it: flag it.

## Who's who

From the obituary (`app/obituary/page.tsx`): Jo is the person being remembered, Rob's mother. **Richard** Wray is her husband ("Dad" in the notes). **Rob** (Robert) is her son. **Tracy** Gold is Rob's wife. Richard, Rob and Tracy are the family admins.

Resolve every pronoun from *this* message. In a letter addressed to Rob, "your mom" is Jo, "your dad" is Richard, "your parents" and "your mom and dad" are Jo and Richard, and "you" is Rob: these need no question. "You both", "you two", "the family" and any "your …" in a note not addressed to Rob are open until the sentence settles them: leave the words unchanged in the rewrite and ask Rob in step 2b. A pronoun inside a sentence the cut drops needs no question. Never substitute a name the message does not support.

## Procedure

Run the Preflight (above) first, and note which mailbox the Gmail connector is on.

**Resuming after a dead session:** before any save, look for a draft by this sender: `list_memories` with `status: "DRAFT"` and `q` = the sender's email (fallback: Rob looks on the admin page). One there means the earlier save landed: continue through the duplicate branch of step 3 with that `memoryId`. None means it did not land: start from step 1. Rob's earlier answers still count when he repeats them in chat ("rewrite and FAMILY, nothing else" settles Words and Visibility and leaves When, Where, Coordinates and Relationship blank), but a regenerated rewrite is new wording and still needs his yes on the shown text.

### 1. Resolve the source

**Gmail popout URL with `thread-f:<decimal>`** → convert to the hex thread id and read the thread:

```bash
printf '%x\n' <decimal>
```

`get_thread(threadId: "<hex>", messageFormat: "PLAIN_TEXT")`. Pick the **sender's** message (not Rob's). Keep **that message's `id`**: it is the `sourceRef` (`gmail:<message id>`), not the thread id.

**`thread-a:r…` URLs cannot be converted.** Use `search_threads` with the sender and subject Rob gives (for example `from:someone@example.com subject:(Jo)`); if nothing matches, ask Rob to paste the message.

**Pasted text or a text message** → use it as given. Ask for the sender's name and email if missing (email is required). For a text message also ask for the number (E.164) and the time on the message (ISO-8601 with a zone; the dedup key uses that minute), which only ever appear hashed.

Note whether the message has attachments: the skill cannot download them. The reply invites the sender to add the photo on their own page (step 4); Rob does not add it for them (hard rule above).

### 2. Propose the text

Show Rob, in this order:

1. **The verbatim cut**, in a fenced block: the sender's paragraphs about Jo, exactly as written, whole paragraphs only. The cut drops whole lines or paragraphs that hold no memory: greetings and sign-offs ("Dear Rob,", "With love, Pat"), signatures and "Sent from my iPhone", quoted earlier mail (`>` lines), logistics and Dad's health, and standalone condolence lines ("Thinking of you both at this hard time."). A condolence or direct-address sentence that sits **inside** a paragraph about Jo stays in the cut: removing it is a rewrite (step 2.2), never part of the cut. Everything kept is verbatim: no word changes, no partial paragraphs. The **one** normalisation allowed: join lines that a mail client hard-wrapped inside a paragraph; keep the blank-line paragraph breaks. This block is what the sender will see if Rob chooses verbatim, line breaks included, and it is what `originalNote` carries when Rob chooses a rewrite. When the cut itself names a street, unit or phone number, say so under it: the note is PUBLIC by default, and Rob may answer the Words question with a replacement or choose FAMILY.
2. **A light rewrite**, in a second fenced block, **only when the cut still addresses the family rather than speaking about Jo** ("your mom", "you", "your dad") or carries a condolence or direct-address sentence inside a memory paragraph ("I was so sorry to hear about your mom."), followed by a one-line change list measured against the cut ("dropped 'I was so sorry to hear about your mom.'; your mom → Jo ×2; 'you' → 'Rob'"). A light rewrite is the cut's own sentences, order, tense, vocabulary and paragraph breaks, with only the changes needed for the memory to make sense on a shared family website: whole sentences addressed to the family that hold no memory are dropped and listed; addressee references become the person's name as the message establishes it (Who's who); pronouns are fixed only where a change requires it. No new facts, no added adjectives, no summarising, no reordering, no smoothing of style; typos stay unless they obscure meaning. If a pronoun's referent is unclear, leave it unchanged and list it as an open question. If the cut already reads as a memory about Jo, say so and show no rewrite.
3. **Sender name and email.** The **relationship**: "stated" with the phrase it comes from, or "inferred" with the reason ("Neighbor", from 'when she walked past my feeder'), with no street or unit details ("Neighbor at Broadmead", "Friend from Ticonderoga Methodist"). Proposed **roughly when** and **where**, each with the phrase in the note it comes from, or "not stated". A time phrase is proposable only when it names a period a reader can place ("Summer 1998", "every Fourth of July", "the winter she retired"); a bare season or "years ago" is "not stated". A place is proposable when it names somewhere ("the lake", "Broadmead", "her kitchen"); a street or unit is never proposed.
   Then **coordinates** for that place, only when it is a named place a map can find (a town, a facility or community campus such as Broadmead in Cockeysville, a church, a park, a lake): WGS 84 decimal latitude and longitude of the place itself, with the phrase they come from and where the numbers come from (a map or web search result; never guessed). "Her kitchen", "the lake" with no name, a street address, a home, or a unit inside a place ("her apartment at Broadmead") get **no coordinates**: say why in one line (they would pin a home, or there is nothing to look up).
4. Whether the message has an **attachment**.

### 2b. Ask Rob

Questions, in this priority order; each call holds at most four questions and every question has two to four options, so the overflow goes into a second call right after the first. Headers are at most 12 characters: `Words`, `Visibility`, `Pronoun`, `When`, `Where`, `Coordinates`, `Relationship`, `Name`. If no question tool is available, ask the same questions in one chat message and wait for choices. Skip any question Rob already answered in chat for this memory; a selection a timed-out dialog submitted is not an answer.

1. **Words** (always). Options: "Verbatim copy"; then "Light rewrite (as shown)" when step 2 showed one, otherwise "Propose a light rewrite". Choosing "Propose a light rewrite" runs step 2 again with a rewrite and then step 2b again for Words and any Pronoun question before anything else happens. Rob's own text arrives through the free-text row: apply the replacement-or-instruction hard rule.
2. **Visibility** (always). Options, from `lib/visibility.ts`: "Everyone who visits jowray.com (PUBLIC, default)" / "The whole family (FAMILY)" / "Richard, Rob and Tracy only (PRIVATE)".
3. **Pronoun** (one per open referent, only when step 2 showed a rewrite): the sentence quoted, at most three Who's who candidates as options, plus "Keep as written". Rob's answer is what supports the name; the free-text row does not count toward the two-to-four options. Pronoun answers apply to the rewrite only: when Words is "Verbatim copy" they are ignored, and an unanswered Pronoun question does not block a verbatim save.
4. **When.** Options: the proposed value when step 2 proposed one; always "Leave blank (the sender can fill it in)"; and "Ask the sender in the reply" (adds one line in step 4).
5. **Where.** Same three shapes.
6. **Coordinates** (only when step 2 proposed them). Options: the proposed pair with the place, as `<latitude>, <longitude> (<place>)`, and "Leave blank". Coordinates are sent only when Rob picks the pair **and** keeps the proposed Where (the two may sit in the same call); "Leave blank", a skipped question or any other Where answer sends none.
7. **Relationship** (whenever step 2 proposed one, stated or inferred). Options: the proposed wording and "Leave blank", with "Leave blank" first when it was inferred. When step 2 proposed nothing, omit `relationship` without asking.
8. **Name** (only when the signature and the From line disagree): the two readings as options. When no name is known at all there is nothing to offer: ask Rob in chat, as step 1 does.

Then, before step 3: if Rob typed his own text and it differs from the block he was shown, or a pronoun answer changed the rewrite, show the final text once more in a fenced block and get a plain yes. Typed text identical to the shown rewrite needs no second yes.

### 3. Save the draft

Build the input. Describe **where the words came from** in `sourceInput`; the server derives `source` and `sourceRef` through the canonical builders in `lib/source-ref.ts`. Never compute a `sourceRef` by hand, and never send `source` or `sourceRef` (`draft_memory` refuses them).

```json
{
  "contributor": { "name": "<name>", "email": "<email>", "relationship": "<relationship or omit>" },
  "note": "<the approved text: the verbatim cut, or the rewrite as Rob approved or edited it>",
  "originalNote": "<the verbatim cut; include ONLY when note differs from it>",
  "approxDateText": "<or omit>",
  "place": "<or omit>",
  "visibility": "<PUBLIC | FAMILY | PRIVATE, as Rob chose>",
  "coordinates": { "latitude": <number>, "longitude": <number> },
  "sourceInput": { "kind": "gmail", "messageId": "<the sender's message id>" }
}
```

Omit `originalNote` whenever the approved `note` equals the verbatim cut, however Rob arrived there (a "Keep as written" answer or an instruction can undo every change): that is a verbatim save, and the server refuses (`invalid`, the script's 400) an `originalNote` equal to `note`. Omit `relationship`, `approxDateText` and `place` when Rob chose "Leave blank" or "Ask the sender in the reply", or when nothing was proposed. Include `coordinates` **only** when Rob chose the proposed pair (step 2b, Coordinates), as two numbers (not strings) exactly as he saw them; otherwise leave the key out.

`sourceInput` is one of:
- `{ "kind": "gmail", "messageId": "<sender's message id>" }` → `source: EMAIL`.
- `{ "kind": "sms", "number": "<E.164>", "sentAt": "<ISO-8601 with an explicit zone, e.g. 2026-11-03T14:05-05:00>", "text": "<the full text message>" }` → `source: SMS`. The zone is required (a zone-less time would hash differently on another machine). Keyed on number, the minute (UTC) and the text, so a retyped zone or seconds cannot make a second draft and two texts in one minute stay distinct.
- `{ "kind": "other", "originalText": "<the whole original message, not the excerpt>" }` → `source: OTHER`. The dedup key uses `contributor.email`; an `email` field here must match it.

**With the connector:** call `draft_memory` with this object. A success answers `{ memoryId, claimLink, originalNoteRecorded }`; check `originalNoteRecorded` against what was sent: a rewrite must answer `true` (hard rule above), a verbatim save `false`. A refusal answers `isError` with a `code`: `duplicate` (`memoryId`, `status`) is the 409 branch below, `invalid` (`message`) is the 400, `budget_exceeded` is the 429. `internal` (`eventId`) means the server failed: tell Rob the `eventId` (it is in Sentry); one retry of the same call is safe, because a call that did commit answers `duplicate` on the retry.

**Script fallback** (no connector): write the object to a JSON file in the scratchpad (never in the repo) and run the script, which prints the host it is about to call, then `memoryId`, `claimLink` and, when the server knows the field, `originalNote: recorded` or `originalNote: NOT recorded`:

```bash
npx tsx --env-file=/Users/rob/Documents/active_work/jowray_com/.env /Users/rob/Documents/active_work/jowray_com/scripts/draft-memory.ts --prod --input <json-file>
```

Then delete the JSON file. Check the `originalNote:` line against what was sent: a rewrite must print `recorded` (hard rule above); a verbatim save prints `NOT recorded` or nothing. The script's 409, 400 and 429 are the `duplicate`, `invalid` and `budget_exceeded` answers below.

- **`duplicate` (409), status DRAFT**: a draft already exists for this message, with its own words, visibility, details and coordinates; **nothing from this attempt was applied**, and a link for it may already be in Gmail. A lost response after `draft_memory` committed (timeout, dead session) shows up as `duplicate` with no link on retry; the recovery below applies: check Gmail, then `reissue_claim_link` on Rob's yes, which is safe because the link was never sent. **First, read the row:** `get_memory(memoryId)` gives its words (`contributorNote`), `visibility`, `place`, `coordinates` and `revisions` (newest first; the draft's creation revision is the oldest ADMIN one). Without the connector, Rob reads the same on the admin page (`/admin`, the sender's name). Words equal to the verbatim cut → a verbatim draft. Words that differ with the creation revision's `before.note` present → a recorded rewrite. Words that differ with an empty `before` → the unrecorded-rewrite defect: the words go back to the verbatim paragraph before anything else (a deleted draft keeps its `sourceRef`, so deleting does not allow a redraft), and no reply is drafted until the row is right. With the connector that edit is `update_memory` with `changes: { note: "<the verbatim cut>" }` on Rob's explicit yes (the `update_memory` rule below); otherwise Rob makes it on the admin page. **Then check Gmail before offering anything.** Look in **this sender's thread** (the `threadId` from step 1; for a text or pasted note, `list_drafts(query: "to:<sender email>")` and `search_threads(query: "in:sent to:<sender email> jowray.com/m/")`):
  - A Gmail **draft** in that thread with a `/m/` link → probably the link for this memory, and probably still live. The site cannot confirm a link without its token, so say so: show Rob the draft and the `memoryId` from the duplicate answer, and let him decide between sending it as is and a reissue (which replaces the link in that draft).
  - A **sent** reply in that thread with a `/m/` link → the person most likely holds a working link. Do not reissue unless Rob says, in so many words, that he wants to revoke it (for example because it leaked or he knows a reissue happened after it was sent).
  - Neither → the link was lost (a session died, or a response was lost, between the save and the Gmail draft). Offer `reissue_claim_link(memoryId)` (fallback: `--prod --reissue <memoryId>`) and say that any link already sent stops working; here none was sent, so nothing breaks. Only on Rob's explicit yes.
  - After any reissue, put the new link into the existing Gmail draft with `update_draft` if one exists; never leave a draft carrying a dead link. A `/m/` link found for the same person but in another thread belongs to another memory: leave it alone.
  - Rob wants different words, visibility or details than the existing draft has → `update_memory` with only the changed keys, on Rob's explicit yes (fallback: the admin page, `/admin`, "Drafts"); coordinates → `set_coordinates` with the `memoryVersion` from `get_memory`, under the same coordinate rules as a new draft. Do not try a second draft with an altered `sourceInput`.
  - **The `update_memory` rule.** Read `memoryVersion` and `contributor.contributorVersion` from `get_memory` first and send them with only the keys Rob asked to change. On `stale`, compare `current` with the values you originally read: if a field Rob did not ask to change differs (someone else edited the row), stop and ask Rob before retrying; otherwise retry once with the versions from `current`.
  - **Any step 4 that follows a duplicate** (with or without a reissue) is written from the row, not from this attempt: verbatim words → the "in your own words" line; a recorded rewrite → the "trimmed lightly" line. A reissue never clears the row check above; it only replaces the link.
- **`duplicate` (409), status PENDING or later**: the person already shared it. Stop; tell Rob.
- **Connector errors** (no jowray tools, or every call fails to connect): the connector's header does not match `MCP_API_SECRET` in production, or the endpoint is down. Stop and tell Rob (`docs/environment.md`, "MCP connector"); offer the script fallback only on his Mac.
- **401** (script): `ADMIN_API_SECRET` is missing locally or differs from Vercel. Stop.
- **`budget_exceeded` (429)**: the daily memory budget is spent. Try later.

### 4. Draft Rob's reply

`list_drafts(query: "to:<sender email>")` first. If a draft to this address in this thread already exists: if it already carries this memory's `claimLink`, show it to Rob and stop; if it does not (Rob started a reply by hand), `update_draft` it to add the link and the lines below, keeping his words, and show him the result.

Otherwise `create_draft`:
- **Gmail source** (`sourceInput.kind = gmail`): `replyToMessageId` = the sender's message id (the same id as in `sourceRef`); `subject` = `Re: <original subject>` with any existing leading `Re:` / `RE:` / `Fwd:` stripped first, so it never reads `Re: Re:`.
- **Text message or pasted note** (no Gmail message to reply to): omit `replyToMessageId`; `subject` = `A memory of Jo`.
- `to`: `["<sender email>"]`. No `cc`, no `bcc`. The connector does **not** inherit recipients from the original (probe, 2026-11-04), so this list is exactly who gets the link.
- `body`: plain text, in Rob's voice. Short, warm, first person. Thank them for the specific memory (name it in a few words, do not quote the note back at length). Then the saved line, in one of two forms, decided by what the row holds (the words saved equal the verbatim cut, or not): **verbatim** → "I've saved it to Jo's memorial in your own words:"; **rewritten** → "I've saved it to Jo's memorial. I trimmed your note lightly so it reads as your memory of Jo on the page rather than a letter to me; please change anything that isn't how you'd say it." ("Mom's memorial" is fine where Rob would say Mom.) The claim link on its own line. "Change anything, add a photo or a recording, and press Share when it's right." When Rob chose "Ask the sender in the reply" for when or where, one line asks ("If you remember roughly when this was, there's a spot for it on the page."). A clean exit: "No need to do anything if you'd rather not." If the message had an attachment, one line that the photo can be added on that page (Rob does not add it for them). Never grovel, never include anyone's phone number, no "I know you're busy".

**Then read the draft back** (`get_draft`, or `list_drafts` with `DRAFT_VIEW_FULL`) and stop if `to` is not exactly the sender, or `cc` / `bcc` is not empty: a CC'd person would hold the bearer link and could edit or Share the memory.

Rob reads and sends the draft himself. The skill never sends.

### 5. Report

Give Rob: the Gmail draft `viewUrl`; the claim link (a bearer token: anyone with it can edit the memory); whether the saved text is verbatim or rewritten and whether the save reported the original as recorded (`originalNoteRecorded: true`, or the script's `originalNote: recorded`); the visibility chosen; whether coordinates were saved; which details were left blank or asked of the sender; and the reminder that nothing is public until the sender presses Share. Rob watches `Memory.status` move DRAFT → PENDING on the admin page; the family-admin alert email fires once the person shares.

## What the site does with a draft

- `Memory.status = DRAFT`, `consentedAt = null`, `source = EMAIL|SMS|OTHER`, `sourceRef` unique. One Contributor per draft, with `contactOptIn` **off** until the person presses Share (the page prefills both checkboxes on, like /share, and Share records their choice).
- A rewritten draft carries the verbatim excerpt in its first ADMIN revision (`before.note`, with the rewrite as `after.note`). The admin page's History shows the newest 25 revisions, so that first revision stays on the page until a memory has been edited more than 24 times; after that it is still in the database (`MemoryRevision`) but not shown. The sender's claim page never shows History. A verbatim draft's first revision has an empty `before`.
- The claim page shows "A memory of Jo, in your words", the editable fields, the two preference checkboxes and one button, **Share this memory**. Pressing it sets `status = PENDING` and stamps `consentedAt` / `consentVersion`. A repeated press never restamps.
- No site email, before or after Share. The reconcile cron skips these memories, so it never rotates the token behind the link Rob sent.
- Reissue (`reissue_claim_link`, or the script's `--reissue`) is allowed only while DRAFT.
- Coordinates (optional, WGS 84) live only in the database and the connector's answers: the claim page and the admin page never show them, and editing `place` leaves them alone.
- The family-admin alert is not sent for a DRAFT; the cron sends it within ten minutes of the person pressing Share, dated by that moment.
