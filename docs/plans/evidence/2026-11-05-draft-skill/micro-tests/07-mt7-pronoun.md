# Micro-test 7: mt7-pronoun

Role-played by a fresh Explore subagent against the new SKILL.md (2026-11-05). Fictional people only.

I sent the full report to the team lead again through SendMessage. The delivery succeeded, as it did the first time. The same report follows here.

**A) Step 2 output.** Step 1 reads the thread with `get_thread(threadId: "1a1a0000000000cc", messageFormat: "PLAIN_TEXT")`. The sender's message id gives the source reference `gmail:1a1a000000000003`. There are no attachments.

The verbatim cut joins the wrapped lines and drops the greeting and sign-off:
```
Your mom and dad hosted us every Fourth of July at the lake. Your mom ran the whole show from the kitchen and still found time to teach my kids to fish off the dock. You both must miss her terribly, and we do too. She was the first to call when you two moved into the new house.
```
I proposed this light rewrite because the cut speaks to the family:
```
Jo and Richard hosted us every Fourth of July at the lake. Jo ran the whole show from the kitchen and still found time to teach my kids to fish off the dock. She was the first to call when you two moved into the new house.
```
- **Changes.** "Your mom and dad" became "Jo and Richard", and "Your mom" became "Jo". I dropped "Rob,", the condolence sentence "You both must miss her terribly, and we do too." and "With love, Dana". "You two" stayed as written.
- **Sender.** Dana Example, dana@example.org. I proposed "Family friend" as the relationship, which the note does not state.
- **When and where.** I proposed "Every Fourth of July" and "The lake", taken from "every Fourth of July" and "at the lake".
- **Open question.** Who "you two" are: Rob and Tracy, or Rob and Richard.

**B) Question calls.** Each question takes a single choice.

The first call asks four questions:
1. **Words** offers "Verbatim copy" or "Light rewrite (as shown)". Rob chose the light rewrite.
2. **Who sees it** offers "Everyone who visits jowray.com (PUBLIC, default)", "The whole family (FAMILY)" or "Richard, Rob and Tracy only (PRIVATE)". Rob chose FAMILY.
3. **When** offers "Every Fourth of July", "Leave blank (the sender can fill it in)" or "Ask the sender in the reply". Rob chose the first option.
4. **Where** offers "The lake" or the same two blank options. Rob chose the first option.

The second call holds what did not fit under the four-question cap:
1. **'you two'** quotes the sentence and offers "Rob and Tracy", "Rob and Richard" or "Keep 'you two' as written". Rob chose Rob and Tracy.
2. **Relationship** offers "Family friend" or "Leave blank". Rob chose Family friend.

A third call shows the final text and asks "Yes, save it" or "No, change it". Rob said yes. No question was asked about "you both", because the rewrite drops that sentence.

**C) Final input file.**
```json
{
  "contributor": { "name": "Dana Example", "email": "dana@example.org", "relationship": "Family friend" },
  "note": "Jo and Richard hosted us every Fourth of July at the lake. Jo ran the whole show from the kitchen and still found time to teach my kids to fish off the dock. She was the first to call when Rob and Tracy moved into the new house.",
  "originalNote": "Your mom and dad hosted us every Fourth of July at the lake. Your mom ran the whole show from the kitchen and still found time to teach my kids to fish off the dock. You both must miss her terribly, and we do too. She was the first to call when you two moved into the new house.",
  "approxDateText": "Every Fourth of July",
  "place": "The lake",
  "visibility": "FAMILY",
  "sourceInput": { "kind": "gmail", "messageId": "1a1a000000000003" }
}
```
After the preflight check, I would print this command:
```
npx tsx --env-file=/Users/rob/Documents/active_work/jowray_com/.env /Users/rob/Documents/active_work/jowray_com/scripts/draft-memory.ts --prod --input <scratchpad>/draft-dana.json
```

**D)** Skipped.

**E) Checks on the script output.**
- **Target.** It is www.jowray.com, so the run reached production.
- **Claim link.** It uses the same host and a /m/ path. I would never open it.
- **Original note.** "originalNote: recorded" is required because the input carried the verbatim cut. "NOT recorded" or a missing line would mean stop and draft no reply.
- **Errors.** No 409, 401 or 429 appeared. The memory id mem_s7 goes into the step 5 report.
- **Cleanup.** Delete the input file afterwards.

**F) Where SKILL.md was unclear.**
1. **"Your mom and dad".** The skill's list of who is who says "your dad" is Richard. The skill also forbids swapping in names by rule, and this message never names Richard. It does not say whether to write "Richard", "Dad" or "Rob's dad".
2. **"You both".** It sits in a dropped condolence sentence, so Rob's scripted answer went unused. The skill does not say whether a pronoun in a dropped sentence still needs a question.
3. **"You two".** Choosing the rewrite "as shown" approves text that still says "you two". The skill re-shows the final text only after Rob edits it. I counted the pronoun answer as an edit and confirmed again. The skill also says nothing about Rob choosing to keep "you two", which leaves the memory speaking to Rob.
4. **Question cap.** The required questions plus one pronoun make five, and the cap is four. I moved the pronoun question into the second call, so a verbatim choice skips it.
5. **When and where.** These questions are not marked as always asked. It is unclear whether a recurring date with no year counts as "roughly when".
6. **Relationship.** The skill never defines when the second call is "needed". I asked because I had inferred the relationship.
7. **Missing stubs.** The preflight check and the mailbox check had no stubbed output. I assumed both pass.
