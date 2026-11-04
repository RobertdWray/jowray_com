// Sentry tunnel in handler mode (plan 2026-11-04 §7.1): the browser SDK posts
// envelopes here and only the envelope body is forwarded, for this project's
// DSN alone. Rewrite mode (the previous `/monitoring` proxy) sends the request
// with `credentials: "omit"` on SDK 11.9+, which Vercel Deployment Protection
// rejects, so browser events from protected previews were dropped.
// `tunnelRoute` in next.config.ts names this path; the build prints
// "[@sentry/nextjs] The tunnel route sends events through app/sentry-tunnel/route.ts."
export { POST } from "@sentry/nextjs/tunnel";
