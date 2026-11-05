# Micro-test 2: mt2-rewrite

Role-played by a fresh Explore subagent against the new SKILL.md (2026-11-05). Fictional people only.

Here is my full report on the role-played micro-test with Pat's note. The skill saved a light rewrite as FAMILY with the original note recorded, and the reply is drafted to Pat only. Nothing was actually run.

Step 1 call:
```
get_thread(threadId: "1a1a0000000000aa", messageFormat: "PLAIN_TEXT")
```
I kept the sender's message id, 1a1a000000000001. The message has no attachments.

**A) Step 2 output**

Verbatim cut, with the hard-wrapped lines joined:
```
I was so sorry to hear about your mom. Your mom always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!
```
It speaks to Rob ("your mom"), so here is a light rewrite:
```
Jo always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!
```
Changes, in the skill's format: "Your mom" → "Jo" ×1; dropped "Dear Rob,", "I was so sorry to hear about your mom." and "Thinking of you both at this hard time."; dropped the signature and "Sent from my iPhone". There are no open pronouns: "she" is Jo and "my" is Pat.
- **Sender:** Pat Example, pat@example.org. The signature "Pat" agrees with the From line.
- **Relationship:** "Neighbor", inferred from "when she walked past" and "my feeder". The note doesn't say it.
- **Roughly when:** not stated. "One spring" has no year.
- **Where:** not stated. "My feeder" is Pat's own home.
- **Attachment:** none.

**B) AskUserQuestion calls**

The first call had four single-choice questions:
1. **Words:** "Which text should be saved as Pat's memory?" Options are "Verbatim copy" and "Light rewrite (as shown)".
2. **Visibility:** "Who may see this memory once Pat presses Share?" Options are "Everyone who visits jowray.com (PUBLIC, default)", "The whole family (FAMILY)" and "Richard, Rob and Tracy only (PRIVATE)".
3. **When:** "Roughly when? The note gives no date." Options are "Leave blank (the sender can fill it in)" and "Ask the sender in the reply".
4. **Where:** "Where? The note names no place." It has the same two options.

Rob's answers were the light rewrite, FAMILY, and leave blank for both details.

The second call had one question. **Relationship:** "Relationship line under Pat's name? 'Neighbor' is inferred, not stated." Options are "Neighbor" and "Leave blank", and Rob picked "Neighbor". Rob didn't edit the text, so no extra yes was needed.

**C) JSON file**

The file goes in the scratchpad and is deleted after the run.
```json
{
  "contributor": { "name": "Pat Example", "email": "pat@example.org", "relationship": "Neighbor" },
  "note": "Jo always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!",
  "originalNote": "I was so sorry to hear about your mom. Your mom always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!",
  "visibility": "FAMILY",
  "sourceInput": { "kind": "gmail", "messageId": "1a1a000000000001" }
}
```
I printed the preflight check and the save command instead of running them. The stubbed output reported the target www.jowray.com, mem_s2, the claim link and "originalNote: recorded". That is the right result for a rewrite, so I went on to step 4.

**D) Reply body**

The search for existing drafts to pat@example.org found nothing. The draft replies to Pat's message with the subject "Re: So sorry about your mom". It goes to pat@example.org only, with no CC or BCC.
```
Hi Pat,

Thank you for the memory of Mom stopping at your feeder, knowing every bird by name, and that bag of seed for your thin cardinals.

I've saved it to Jo's memorial site. I trimmed your note lightly so it reads as your memory of Jo on the page rather than a letter to me; please change anything that isn't how you'd say it.

https://www.jowray.com/m/SYNTHETIC_TOKEN

Change anything, add a photo or a recording, and press Share when it's right.

No need to do anything if you'd rather not.

Rob
```
Reading the draft back showed Pat as the only recipient, so the check passed.

**E) Step 5 report to Rob**
- **Gmail draft:** the link from the draft creation result goes here, since the stub didn't include one. Rob reads it and sends it himself.
- **Claim link:** https://www.jowray.com/m/SYNTHETIC_TOKEN is a bearer link, so anyone holding it can edit the memory.
- **Text:** It is a light rewrite. "originalNote: recorded" was printed, so Pat's verbatim paragraph sits in the memory's first revision.
- **Visibility and relationship:** FAMILY and "Neighbor".
- **When and where:** Both are left blank for Pat to fill in. The reply asks about neither.
- **Next:** Nothing is visible until Pat presses Share. Rob can watch mem_s2 move from DRAFT to PENDING on the admin page. The family-admin alert fires once Pat shares.

**F) Where SKILL.md was unclear or I guessed**
1. **Verbatim cut:** The rule "paragraphs exactly as written" made me keep the "I was so sorry" sentence inside the memory paragraph. The closing "Thinking of you both" isn't on the drop list, and I dropped it only because it isn't about Jo. As a result the "you both" pronoun question never came up.
2. **Question limit:** The four standard questions fill the first call. An unclear pronoun would make five, and the skill doesn't say which question moves to the second call.
3. **Relationship question:** The skill asks it "only if needed" but never says when that is. I asked because "Neighbor" was my inference.
4. **"One spring":** It might count as a stated "roughly when". I treated it as not stated.
5. **Reply wording:** For a rewrite, it's unclear whether the prescribed sentence replaces the "saved to Jo's memorial" line or follows it, so I combined them. "Saved" could also read as already public, though the Share line helps.
6. **Not stubbed:** The preflight result, which mailbox the connector uses, and the draft link were not given. I assumed the preflight passed. Step 4 also says to look "in this thread", but its draft search has no thread filter.
