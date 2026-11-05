# Micro-test 5: mt5-about-jo

Role-played by a fresh Explore subagent against the new SKILL.md (2026-11-05). Fictional people only.

Micro-test 5 result: Sam's note already reads as a memory about Jo, so I showed no rewrite. The memory is saved verbatim and PUBLIC. The street address is dropped, but the street name "Maple Court" stays inside Sam's sentence and is flagged to Rob. Nothing was run: no commands, no file writes, no Gmail or question calls.

**A) Step 1, stubbed.** I would send the call below. I picked Sam's message and kept its id for the save. There are no attachments.

```
get_thread(threadId: "1a1a0000000000bb", messageFormat: "PLAIN_TEXT")
```

**Step 2, as shown to Rob.** The verbatim cut joins the hard-wrapped lines into one paragraph and drops the signature and address:

```
Jo was my neighbor on Maple Court for twenty years. She always stopped to watch the birds at my feeder and knew every one of them by name. In the summer of 1998 she talked me into planting a hydrangea by the mailbox, and it is still there.
```

- **No rewrite.** The note already reads as a memory about Jo, not a letter to the family. The skill allows a rewrite only when the text addresses the family.
- **Street flag.** The note names the street. The no-street rule covers only the relationship field and the reply, so the street stays in the note. If Rob wants it out of a public memory, he can type a replacement in the Words question.
- **Sender.** Sam Example, sam@example.org. The proposed relationship is "Neighbor".
- **Roughly when.** I proposed "Summer 1998", from the phrase "In the summer of 1998". That phrase dates the hydrangea story, not the twenty years.
- **Where.** I proposed nothing. The only place in the note is the street name, and I kept it out of a structured field.
- **Attachment.** None.

**B) Questions to Rob.** The first call has four single-select questions:

1. **Words:** "Save Sam's note as the verbatim copy, or should I propose a light rewrite?" The options are "Verbatim copy" and "Propose a light rewrite".
2. **Visibility:** "Who may see this memory once Sam shares it?" The options are "Everyone who visits jowray.com (PUBLIC, default)", "The whole family (FAMILY)" and "Richard, Rob and Tracy only (PRIVATE)".
3. **When:** "Roughly when? The note says 'In the summer of 1998'." The options are "Summer 1998", "Leave blank (the sender can fill it in)" and "Ask the sender in the reply".
4. **Where:** "Where? The note names only a street, which I am not proposing for a public field." The options are "Leave blank (the sender can fill it in)" and "Ask the sender in the reply".

The scripted answers were verbatim, PUBLIC, "Summer 1998" and leave blank. A second call asked one question, "Relationship line under Sam's name?", with the options "Neighbor" and "Leave blank". Rob chose "Neighbor". I asked no name question, because the From line and the signature agree. Rob edited nothing, so no final-text confirmation was needed.

**C) Input file.** It would be written to /private/tmp/claude-501/-Users-rob-Documents-active-work-jowray-com/de2056d0-2f2c-4b78-bed1-3276a1a5636b/scratchpad/draft-memory-sam.json with this content:

```json
{
  "contributor": { "name": "Sam Example", "email": "sam@example.org", "relationship": "Neighbor" },
  "note": "Jo was my neighbor on Maple Court for twenty years. She always stopped to watch the birds at my feeder and knew every one of them by name. In the summer of 1998 she talked me into planting a hydrangea by the mailbox, and it is still there.",
  "approxDateText": "Summer 1998",
  "visibility": "PUBLIC",
  "sourceInput": { "kind": "gmail", "messageId": "1a1a000000000002" }
}
```

The file has no original-note field because this is a verbatim save. It has no place because Rob chose to leave it blank. The preflight check runs first, then the command below, and then the file is deleted.

```
npx tsx --env-file=/Users/rob/Documents/active_work/jowray_com/.env /Users/rob/Documents/active_work/jowray_com/scripts/draft-memory.ts --prod --input /private/tmp/claude-501/-Users-rob-Documents-active-work-jowray-com/de2056d0-2f2c-4b78-bed1-3276a1a5636b/scratchpad/draft-memory-sam.json
```

The street address "14 Maple Court, Apt 2B" went out with the signature. It is not in the file, and it would not appear in the relationship or the reply.

**D)** Skipped.

**E) Script output checks.**

- **Target line.** "www.jowray.com" shows the production flag reached the live site, not localhost or a preview.
- **Memory id.** "mem_s5" shows a row was saved. There was no duplicate, auth or budget error.
- **Claim link.** It is on the same host and uses the /m/ path, so it is the link for the reply. It works as a password for the memory, so I would never open it.
- **"originalNote: NOT recorded".** This is expected because no original note was sent. It means stop only after a rewrite.

**F) Unclear or guessed.**

1. **Street names in a note.** The no-street rule names only the relationship field and the reply. This note is public by default and names Jo's street, which may still be Richard's. The rewrite rules forbid removing it. I flagged it and kept it, and the skill should say whether to flag this.
2. **Place field.** The no-street rule does not cover it, and I chose not to propose the street. The skill's example "Neighbor at Broadmead" leaves the line between a community name and a street undefined.
3. **Relationship question.** Words, visibility, when and where fill the first call. It is unclear whether relationship needs a second call or whether the proposal stands unasked. I asked.
4. **Date format.** The skill gives no format for the rough date. It also gives no rule for a memory that spans years with only one dated moment.
5. **Rewrite option.** The skill requires a "Propose a light rewrite" option even after saying a rewrite has nothing to change. That reads oddly to Rob.
6. **Hard-rule wording.** Read alone, the "NOT recorded, stop" sentence would also stop a verbatim save. Only its bold lead-in and step 3 limit it to rewrites. It should start with "After a rewrite,".
7. **Preflight placement.** The preflight is labelled "every run" but has no place in the numbered steps. I put it right before the script in step 3.
