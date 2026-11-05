# Re-test 11: rt1-verbatim (after the tightening round)

Role-played by a fresh Explore subagent against the tightened SKILL.md (2026-11-05). Fictional people only.

I sent the report to the team lead. The full text is below.

The run saved Pat's words verbatim with PUBLIC visibility and every detail left blank. The reply is drafted to Pat only. I ran no commands and called no Gmail or question tools; every tool result below is the stub I was given.

**A) Verbatim cut and rewrite.** Step 1 called get_thread on thread 1a1a0000000000aa as plain text. It kept message id 1a1a000000000001 and found no attachments. Here is the cut, with hard wraps joined:
```
Your mom always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!
```
The cut has no street, unit or phone number. I dropped the greeting, "I was so sorry…", "Thinking of you both…", the signature and "Sent from my iPhone". The cut still says "Your mom", so I showed a rewrite:
```
Jo always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!
```
```
Your mom → Jo ×1
```
- **Sender:** Pat Example, pat@example.org.
- **Relationship:** inferred as "Neighbor" from "when she walked past" and "my feeder".
- **When:** not stated, because "One spring" is a bare season.
- **Where:** not stated.
- **Attachment:** none.

**B) Questions.** The first call held four questions:
1. **Words:** "Which words should Pat's draft memory use?" The options were "Verbatim copy" and "Light rewrite (as shown)". Rob chose Verbatim copy.
2. **Visibility:** "Who can see this memory once Pat shares it?" The options were "Everyone who visits jowray.com (PUBLIC, default)", "The whole family (FAMILY)" and "Richard, Rob and Tracy only (PRIVATE)". Rob chose PUBLIC.
3. **When:** "The note gives no time a reader can place. What goes in 'roughly when'?" The options were "Leave blank (the sender can fill it in)" and "Ask the sender in the reply". Rob chose Leave blank.
4. **Where:** "The note names no place. What goes in 'where'?" It had the same two options. Rob chose Leave blank.

The second call held one question:

5. **Relationship:** "Not stated; I inferred Neighbor from 'when she walked past' my feeder." The options were "Leave blank" and "Neighbor". Rob chose Leave blank.

There was no Pronoun question, because "you both" sits in a dropped sentence. There was no Name question. No second yes was needed, because Rob typed no text.

**C) Input file.** It would sit in the scratchpad and be deleted after the run:
```json
{
  "contributor": { "name": "Pat Example", "email": "pat@example.org" },
  "note": "Your mom always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!",
  "visibility": "PUBLIC",
  "sourceInput": { "kind": "gmail", "messageId": "1a1a000000000001" }
}
```

**D) Reply.** The drafts search for Pat's address found nothing. The new draft goes to Pat only with no cc or bcc. It replies to message 1a1a000000000001 with the subject "Re: So sorry about your mom".
```
Hi Pat,

Thank you for this. Mom stopping at your feeder and knowing every bird by name, and that bag of seed for your thin cardinals, is so like her.

I've saved it to Mom's memorial in your own words:

https://www.jowray.com/m/SYNTHETIC_TOKEN

Change anything, add a photo or a recording, and press Share when it's right.

No need to do anything if you'd rather not.

Rob
```
The read-back showed only Pat as recipient, with cc and bcc empty. That passes, and Rob sends it himself.

**E) Script output.** The draft saved on production as mem_r1 with a live claim link. "NOT recorded" is the correct result for a verbatim save, so it says nothing about whether production can record a rewrite.

**F) Where SKILL.md was unclear:**
- **Source format.** Step 1 covers popout URLs and pasted text, not a bare hex thread id. I called get_thread directly.
- **Rewrite readiness.** The prerequisites say to save verbatim only until production records the original. The only test for that is the line printed after a rewrite is saved. Step 2 still offers a rewrite before anyone can know.
- **Conflicting meanings.** Step 3 says the original-note line prints only when the server knows the field. The hard rule says "NOT recorded" after a rewrite means production is older. Those two readings conflict.
- **Where rule.** "Names somewhere" is unclear for "my feeder". I treated it as not stated; "Pat's bird feeder" is the other possible reading.
- **Name check.** The signature says "Pat" and the From line says "Pat Example". I treated that as agreement, but the skill does not define a partial match.
- **Reply wording.** The skill gives no greeting or sign-off, so I guessed "Hi Pat," and "Rob". I used "Mom's memorial" because Pat writes "your mom".
- **Preflight placement.** The preflight and the mailbox check sit under Prerequisites, and no procedure step points to them. I would run them before steps 1 and 3 but did not here.
