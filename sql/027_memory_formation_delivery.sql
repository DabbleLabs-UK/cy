-- Formation source claims and completion receipts. Existing attempts and source
-- payloads remain intact; historical attempt counts do not exhaust new retries.
ALTER TABLE autobiographical_memory_formation_queue
    ADD COLUMN IF NOT EXISTS claim_token CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN IF NOT EXISTS failure_streak SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_result_category VARCHAR(32) NULL;
ALTER TABLE autobiographical_memory_formation_attempts
    ADD COLUMN IF NOT EXISTS claim_token CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN IF NOT EXISTS result_payload JSON NULL,
    ADD UNIQUE INDEX IF NOT EXISTS uniq_memory_formation_claim (claim_token);
