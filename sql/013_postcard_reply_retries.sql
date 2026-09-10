-- 013_postcard_reply_retries.sql - retry transient empty postcard replies.
--
-- A single empty/error model call must not turn a normally admitted postcard
-- into final fan mail. Track completed attempts so ingest can retry twice before
-- retaining the postcard as fan_final. Existing fan_final rows stay terminal;
-- they predate this retry regime and must not all re-enter the live reply lane.

ALTER TABLE postcards
    ADD COLUMN IF NOT EXISTS reply_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER replied_at;

UPDATE postcards
SET reply_attempts = 3
WHERE mail_class = 'fan_final' AND replied_at IS NULL AND reply_attempts = 0;
