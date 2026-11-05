# VoIP.ms Sub Account: 262980_jowray

Phone number: **234.956.9729** (DID 2349569729, RITTMAN), the memorial line people will call or text once SMS/voice is built.
Sub-account username: `262980_jowray`. The password is not in this repo; share it through a secure channel.

**Status (2026-11-05): deferred and not in use.** Phase 1 is web-only and no SMS/voice vendor has been chosen (see `docs/environment.md`, the `voipms_*` and `VOIPMS_*` rows). Until that decision, the sub-account should be disabled, or have IP restriction and POP restriction turned on in the VoIP.ms portal; that is Rob's, tracked in issue #43.

The full settings table that used to live here (codecs, NAT, timeouts, routing, voicemail) was removed before the repository went public, because it also recorded which protections were off. Git history keeps it; when SMS/voice returns, write the new configuration down in a fresh document, together with the vendor decision.
