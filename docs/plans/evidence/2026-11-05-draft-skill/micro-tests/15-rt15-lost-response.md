# Re-test 15: rt15-lost-response (after Team Code Review round 1)

Role-played by a fresh Explore subagent against the reviewed SKILL.md (2026-11-05). Fictional people only. Scenario: a previous session ran a rewrite payload and died before seeing the output; the resumed session has Rob's repeated answers ("rewrite and FAMILY, nothing else").

**A) What I did first on resuming.** The skill had no resume path, so I restarted the Procedure (preflight and mailbox check assumed to pass; `get_thread` on 1a1a0000000000aa; message id 1a1a000000000001). I redid step 2 because my rewrite is newly generated and the hard rule says "Never save text Rob has not seen." Rob's chat answer settled Words, Visibility and the blanks; I asked one plain yes on the shown text and assumed it.

**B) The script call.** Payload: Pat Example / pat@example.org; `note` = the rewrite ("Jo always stopped to watch the birds at my feeder…"); `originalNote` = the verbatim cut ("I was so sorry to hear about your mom. Your mom always stopped…"); `visibility: FAMILY`; `sourceInput { kind: gmail, messageId: 1a1a000000000001 }`. Output: target www.jowray.com, 409 duplicate, memoryId mem_old, status DRAFT, no `originalNote:` line. A draft already exists, almost certainly from the dead session. Nothing from this attempt was applied: not the rewrite, not FAMILY, not the blanks. `sourceInput` left unchanged.

**C) The Gmail check.** `list_drafts(query: "to:pat@example.org")` → nothing; `search_threads(query: "in:sent to:pat@example.org jowray.com/m/")` → nothing. The link was lost between the POST and the Gmail draft (for the mailbox the connector is on).

**D) Reissue and reply.** Offered `--prod --reissue mem_old` with the warning; Rob said yes; assumed a new claim link; no Gmail draft to update. **Drafted no reply.** Rob read the row on /admin: its words differ from the cut, so it is a rewrite; History's only revision starts from an empty note, so there is no `before.note`. Rule applied: "a rewrite with an empty `before` → the unrecorded-rewrite defect (hard rule): fix it on the admin page first, and draft no reply until then. A reissue never clears this check; it only replaces the link."

**E) What I tell Rob.** Pat's note already has a draft, mem_old, still DRAFT, made by the earlier session; today's run saved nothing. The row holds Pat Example, FAMILY, no relationship, date or place, and the rewrite. Pat's own words are not in the row; they survive only in Pat's Gmail message. The new link is live, unsent and a bearer token; any earlier link is dead. Before any reply, fix the row on /admin; then I re-check the row and draft the reply with the matching saved line.

**F) Unclear or guessed.**
1. No resume section; "skip any question Rob already answered" vs "never save text Rob has not seen" for a regenerated rewrite. (Resume paragraph added after this run.)
2. "Nothing else" read as Leave blank for When, Where and Relationship. (Stated after this run.)
3. Re-POSTing was the only lookup; checking /admin first would be read-only. (Adopted.)
4. The 409 branch offered the reissue before the admin check; the fix may be deletion, which wastes the reissue. (Reordered after this run.)
5. The Gmail-source check named no queries; ran the text-message queries too.
6. "Fixed" undefined for a kept rewrite; whether deletion frees the `sourceRef`. (Stated after this run: edit the words back to the verbatim paragraph; a deleted draft keeps its `sourceRef`.)
7. Not stubbed: preflight, mailbox and reissue outputs.
