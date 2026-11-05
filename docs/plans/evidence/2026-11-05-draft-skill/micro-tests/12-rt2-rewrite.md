# Re-test 12: rt2-rewrite (after the tightening round)

Role-played by a fresh Explore subagent against the tightened SKILL.md (2026-11-05). Fictional people only.

I ran the skill's steps 1 to 4 on paper for Pat's note, with every tool call stubbed. It ends with a light rewrite saved as FAMILY, `originalNote: recorded`, and a reply drafted to Pat only. I sent the full report to team-lead. The report follows.

**A) What Rob is shown**

Step 1 reads the thread with `get_thread(threadId: "1a1a0000000000aa", messageFormat: "PLAIN_TEXT")`. The sender's message id is 1a1a000000000001, and there are no attachments.

Verbatim cut:
```
Your mom always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!
```
Light rewrite:
```
Jo always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!
```
- **Change list:** "Your mom" → "Jo" ×1.
- **Dropped:** the greeting, "I was so sorry to hear about your mom.", "Thinking of you both at this hard time.", "Pat" and "Sent from my iPhone". The hard-wrapped lines were joined.
- **"You both":** it appears only in a dropped sentence, so no pronoun question is needed.
- **Address details:** the cut names no street, unit or phone number.
- **Sender:** Pat Example <pat@example.org>.
- **Relationship:** inferred "Neighbor", from 'when she walked past' and 'my feeder'.
- **When:** not stated, because "One spring" is a bare season.
- **Where:** "Pat's feeder" is proposed, from 'the birds at my feeder'.
- **Attachment:** none.

**B) Questions for Rob**

First call:
1. **Words.** "Which text should be saved as Pat's memory?" Options are "Verbatim copy" and "Light rewrite (as shown)". Rob chose the light rewrite.
2. **Visibility.** "Who should see this memory once Pat presses Share?" Options are "Everyone who visits jowray.com (PUBLIC, default)", "The whole family (FAMILY)" and "Richard, Rob and Tracy only (PRIVATE)". Rob chose FAMILY.
3. **When.** "The note names no time a reader can place ('One spring'). What goes in 'roughly when'?" Options are "Leave blank (the sender can fill it in)" and "Ask the sender in the reply". Rob chose Leave blank.
4. **Where.** "What goes in 'where'? Proposed from 'the birds at my feeder'." Options are "Pat's feeder", "Leave blank (the sender can fill it in)" and "Ask the sender in the reply". Rob chose Leave blank.

Second call:

5. **Relationship.** "How should Pat's relationship to Jo read? Inferred from 'when she walked past' my feeder." Options are "Leave blank" and "Neighbor". Rob chose Leave blank.

There was no Pronoun or Name question. No second yes was needed, because Rob typed nothing and no pronoun answer changed the text.

**C) Input JSON** (a scratchpad file, deleted after the run)
```json
{
  "contributor": { "name": "Pat Example", "email": "pat@example.org" },
  "note": "Jo always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!",
  "originalNote": "Your mom always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!",
  "visibility": "FAMILY",
  "sourceInput": { "kind": "gmail", "messageId": "1a1a000000000001" }
}
```

**D) Reply**

`list_drafts` found no existing draft to Pat. The `create_draft` call replies to message 1a1a000000000001 with subject "Re: So sorry about your mom", to pat@example.org only, with no cc or bcc.
```
Hi Pat,

Thank you for the memory of Mom stopping to watch the birds at your feeder, and the bag of seed she brought for your thin cardinals.

I've saved it to Jo's memorial. I trimmed your note lightly so it reads as your memory of Jo on the page rather than a letter to me; please change anything that isn't how you'd say it.

https://www.jowray.com/m/SYNTHETIC_TOKEN

Change anything, add a photo or a recording, and press Share when it's right. No need to do anything if you'd rather not.

Rob
```
The `get_draft` read-back showed only pat@example.org as recipient, with cc and bcc empty, so the check passed.

**E) Script output**

The rewrite went to www.jowray.com and the script printed "originalNote: recorded". Production stored the verbatim cut, so drafting the reply was allowed.

**F) Unclear or guessed**
- **Where:** I guessed "my feeder" counts as a place, like "her kitchen". The skill does not say whether a first-person place becomes third person, such as "Pat's feeder".
- **Name:** I treated "Pat" in the signature and "Pat Example" in the From line as agreeing. The skill does not say whether a short form counts as a disagreement.
- **When with nothing proposed:** I still asked it, with two options. The skill implies this but never says outright whether to skip When or Where when step 2 found nothing.
- **Visibility in the reply:** the skill does not say whether to tell the sender who will see the memory. Pat may think Share makes it public, but it is FAMILY only.
- **Greeting and sign-off:** the skill does not specify "Hi Pat," or the "Rob" signature, so I added both.
- **Question texts:** only the headers and options are fixed, so I wrote the question texts myself.
- **Mailbox check:** the stub had no Gmail view URL, so the mailbox check was skipped.
