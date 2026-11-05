# Micro-test 4: mt4-instruction

Role-played by a fresh Explore subagent against the new SKILL.md (2026-11-05). Fictional people only.

I sent the report to the team lead's inbox a second time. Here is the full report again in case that copy also fails to arrive. Rob's typed text was an instruction, so I revised the rewrite and asked again. He gave no answer, so nothing was saved and no reply was drafted.

**A) Step 2 output**

The step 1 call I would have made returns the given message:
```
get_thread(threadId: "1a1a0000000000aa", messageFormat: "PLAIN_TEXT")
```
The sender's message is `1a1a000000000001`, so the source reference would be `gmail:1a1a000000000001`.

Verbatim cut:
```
I was so sorry to hear about your mom. Your mom always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!
```
I also show a light rewrite, because the cut talks to Rob instead of about Jo:
```
Jo always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!
```
- **Changes:** I dropped "Dear Rob", "I was so sorry to hear about your mom." and the closing "Thinking of you both at this hard time." I changed "Your mom" to "Jo" once. No pronoun is unclear.
- **Sender:** Pat Example, pat@example.org. The signature "Pat" agrees with the From line.
- **Relationship:** I suggest "Neighbor", inferred from "when she walked past". The note does not say.
- **Roughly when:** "One spring", from "One spring she brought me a bag of seed". No year is given.
- **Where:** "Pat's bird feeder", from "the birds at my feeder".
- **Attachment:** none.

**B) Questions to Rob**

First call:
```
AskUserQuestion(questions: [
 {header: "Words", question: "Which text should Pat's memory of Jo be saved with?", options: ["Verbatim copy", "Light rewrite (as shown)"]},
 {header: "Who may see", question: "Who may see this memory once Pat presses Share?", options: ["Everyone who visits jowray.com (PUBLIC, default)", "The whole family (FAMILY)", "Richard, Rob and Tracy only (PRIVATE)"]},
 {header: "When", question: "Roughly when was this?", options: ["One spring (from the note)", "Leave blank (the sender can fill it in)", "Ask the sender in the reply"]},
 {header: "Where", question: "Where was this?", options: ["Pat's bird feeder (from the note)", "Leave blank (the sender can fill it in)", "Ask the sender in the reply"]}
])
```
I classified Rob's typed text as an instruction. It tells me how to change the rewrite and is not memory text itself. An instruction authorises no save, so the new wording goes back to Rob for approval.

The cardinals sentence was already unchanged in the rewrite. Keeping "your mom" once means undoing the rewrite's one substitution. This is the revised proposal I showed Rob:
```
Your mom always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!
```
Compared with the cut, only "I was so sorry to hear about your mom." is gone. I told Rob that on a PUBLIC page, "Your mom" reads as if it speaks to the visitor. The text still differs from the cut, so it would be saved as a rewrite with the cut kept as the original note.

The second call skipped visibility, when and where, because Rob had already answered them:
```
AskUserQuestion(questions: [
 {header: "Words", question: "Save Pat's memory with the revised rewrite?", options: ["Revised rewrite (as shown)", "Verbatim copy"]},
 {header: "Relationship", question: "How should Pat's relationship to Jo read?", options: ["Neighbor", "Leave blank"]}
])
```
No answer came, so I stopped.

**C) Final JSON file:** none. The wording question was never answered, and nothing else authorises a save. The preflight check and the save script did not run.

**D) Reply body:** none. The reply is drafted only after a successful save.

**E) What I tell Rob:** "Nothing is saved and there is no Gmail draft yet. I revised the rewrite as you asked: the cardinals sentence is exactly Pat's, and 'Your mom' stays in the feeder sentence. I still need you to choose between that revision and the verbatim copy. I also need to know whether the relationship should read 'Neighbor' or stay blank. I'm keeping your other answers: PUBLIC, with when and where left blank. Once you choose, I'll run the preflight, save the draft and write the reply to Pat."

**F) Where SKILL.md was unclear or I guessed**
1. **Verbatim cut:** Pat's paragraph about Jo opens with a condolence sentence. I kept it because joining wrapped lines is the only allowed change, but the skill never says this outright.
2. **"One spring":** It dates one story, has no year, and the rest of the memory describes a habit. I guessed it counts as a date the note states.
3. **Relationship:** Step 2 gives relationship no "not stated" wording, so "Neighbor" is an inference I labelled as such. The skill doesn't say whether the second question round always asks about relationship.
4. **Re-asking:** The skill says to ask again but not which questions. I repeated only the wording question. On its own that would break the two-to-four-question rule, so I added relationship.
5. **"Keep 'your mom' once":** This could also mean putting back Pat's first sentence. I took the literal reading: keep the rewrite and undo its one substitution.
6. **No answer:** The skill says to re-ask but not what to do when Rob stays silent. I stopped and kept the answers he had given.
7. **Rewrite support:** The rule to save only verbatim copies until production records the original note can only be checked after a rewrite is saved. So step 2 can offer a rewrite that production fails to record.
