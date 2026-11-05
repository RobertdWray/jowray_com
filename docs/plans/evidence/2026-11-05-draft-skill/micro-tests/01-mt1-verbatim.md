# Micro-test 1: mt1-verbatim

Role-played by a fresh Explore subagent against the new SKILL.md (2026-11-05). Fictional people only.

I sent the full report to the team lead again, and it is also included below. Nothing was run: no commands, no Gmail calls, no question tool, and no files were written.

**A) Step 2 output**

The step 1 call would be `get_thread(threadId: "1a1a0000000000aa", messageFormat: "PLAIN_TEXT")`. The sender's message id is 1a1a000000000001, and there are no attachments.

Verbatim cut, with the hard-wrapped lines joined:
```
I was so sorry to hear about your mom. Your mom always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!
```
The cut speaks to Rob rather than about Jo, so step 2 also shows a light rewrite:
```
Jo always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!
```
Changes: dropped "I was so sorry to hear about your mom."; "Your mom" → "Jo" ×1. No pronoun is left unclear.
- **Sender:** Pat Example <pat@example.org>. The signature "Pat" matches the From line.
- **Relationship:** "Neighbor", from "when she walked past" my feeder.
- **Roughly when:** not stated.
- **Where:** "Pat's bird feeder", from "at my feeder".
- **Attachment:** none.

**B) AskUserQuestion calls**

The first call has four questions.
- **Words:** "Which words should Pat's memory use?" Options are "Verbatim copy" and "Light rewrite (as shown)".
- **Visibility:** "Who may see it once Pat presses Share?" Options are "Everyone who visits jowray.com (PUBLIC, default)", "The whole family (FAMILY)" and "Richard, Rob and Tracy only (PRIVATE)".
- **When:** "Roughly when? The note gives no date." Options are "Leave blank (the sender can fill it in)" and "Ask the sender in the reply".
- **Where:** "Where? The note says 'at my feeder'." Options are "Pat's bird feeder", "Leave blank (the sender can fill it in)" and "Ask the sender in the reply".

The second call is needed because the first one already holds the maximum of four questions.
- **Relationship:** "Relationship for Pat? Inferred from 'when she walked past'." Options are "Neighbor" and "Leave blank". Rob picks Neighbor.

**C) Final JSON file**

The file goes in the scratchpad and is deleted after the run.
```json
{
  "contributor": { "name": "Pat Example", "email": "pat@example.org", "relationship": "Neighbor" },
  "note": "I was so sorry to hear about your mom. Your mom always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!",
  "visibility": "PUBLIC",
  "sourceInput": { "kind": "gmail", "messageId": "1a1a000000000001" }
}
```
The preflight check runs first, then the save script against production with this file as input. The stub printed "originalNote: NOT recorded", which is expected for a verbatim save, so the run continues.

**D) Reply body**

The draft check `list_drafts(query: "to:pat@example.org")` finds nothing. Then `create_draft` goes out with these values:
- **replyToMessageId:** "1a1a000000000001"
- **subject:** "Re: So sorry about your mom"
- **to:** ["pat@example.org"], with no cc and no bcc.

The read-back shows only pat@example.org in the to field, and cc and bcc are empty, so the check passes.
```
Hi Pat,

Thank you for this. Mom stopping at your feeder to name every bird, and that bag of seed for your thin cardinals, is exactly her.

I've saved it to Mom's memorial page in your own words:

https://www.jowray.com/m/SYNTHETIC_TOKEN

Change anything, add a photo or a recording, and press Share when it's right.

No need to do anything if you'd rather not.

Rob
```

**E) Step 5 report to Rob**
- **Gmail draft:** the link comes from the create_draft result, which the stub did not include. The draft goes to Pat only and read back clean.
- **Claim link:** https://www.jowray.com/m/SYNTHETIC_TOKEN. Anyone who holds this link can edit the memory.
- **Saved text:** verbatim. The script printed "originalNote: NOT recorded", which is correct for a verbatim save.
- **Details:** visibility is PUBLIC and the relationship is Neighbor. When and where are left blank for Pat to fill in, and the reply does not ask about them.
- **Next:** nothing is public until Pat presses Share. On the admin page the status moves from DRAFT to PENDING when Pat shares, and the family-admin alert email goes out then.

**F) Unclear or guessed**
1. **Verbatim keeps the condolence line.** The cut keeps whole paragraphs about Jo, and the skill's drop list does not mention condolence sentences. So the PUBLIC memory opens with "I was so sorry to hear about your mom." and reads like a letter. Nothing warns Rob about this when he picks verbatim. I also guessed that "Thinking of you both" is not about Jo and dropped it.
2. **Change-list baseline.** The skill's example says the rewrite "dropped 'Dear Rob' and the closing line", so it compares against the whole message. Step 2 already strips greetings from the cut, so I compared against the cut instead.
3. **Relationship question.** The skill allows a second call "only if needed" but doesn't say whether an inferred relationship counts. It is also unclear whether the condition about the signature and the From line disagreeing applies to Relationship or only to Name.
4. **When and where.** I guessed that "One spring" is not a stated date. I also guessed that "at my feeder" counts as a where.
5. **Source format.** A bare thread id is not one of the source formats the skill lists. With no Gmail link, I couldn't check which mailbox the note is in.
6. **Reply voice.** The skill's line says "Jo's memorial", and I wrote "Mom's" to match how Rob would talk. The reply also never tells Pat the memory becomes PUBLIC after Share.
7. **Missing draft link.** Step 5 needs the Gmail draft link, but no step says where it comes from. I assume it is the create_draft result.
