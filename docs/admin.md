# Family admin page

`https://www.jowray.com/admin`: the family's view of every memory. Plan and decisions: [plans/2026-11-04-admin-page.md](plans/2026-11-04-admin-page.md). What was built and why, in two pages: [features/admin-panel.md](features/admin-panel.md).

## What it does

- Lists every memory (newest first, 200 at a time, with status chips, a search box and a Deleted toggle).
- Opens one memory: the words and fields can be edited (name, relationship, roughly when, where, the words, who can see it); the person's email and their own preferences cannot (a typo in the email would hand their edit link to a stranger, and the preferences are theirs to give).
- Approve, Hide, Back to pending. Approving does not publish anything yet: the public memorial pages are not built.
- Delete and Restore (below).
- Draft a memory for someone from words they sent by email, text or card, and get the private link to send them by hand.
- Files are view-only here: thumbnails, players and upload state. Adding, replacing or removing files happens on the person's own claim page.

## Getting in

Rob sends each family member one link, by a private channel: `https://www.jowray.com/admin/enter#key=<secret>`. Open it once in the browser you will keep using (a link tapped inside Mail or Messages signs in that app's built-in browser, not Safari). The page reads the key from the `#` part of the address, drops it from the address bar, and asks the server to sign you in. The server sets a cookie that lasts 30 days and sends you to `/admin`; bookmark that. If a messaging app stripped the `#key=` part, paste the key into the box on `/admin/enter`.

Why the `#`: a fragment is never sent to any server, so the secret appears in no request log, no `Referer` and no error report. The cookie holds a signature derived from the secret, never the secret itself, so a new secret signs everyone out.

**Residual exposure, accepted:** the browser history entry for the entry link on the family member's device; Vercel's request log for `POST /admin/enter` (method and path only; the key travels in the request body). Nothing else carries the secret.

## Rotating the secret

1. Generate a new value: `openssl rand -hex 32`.
2. Set `ADMIN_PAGE_SECRET` in Vercel → Production (never Preview) and in Rob's local `.env`.
3. Redeploy production.
4. Verify: the old entry link fails on `https://www.jowray.com/admin/enter`; an old cookie shows the signed-out page; with Standard Protection on, the previous deployment's `*.vercel.app` URL asks for a Vercel login (an older deployment keeps the environment values it was built with, so without Standard Protection the old secret would still open the admin page there).
5. Send the new link to the family.

## What "deleted" means

Delete takes the memory out of the family's view at once and its claim link stops working. The files stay for 30 days: Restore within that time brings everything back. After 30 days the reconcile cron removes the files; before it deletes the first byte it marks each file (`Media.purgedAt`) and flips it to FAILED, so a crash or a Restore in the middle can never leave a file that looks present but is gone. A Restore after that brings back the words; the admin page says which files are gone, and the person can add them again on their claim page. Nothing is ever hard-deleted.

**Rollback floor.** Once any memory has been deleted from this page, never roll production back to a deployment older than the merge of the admin page: that older cron purges deleted memories on its next run with no grace and ignores `purgedAt`. If an older build must run anyway, first disable cron jobs at the project level (Vercel → project → Settings → Cron Jobs → Disable Cron Jobs; the setting persists across Instant Rollback and promotions), confirm no `/api/cron/reconcile-uploads` request appears at the next scheduled minute, then roll back; re-enable only on a build at or above the floor.

## Drafts

A DRAFT is a memory the family saved on someone's behalf (from this page, or from the `jowray-draft-memory` skill). It is invisible and silent until that person opens their link and presses Share, which is their consent; the admin page can edit a draft's words and make a new link (any earlier link stops working), but cannot approve it. Browser drafts are recorded as "pasted by the family"; a Gmail message or a text reference is recorded only by the script and the skill. A skill draft may be a light rewrite of the sender's note (Rob's choice, 2026-11-05): History then shows the sender's exact words as the first revision's "before" and the saved text as its "after".

## Checking that a replayed request is refused

Every button on this page calls a Server Function that checks the cookie itself; the page having shown the button proves nothing. To check: open DevTools → Network, press Save on a memory, right-click the `POST` → Copy as cURL, remove the `Cookie` header, run it. The answer is `{"ok":false,"code":"unauthorized"}` and the dev log shows no database query.
