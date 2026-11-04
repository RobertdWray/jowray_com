-- Restores the database guarantee that every memory a person has shared carries
-- a consent timestamp: only a DRAFT (saved by the admin, not yet shared) may have
-- consentedAt NULL. Separate from 20261104070000_draft_memories because the new
-- enum value cannot be referenced in the transaction that added it.
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_consent_when_not_draft" CHECK ("status" = 'DRAFT' OR "consentedAt" IS NOT NULL);
