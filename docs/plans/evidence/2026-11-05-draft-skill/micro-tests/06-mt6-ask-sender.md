# Micro-test 6: mt6-ask-sender

Role-played by a fresh Explore subagent against the new SKILL.md (2026-11-05). Fictional people only.

I re-sent the full report to team-lead, and the message went through. The complete text is below in case it still doesn't arrive.

**A) Step 2 output**

Verbatim cut:
```
Rob I'm so sorry. Your mother taught me to make pie crust in her kitchen and never once laughed at my attempts. Love to you and Tracy.
```
Light rewrite, shown because the cut addresses Rob:
```
Jo taught me to make pie crust in her kitchen and never once laughed at my attempts.
```
- **Changes:** dropped "Rob I'm so sorry." and "Love to you and Tracy.", and changed "Your mother" to "Jo" once. No pronouns are left open.
- **Sender:** Lee Example at lee@example.org, from number +14105550100, arrived 2026-11-04T18:20-05:00.
- **Details:** relationship and roughly when are not stated. Where is proposed as "Jo's kitchen", from the phrase "in her kitchen". There is no attachment.

**B) The question call**

I made one call with four questions:
1. **Words:** "Verbatim copy" or "Light rewrite (as shown)". Rob chose the rewrite.
2. **Who may see:** "Everyone who visits jowray.com (PUBLIC, default)", "The whole family (FAMILY)" or "Richard, Rob and Tracy only (PRIVATE)". Rob chose PUBLIC.
3. **When:** "Leave blank (the sender can fill it in)" or "Ask the sender in the reply". There are only two options because the text gives no time. Rob chose to ask.
4. **Where:** "Jo's kitchen", "Leave blank (the sender can fill it in)" or "Ask the sender in the reply". Rob chose to leave it blank.

There was no second call, no pronoun question and no final-text check, because Rob did not edit.

**C) Input file**
```json
{
  "contributor": { "name": "Lee Example", "email": "lee@example.org" },
  "note": "Jo taught me to make pie crust in her kitchen and never once laughed at my attempts.",
  "originalNote": "Rob I'm so sorry. Your mother taught me to make pie crust in her kitchen and never once laughed at my attempts. Love to you and Tracy.",
  "visibility": "PUBLIC",
  "sourceInput": { "kind": "sms", "number": "+14105550100", "sentAt": "2026-11-04T18:20-05:00", "text": "Rob I'm so sorry. Your mother taught me to make pie crust in her kitchen and never once laughed at my attempts. Love to you and Tracy." }
}
```
The preflight step had no stub, so I assumed it passed. The command I would run:
```
npx tsx --env-file=/Users/rob/Documents/active_work/jowray_com/.env /Users/rob/Documents/active_work/jowray_com/scripts/draft-memory.ts --prod --input <scratchpad>/draft-lee.json
```
The stub printed "originalNote: recorded" for the rewrite, so the save passes.

**D) Reply draft**

The search for existing drafts to Lee found nothing. The new draft goes to lee@example.org only, with no cc or bcc, under the subject "A memory of Jo".
```
Lee,

Thank you for your text, and for the memory of my mother teaching you pie crust in her kitchen.

I've saved it on her memorial page. I trimmed your note lightly so it reads as your memory of Jo on the page rather than a letter to me; please change anything that isn't how you'd say it.

https://www.jowray.com/m/SYNTHETIC_TOKEN

Change anything, add a photo or a recording, and press Share when it's right. If you remember roughly when this was, there's a spot for it on the page.

No need to do anything if you'd rather not.

Rob
```
The read-back shows Lee as the only recipient with cc and bcc empty, so it passes.

**E) Step 5 report to Rob**
- **Gmail draft:** its link comes from the draft creation result, which was not stubbed.
- **Claim link:** https://www.jowray.com/m/SYNTHETIC_TOKEN. Anyone holding it can edit the memory.
- **Text:** it is the light rewrite, and Lee's full original is recorded in the first revision.
- **Details:** visibility is PUBLIC. Where and relationship are blank, and the reply asks Lee roughly when it was.
- **Next:** nothing is public until Lee presses Share. Rob can watch memory mem_s6 move from DRAFT to PENDING on the admin page. The family-admin alert fires after Lee shares.

**F) Unclear or guessed**
1. **Greetings inside one paragraph:** "Drop greetings… signatures" conflicts with the rewrite's drop list and sample change list. Those imply inline greetings survive the cut. I kept the whole paragraph as the verbatim cut.
2. **Where:** your brief said the text gives no place, but "in her kitchen" is one. The skill doesn't say whether a home kitchen counts or whether "her" may become "Jo's". Rob's "Leave blank" gives the same result either way.
3. **No relationship stated:** the skill has no rule for this. A question with one option would break its two-to-four rule, so I left the field out without asking.
4. **Arrival time versus sent time:** step 1 asks when the text arrived, but the field records when it was sent. Duplicate detection is keyed on that minute, so a different minute could create a second draft.
5. **"In this thread" for a text:** a text message has no Gmail thread. I treated any draft to Lee's address as a match.
6. **Saying it was saved:** the required rewrite sentence never says "saved", so I added a line.
7. **Rob's voice:** the skill doesn't say what Rob calls Jo. I wrote "my mother".
8. **Which mailbox:** the skill only explains the mailbox check for Gmail sources.
9. **Missing stubs:** the preflight output and the draft's Gmail link were not stubbed.
