# Re-test 13: rt7-pronoun (after the tightening round)

Role-played by a fresh Explore subagent against the tightened SKILL.md (2026-11-05). Fictional people only.

The tightened skill handled the pronoun case correctly. The rewrite was saved as FAMILY with "you two" resolved to Rob and Tracy. "You both" was never asked about, because the verbatim cut drops that sentence. This was a role-play only: no command, Gmail call or question dialog actually ran. The full report, sections A to F, is in the team lead's inbox.

- **Cut and rewrite.** The cut keeps three of the four sentences, joined into one paragraph. The rewrite changes "Your mom and dad" to "Jo and Richard" and "Your mom" to "Jo", and leaves "you two" as an open question.
- **Questions.** Six were asked: four in the first call (Words, Visibility, Pronoun, When) and two in the second (Where, Relationship). Since the pronoun answer changed the text, the final text was shown again and Rob's stubbed answer was yes.
- **Saved fields.** The note is the rewrite, the original note is the verbatim cut, the date is "Every Fourth of July" and the place is "The lake". The relationship field was left out because Rob chose Leave blank.
- **Script output.** It printed "originalNote: recorded", which is the right result for a rewrite.

The skill is unclear in four places:
- **"Your mom and dad".** The skill covers "your mom", "your dad" and "your parents" separately, but not this combined phrase.
- **Where "you two" candidates come from.** Offering "Rob and Tracy" pulls against the rule never to use a name the message does not support.
- **The option count.** It is unclear whether the limit of two to four options counts the free-text row.
- **Which place to propose.** The note names the lake, the kitchen and the dock, and the skill does not say which to pick.
