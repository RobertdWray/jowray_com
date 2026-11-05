# Micro-test 3: mt3-replacement

Role-played by a fresh Explore subagent against the new SKILL.md (2026-11-05). Fictional people only.

I ran the skill's steps 1 to 4 on the made-up case using only the stubbed results. No command, Gmail call or question tool was used. I sent the full report to the team lead.

**Outcome.** I classed Rob's typed text as a replacement, so the memory was saved as a rewrite with `originalNote`. The stub printed "originalNote: recorded", which is the right result for a rewrite. The reply uses the "trimmed lightly" line.

**A) What Rob saw at step 2**

1. Verbatim cut:
```
I was so sorry to hear about your mom. Your mom always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!
```
2. Light rewrite, shown because the cut talks to Rob rather than about Jo:
```
Jo always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!
```
The change list said the sorry sentence was dropped and "Your mom" became "Jo" once. No pronouns were left unclear.

3. Sender and details:
   - **Sender:** Pat Example, pat@example.org.
   - **Relationship:** "Neighbor", guessed from "when she walked past". Pat never says it.
   - **When:** not stated, because "One spring" gives no year.
   - **Where:** "Pat's bird feeder".

4. There is no attachment.

**B) Questions asked**
- **Words:** Verbatim copy, or Light rewrite (as shown).
- **Who may see it:** the three choices from the skill: everyone (PUBLIC), the whole family (FAMILY), or Richard, Rob and Tracy only (PRIVATE).
- **When:** Leave blank, or Ask the sender in the reply.
- **Where:** Pat's bird feeder, Leave blank, or Ask the sender in the reply.
- **Relationship, in a second call:** Neighbor, or Leave blank. The script picked the first choice, Neighbor.

Rob's typed text reads as the memory itself and gives no direction, so it is a replacement. It also matches the shown rewrite character for character. It came in as typed text, so I showed it again and Rob said "yes".

**C) Input file:**
```json
{
  "contributor": { "name": "Pat Example", "email": "pat@example.org", "relationship": "Neighbor" },
  "note": "Jo always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!",
  "originalNote": "I was so sorry to hear about your mom. Your mom always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!",
  "visibility": "PUBLIC",
  "sourceInput": { "kind": "gmail", "messageId": "1a1a000000000001" }
}
```

**D) Reply.** The draft goes to pat@example.org only, as a reply to Pat's message. The subject is "Re: So sorry about your mom".
```
Hi Pat,

Thank you for the memory of Mom at your feeder, knowing every bird by name, and the seed for your cardinals.

I've saved it to Jo's memorial. I trimmed your note lightly so it reads as your memory of Jo on the page rather than a letter to me; please change anything that isn't how you'd say it.

https://www.jowray.com/m/SYNTHETIC_TOKEN

Change anything, add a photo or a recording, and press Share when it's right.

No need to do anything if you'd rather not.

Rob
```
The stubbed read-back showed Pat as the only recipient, with nobody on CC or BCC.

**E) Report to Rob.** It gives the Gmail draft link, which the stub did not supply. It gives the claim link with a warning that anyone holding it can edit the memory. It says the saved text is the rewrite and the original wording is in the memory's history. Visibility is PUBLIC, the relationship is Neighbor, and when and where are left blank. Nothing is public until Pat presses Share.

**F) Where the skill was unclear**
1. **Cut size.** The cut keeps whole paragraphs exactly as written, so "I was so sorry to hear about your mom." stays in. A verbatim save would put that sentence on a PUBLIC page.
2. **Text that matches the rewrite.** The skill doesn't say whether this counts as Rob editing the text. I asked for a yes anyway, to be safe.
3. **Reply line for Rob's own words.** "Trimmed lightly" is true here only because his text equals the rewrite. There is no line for a heavier rewrite by Rob, and nothing says his text must follow the light-rewrite rules.
4. **Relationship.** The second call is asked "only if needed", and nothing says whether an unasked guess is saved or left out. Here the first choice saved a guessed "Neighbor" to a PUBLIC field. Putting "Leave blank" first when the relationship is a guess would be safer.
5. **"One spring".** I treated it as not stated. The skill has no rule for vague time phrases.
6. **Missing stubs.** The startup check, the mailbox check and the draft link had no stubs. I assumed both checks passed.
7. **Order.** The skill doesn't say whether the final yes comes before or after the second question call.
