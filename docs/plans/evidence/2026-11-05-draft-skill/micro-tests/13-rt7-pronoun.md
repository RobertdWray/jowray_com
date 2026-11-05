# Re-test 13: rt7-pronoun (after the tightening round)

Role-played by a fresh Explore subagent against the tightened SKILL.md (2026-11-05). Fictional people only.

A) Step 1 call: get_thread(threadId: "1a1a0000000000cc", messageFormat: "PLAIN_TEXT"). Sender's message id 1a1a000000000003, no attachments.

Verbatim cut. Hard wraps joined into one paragraph. Dropped "Rob," and "With love, Dana", and "You both must miss her terribly, and we do too." because it is addressed to the family and holds no memory.
```
Your mom and dad hosted us every Fourth of July at the lake. Your mom ran the whole show from the kitchen and still found time to teach my kids to fish off the dock. She was the first to call when you two moved into the new house.
```
The cut has no street, unit or phone number.

Rewrite as first proposed:
```
Jo and Richard hosted us every Fourth of July at the lake. Jo ran the whole show from the kitchen and still found time to teach my kids to fish off the dock. She was the first to call when you two moved into the new house.
```
Change list: `"Your mom and dad" -> "Jo and Richard"; "Your mom" -> "Jo"`. Open question: "you two" in the last sentence is left as written.

Other step 2 items: Dana Example, dana@example.org. Relationship inferred as "Family friend", from 'hosted us every Fourth of July at the lake'. When proposed as "Every Fourth of July". Where proposed as "The lake", from 'at the lake'. No attachment.

B) Six questions; the priority order put four in the first call and the overflow in the second.
First call:
1. Words. "How should Dana's note be saved?" Options: "Verbatim copy", "Light rewrite (as shown)". Rob picked the rewrite.
2. Visibility. "Who can see this memory once Dana presses Share?" Options: "Everyone who visits jowray.com (PUBLIC, default)", "The whole family (FAMILY)", "Richard, Rob and Tracy only (PRIVATE)". Rob picked FAMILY.
3. Pronoun. "'She was the first to call when you two moved into the new house.' Who is 'you two'?" Options: "Rob and Tracy", "Keep as written". Rob picked Rob and Tracy.
4. When. "Roughly when? Proposed from 'every Fourth of July'." Options: "Every Fourth of July", "Leave blank (the sender can fill it in)", "Ask the sender in the reply". Rob picked the proposed value.
Second call:
5. Where. "Where? Proposed from 'at the lake'." Options: "The lake", "Leave blank (the sender can fill it in)", "Ask the sender in the reply". Rob picked The lake.
6. Relationship. "Not stated. Inferred 'Family friend' from 'hosted us every Fourth of July at the lake'." Options: "Leave blank", "Family friend". Rob picked Leave blank.
No "you both" question (its sentence is outside the cut). No Name question (From line and signature agree). The pronoun answer changed the rewrite, so the final text was shown once more and Rob said "yes":
```
Jo and Richard hosted us every Fourth of July at the lake. Jo ran the whole show from the kitchen and still found time to teach my kids to fish off the dock. She was the first to call when Rob and Tracy moved into the new house.
```

C) JSON (scratchpad; command after the preflight: `npx tsx --env-file=/Users/rob/Documents/active_work/jowray_com/.env /Users/rob/Documents/active_work/jowray_com/scripts/draft-memory.ts --prod --input <scratchpad>/draft-dana.json`):
```json
{
  "contributor": { "name": "Dana Example", "email": "dana@example.org" },
  "note": "Jo and Richard hosted us every Fourth of July at the lake. Jo ran the whole show from the kitchen and still found time to teach my kids to fish off the dock. She was the first to call when Rob and Tracy moved into the new house.",
  "originalNote": "Your mom and dad hosted us every Fourth of July at the lake. Your mom ran the whole show from the kitchen and still found time to teach my kids to fish off the dock. She was the first to call when you two moved into the new house.",
  "approxDateText": "Every Fourth of July",
  "place": "The lake",
  "visibility": "FAMILY",
  "sourceInput": { "kind": "gmail", "messageId": "1a1a000000000003" }
}
```

D) Skipped.

E) The save went to production, created mem_r7 with a claim link, and printed "originalNote: recorded", which is what a rewrite needs, so step 4 may proceed.

F) Guesses:
- "your mom and dad": Who's who covered the parts, not the compound. Mapped to "Jo and Richard" without asking. (Added to Who's who after this run.)
- "you both": settled by the drop rule plus "a pronoun inside a sentence the cut drops needs no question".
- "you two" candidates: offered from Who's who, Rob's answer treated as the support; "Rob and Richard" left out as implausible. (Candidates-from-Who's-who sentence added after this run.)
- Question cap: four per call plus overflow is clear; whether the free-text row counts toward "two to four options" was unclear. (Clarified after this run.)
- Where: the note names the lake, the kitchen and the dock; picked the setting of the whole memory.
- Relationship wording "Family friend" is a guess; the skill's examples are Neighbor and Friend.
- First-name-only signature under a full From name treated as agreement, so no Name question.
