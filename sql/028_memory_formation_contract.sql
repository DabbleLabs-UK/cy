-- Count rejected model decisions separately from operational retry backoff.
-- Historical failure_streak mixed invalid decisions with timeouts/errors, so
-- start only the new decision budget at zero; do not infer past invalid counts.
-- Existing statuses, sources, attempts and completion receipts remain untouched.
ALTER TABLE autobiographical_memory_formation_queue
    ADD COLUMN IF NOT EXISTS model_invalid_streak SMALLINT UNSIGNED NOT NULL DEFAULT 0;
