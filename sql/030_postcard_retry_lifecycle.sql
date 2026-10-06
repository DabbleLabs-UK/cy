-- New counters describe post-migration processing only. Legacy reply_attempts,
-- especially migration-013 terminal backfills, are not quality-failure evidence.
-- No historical postcard status or existing counter is rewritten.
ALTER TABLE postcards
  ADD COLUMN IF NOT EXISTS claim_generation BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS temporary_failures INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quality_failures INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_hold VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS arrival_event_id BIGINT UNSIGNED NULL;
ALTER TABLE postcard_inference_turns
  ADD COLUMN IF NOT EXISTS claim_generation BIGINT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE postcard_inference_attempts
  ADD COLUMN IF NOT EXISTS claim_generation BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS safe_retry TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE postcard_inference_attempts
  DROP INDEX IF EXISTS postcard_attempt,
  ADD UNIQUE INDEX IF NOT EXISTS postcard_claim_attempt (postcard_id, claim_generation, provider, attempt);
