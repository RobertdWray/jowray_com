# Confirmation email evidence

Rendered from `npx tsx scripts/render-email-preview.ts` (sample content, `cid:` images inlined for the browser) and screenshotted in Chrome.

| File | What | Commit | Environment |
|---|---|---|---|
| `preview-1280px-cutA.jpg` | Desktop width, top of the email | `e8eeb60` | local, Chrome 2026-11-03 |
| `preview-390px-cutA.jpg` | 390 px (iframe), top of the email | `e8eeb60` | local, Chrome 2026-11-03 |

Not yet recorded: delivered-message inspection (Gmail web/iOS, Apple Mail, Outlook), which needs a real send with `scripts/send-test-email.ts` to the allowlisted address.
