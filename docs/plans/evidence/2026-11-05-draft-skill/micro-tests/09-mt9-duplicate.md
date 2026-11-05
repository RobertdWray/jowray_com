# Micro-test 9: mt9-duplicate

Role-played by a fresh Explore subagent against the new SKILL.md (2026-11-05). Fictional people only.

The duplicate case ended with nothing saved and no new reply drafted, and the next step is Rob's edit on the admin page. Both sends of the report to your inbox reported success. Here is the full report again.

**A) Step 2 output**

Before this step, the skill prints the preflight check and reads the thread with `get_thread(threadId: "1a1a0000000000aa", messageFormat: "PLAIN_TEXT")`. The source reference becomes gmail:1a1a000000000001.

Verbatim cut, with the hard-wrapped lines joined:
```
I was so sorry to hear about your mom. Your mom always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!
```
Light rewrite:
```
Jo always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!
```
- **Changes:** "Your mom" became "Jo" once. I dropped "Dear Rob", "I was so sorry to hear about your mom." and "Thinking of you both at this hard time."
- **Sender:** Pat Example <pat@example.org>.
- **Relationship:** "Neighbor", inferred from "when she walked past".
- **When:** spring, no year stated, from "One spring".
- **Where:** Pat's bird feeder, from "at my feeder".
- **Attachment:** none.
- **Open pronouns:** none. "You both" appears only in the closing line I dropped, so the scripted "Rob and Tracy" answer was never used.

**B) AskUserQuestion calls**

The first call had four questions. Rob's scripted picks are in brackets.
- **Words:** "Verbatim copy" or "Light rewrite (as shown)". [Light rewrite]
- **Who may see it:** "Everyone who visits jowray.com (PUBLIC, default)", "The whole family (FAMILY)" or "Richard, Rob and Tracy only (PRIVATE)". [PRIVATE]
- **Roughly when:** "Spring (from 'One spring')", "Leave blank (the sender can fill it in)" or "Ask the sender in the reply". [Leave blank]
- **Where:** "Pat's bird feeder", "Leave blank (the sender can fill it in)" or "Ask the sender in the reply". [Leave blank]

The second call asked about relationship, with the options "Neighbor" and "Leave blank". [Neighbor] Rob edited no text, so no extra yes was needed before saving.

**C) The save attempt and the 409**
```json
{"contributor":{"name":"Pat Example","email":"pat@example.org","relationship":"Neighbor"},
 "note":"Jo always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!",
 "originalNote":"I was so sorry to hear about your mom. Your mom always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!",
 "visibility":"PRIVATE",
 "sourceInput":{"kind":"gmail","messageId":"1a1a000000000001"}}
```
The script would be called with the production flag and this file from the scratchpad, and the file deleted afterwards. It returned a 409 duplicate on an existing DRAFT with memoryId mem_old.

Nothing from this attempt was saved. That covers the rewrite, the verbatim text, the PRIVATE choice and the "Neighbor" relationship. mem_old keeps its own words and visibility, which may be the PUBLIC default.

I considered changing `sourceInput` to get a new row and rejected it. The skill's hard rules forbid it. It would also leave Pat with two drafts, while the link already in Gmail pointed at the old one.

Gmail check:
- `list_drafts(query: "to:pat@example.org")` found one draft in thread 1a1a0000000000aa, carrying the link /m/OLDER_SYNTHETIC_TOKEN.
- `search_threads(query: "in:sent to:pat@example.org jowray.com/m/")` found nothing.

That link is probably mem_old's and probably still works, but the site cannot confirm it without the token. Rob said "no, leave it", so there was no reissue.

**D) Reply body: none**

Step 4 found an existing draft in this thread with a claim link, so the skill shows it to Rob and stops. A new reply would describe a rewrite and a PRIVATE choice that were never saved. I would call `get_draft` to confirm that only Pat is in the To line and that CC and BCC are empty. No stub covered that call, so it is unverified.

**E) What I tell Rob**

"Nothing from this attempt was saved. Pat's email already has a draft memory, mem_old, with its own words and visibility. That visibility may be PUBLIC. Your Gmail draft to Pat in this thread already carries a claim link. It is most likely mem_old's and still working. I left it alone as you asked. Your options:
1. On the admin page, open Drafts and then mem_old. Paste the rewrite and set PRIVATE before you send the email. If Pat presses Share first, the memory goes out with its current visibility.
2. Then fix the Gmail draft's wording. If it says 'in your own words', replace that with the 'I trimmed your note lightly…' line. I can update the draft once you confirm the admin edit.
3. Or keep mem_old exactly as it is and send the draft unchanged.
Admin edits keep the existing link working, so no reissue is needed."

**F) Where SKILL.md was unclear or I had to guess**
1. **Verbatim cut granularity.** It is unclear whether a condolence sentence inside the memory paragraph stays in the cut. I kept the whole paragraph. The closing "Thinking of you both" is not on the explicit drop list, and I dropped it anyway.
2. **The `originalNote` hard rule has no 409 exception.** The script printed no `originalNote` line after a payload that carried one. Read literally, that triggers the defect rule. I treated the 409 as the explanation instead.
3. **Step 4's match test.** "Already carries this memory's claimLink" cannot be tested after a 409, because no link comes back. I treated the probable match as a match.
4. **Gmail lookup for a Gmail source.** Step 3 names the calls only for texts and pasted notes. For a Gmail source I used the same two calls and filtered the results by thread.
5. **Admin page scope.** "Words and fields" may not cover visibility or relationship. The skill also does not say whether an admin edit keeps the verbatim text in History the way `originalNote` does.
6. **Reply wording after an admin edit.** The skill never says to update the existing reply when Rob rewrites the note on the admin page. The rule against telling senders the words are exactly theirs implies it.
7. **Smaller gaps.** "Only if needed" for the second question call is undefined. "One spring" with no year may not count as the note stating a date. The read-back check is required only for drafts the skill creates or updates. The skill does not say whether the 409 reports mem_old's current words or visibility, which Rob would need in order to compare.
