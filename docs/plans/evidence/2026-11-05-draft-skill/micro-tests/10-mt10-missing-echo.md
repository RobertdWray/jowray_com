# Micro-test 10: mt10-missing-echo

Role-played by a fresh Explore subagent against the new SKILL.md (2026-11-05). Fictional people only.

Here is my complete report, sections A to F.

**A) Step 2 output**

Verbatim cut. The only change is joining the hard-wrapped lines:
```
I was so sorry to hear about your mom. Your mom always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!
```
Light rewrite, shown because the cut addresses Rob:
```
Jo always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!
```
Changes: dropped "I was so sorry to hear about your mom." and changed "Your mom" to Jo once. There are no open pronouns.
- **Sender:** Pat Example, pat@example.org.
- **Relationship:** "Neighbor", inferred from "at my feeder when she walked past". The note does not say it.
- **When:** not stated. "One spring" gives no year.
- **Where:** not stated. "my feeder" is Pat's home, not a named place.
- **Attachment:** none.

**B) AskUserQuestion calls**

Call 1 had four single-select questions:
- **Words:** "Verbatim copy" or "Light rewrite (as shown)". Rob chose the light rewrite.
- **Visibility:** "Everyone who visits jowray.com (PUBLIC, default)", "The whole family (FAMILY)" or "Richard, Rob and Tracy only (PRIVATE)". Rob chose PUBLIC.
- **When:** "Leave blank (the sender can fill it in)" or "Ask the sender in the reply". Rob chose Leave blank.
- **Where:** the same two options. Rob chose Leave blank.

Call 2 asked about relationship, with "Neighbor" or "Leave blank". The script's first option was Neighbor. There was no pronoun or name question, since the signature "Pat" matches the From line.

**C) JSON sent**

It was written to the scratchpad and deleted after the run.
```json
{
  "contributor": { "name": "Pat Example", "email": "pat@example.org", "relationship": "Neighbor" },
  "note": "Jo always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!",
  "originalNote": "I was so sorry to hear about your mom. Your mom always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!",
  "visibility": "PUBLIC",
  "sourceInput": { "kind": "gmail", "messageId": "1a1a000000000001" }
}
```
```
npx tsx --env-file=/Users/rob/Documents/active_work/jowray_com/.env /Users/rob/Documents/active_work/jowray_com/scripts/draft-memory.ts --prod --input <scratchpad>/pat-example.json
```

**D) Reply body**

None. The payload carried an original note, but the script printed no line confirming it was recorded. The hard rule says to stop and draft no reply. Step 4 never ran, so the stubbed draft lookup went unused.

**E) What I tell Rob**

"Stop: production did not confirm it kept Pat's original words. I sent the rewrite with the verbatim text attached, but the script printed no confirmation line. That means production is older than this skill. Draft mem_s10 exists, and its words are the rewrite only. Pat's verbatim text is not stored on the site; it survives only in Pat's email. Fix it on the admin page under Drafts by editing the words or deleting the draft. I have not drafted a reply, so Pat has received nothing. Nothing is public."

The row is memory mem_s10, status DRAFT, with the rewrite as its note. Its source is email, its source reference is the Gmail message id above, its contributor is Pat Example, and it has no consent time. I also sent PUBLIC visibility, Neighbor as the relationship, and no when or where. The script did not echo those back, so I do not claim them as confirmed.

**F) Unclear points and guesses**

1. **Closing lines.** The drop list in step 2 does not mention them. I dropped "Thinking of you both at this hard time." because it is not about Jo. The skill's example change list implies greetings and closings stay in the cut, which contradicts the drop list. Because I dropped the line, the "you both" question never came up and the scripted "Rob and Tracy" answer went unused.
2. **Condolence sentence.** I kept it in the verbatim cut because the cut works by whole paragraphs. The skill never says this outright.
3. **"One spring".** The skill does not say whether this counts as a stated time.
4. **Relationship question.** The skill says to ask it "if needed" but never defines that. I asked because the value is inferred and public by default.
5. **No check before saving.** The skill says to save verbatim only until production supports rewrites. The only way to check is the line printed after the save, so every rewrite against old production creates this defect row.
6. **Stop path gaps.** The skill does not say what to do with the claim link already issued. It does not say how Rob gets a reply later, since a re-run would hit the duplicate path and offer a reissue. It does not say what "edit the words" should change the note to, or whether step 5's report still applies after a stop.
7. **Unstubbed checks.** The preflight and mailbox checks had no stubs, so I assumed both passed.
