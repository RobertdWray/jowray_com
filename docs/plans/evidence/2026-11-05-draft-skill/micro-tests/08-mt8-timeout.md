# Micro-test 8: mt8-timeout

Role-played by a fresh Explore subagent against the new SKILL.md (2026-11-05). Fictional people only.

I sent the report to the team lead's inbox again. The full report is below as well, in case messages still aren't getting through.

**Outcome:** the dialog timed out, so nothing is saved and no reply is drafted. I ask Rob all four questions again when he is back.

**A) Step 2 output.** Step 1 reads the thread with get_thread (thread "1a1a0000000000aa", plain text). The sender's message id, 1a1a000000000001, goes into the source input, and the script derives the source reference from it.

Verbatim cut:
```
I was so sorry to hear about your mom. Your mom always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!
```
The cut speaks to Rob, so a light rewrite is shown too:
```
Jo always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!
```
```
dropped "I was so sorry to hear about your mom."; Your mom → Jo ×1
```
Both versions drop "Dear Rob,", "Thinking of you both at this hard time.", "Pat" and "Sent from my iPhone". There are no unclear pronouns: "she" is always Jo, and "you both" was only in the dropped closing line.
- **Sender:** Pat Example, pat@example.org.
- **Relationship:** "Neighbor". This is a guess from "when she walked past", not something the note says.
- **Roughly when:** not stated. "One spring" gives no year.
- **Where:** "At Pat's bird feeder", from "the birds at my feeder".
- **Attachment:** none.

**B) The question dialog.** One AskUserQuestion call with four questions, one choice each:
1. **Words.** "Which text should be saved as Pat's draft memory?" Options are "Verbatim copy" and "Light rewrite (as shown)".
2. **Who may see it.** "Who may see this memory once Pat shares it?" Options are "Everyone who visits jowray.com (PUBLIC, default)", "The whole family (FAMILY)" and "Richard, Rob and Tracy only (PRIVATE)".
3. **Roughly when.** "The note doesn't say when. What should the date field hold?" Options are "Leave blank (the sender can fill it in)" and "Ask the sender in the reply".
4. **Where.** "Where should the memory say it happened?" Options are "At Pat's bird feeder", "Leave blank (the sender can fill it in)" and "Ask the sender in the reply".

**C) Input file: none.** The skill says only an answered question authorises a save. A dialog that timed out with partial picks authorises nothing. PUBLIC is also the API default, which the skill says is not a visibility choice. Rob never chose the words either, so there is no approved text to save.

**D) Reply: none.** The reply needs the claim link that the save step produces, and that step never ran. I make no Gmail draft calls.

**E) After the timeout.** I stop before the save step. I write no input file, run neither the preflight check nor the script, and create no Gmail draft. I say to Rob:

> "The question dialog for Pat Example's note timed out before you answered, so nothing is saved and no reply is drafted. The dialog had recorded PUBLIC for who may see it, but I'm not treating a half-finished dialog as your choice. When you're back, say carry on and I'll ask all four questions again."

Then I end the turn. When Rob replies, I send the same four questions again, including who may see it, with nothing pre-selected.

**F) Where SKILL.md was unclear or I guessed**
1. **What the verbatim cut keeps.** The skill says to drop greetings and signatures from the cut. Its sample change list says "dropped 'Dear Rob' and the closing line", which suggests those can stay in the cut. I kept the condolence sentence because it sits inside the memory paragraph.
2. **When to ask again.** The skill says to ask again but not when. Asking right away would likely time out again while Rob is away, so I waited for him.
3. **Partial picks.** The rule to skip questions Rob already answered in chat could be misread as covering a pick from a dialog that timed out. One sentence saying a timed-out dialog answers nothing would fix this.
4. **Header length.** I believe the question dialog limits headers to about 12 characters. "Who may see it" is 14, and the skill gives no shorter header.
5. **Time words inside the story.** I treated "One spring" with no year as not stated. The skill doesn't say whether such a phrase counts as a date to propose.
6. **Guessed relationship.** The skill doesn't say whether a guessed relationship should be marked as a guess. It also doesn't say whether a guess calls for the optional second question about the relationship.
