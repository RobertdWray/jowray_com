# Re-test 14: rt14-inline-condolence (after Team Code Review round 1)

Role-played by a fresh Explore subagent against the reviewed SKILL.md (2026-11-05). Fictional people only.

Inline-condolence verbatim re-test: verbatim save, PUBLIC, no originalNote, no Pronoun question, reply drafted to Pat only.

A) Source: get_thread(threadId: "1a1a0000000000aa", messageFormat: "PLAIN_TEXT"). Sender's message id is 1a1a000000000001. No attachments.

Verbatim cut:
```
I was so sorry to hear about your mom. Your mom always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!
```
- Dropped: "Dear Rob," (greeting), "Thinking of you both at this hard time." (standalone condolence line), "Pat" (sign-off), "Sent from my iPhone" (signature).
- Kept: the whole memory paragraph, all three sentences, including the inline condolence sentence "I was so sorry to hear about your mom."
- Normalisation: the four hard-wrapped lines were joined. The cut has no street, unit or phone number.

Rewrite shown, because the cut addresses Rob and carries an inline condolence sentence:
```
Jo always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!
```
Changes: dropped 'I was so sorry to hear about your mom.'; Your mom → Jo ×1.

Details: Pat Example <pat@example.org>. Relationship inferred "Neighbor", from 'when she walked past' plus 'my feeder'. When is not stated, because "One spring" is a bare season. Where is "Pat's feeder", from 'the birds at my feeder'. No attachment.

B) First AskUserQuestion call:
1. Words: "Which words should Pat's memory use?" Options: "Verbatim copy" / "Light rewrite (as shown)". Answer: Verbatim copy.
2. Visibility: "Who should see this memory once Pat shares it?" Options: "Everyone who visits jowray.com (PUBLIC, default)" / "The whole family (FAMILY)" / "Richard, Rob and Tracy only (PRIVATE)". Answer: PUBLIC.
3. When: "The note names no time a reader can place ('One spring'). What should the date field hold?" Options: "Leave blank (the sender can fill it in)" / "Ask the sender in the reply". Answer: Leave blank.
4. Where: "Where did this happen?" Options: "Pat's feeder" / "Leave blank (the sender can fill it in)" / "Ask the sender in the reply". Answer: Leave blank.

Second call, for the overflow:
5. Relationship: "Relationship is inferred from 'when she walked past' and 'my feeder'. What should it say?" Options: "Leave blank" / "Neighbor". Answer: the first option, Leave blank.

No Pronoun question was asked. In a letter to Rob, "your mom" and "she" need no question. "You both" appears only in a line the cut drops. Even if one had been asked, choosing Verbatim copy would mean it was ignored. No Name question was asked either: the signature "Pat" agrees with the From name "Pat Example".

C) Final JSON, written in the scratchpad and deleted after the run:
```json
{
  "contributor": { "name": "Pat Example", "email": "pat@example.org" },
  "note": "I was so sorry to hear about your mom. Your mom always stopped to watch the birds at my feeder when she walked past, and she knew every one of them by name. One spring she brought me a bag of seed because she said my cardinals looked thin!",
  "visibility": "PUBLIC",
  "sourceInput": { "kind": "gmail", "messageId": "1a1a000000000001" }
}
```
originalNote is left out because note equals the cut. relationship, approxDateText and place are left out because each was answered Leave blank.

D) Calls in order:
- list_drafts(query: "to:pat@example.org") found nothing.
- create_draft(replyToMessageId: "1a1a000000000001", subject: "Re: So sorry about your mom", to: ["pat@example.org"]), with no cc and no bcc.
- get_draft read-back: to is exactly pat@example.org, cc and bcc are empty, so it passes. The draft is not sent.

Body:
```
Hi Pat,

Thank you for the memory of Mom stopping at your feeder and knowing every bird by name.

I've saved it to Mom's memorial in your own words:

https://www.jowray.com/m/SYNTHETIC_TOKEN

Change anything, add a photo or a recording, and press Share when it's right. No need to do anything if you'd rather not.

Rob
```

E) The script hit www.jowray.com and saved draft mem_r14. "originalNote: NOT recorded" is the correct result for a verbatim save, so step 4 went ahead.

F) Unclear points and guesses:
- **Change-list count.** Line 76's example says "your mom → Jo ×2" for what looks like this same note. Once the condolence sentence is dropped, only one "your mom" is left, so ×2 counts a word in a dropped sentence. I wrote ×1. The skill should say whether counts are taken after drops.
- **Where.** The skill does not say whether "my feeder" names a place the way "her kitchen" does. It also does not say how to phrase a first-person place in the field. I guessed "Pat's feeder".
- **Name.** "Disagree" is not defined. I treated a first-name-only signature as agreeing with the From line.
- **Question wording.** The skill gives headers and option labels but no question text, so I wrote my own.
- **Reply.** The greeting and sign-off are not specified. I chose "Hi Pat," and "Rob", and used "Mom's" rather than "Jo's" because Pat wrote "your mom".
- **Preflight.** The preflight and the mailbox check were skipped because the brief forbids commands. The skill says to run them every time.
