-- 014_postcard_archive.sql - public postcard archive admission marker.
--
-- A postcard becomes generally browseable only after the runner has screened it
-- and emitted postcard_in or fan_mail_in. The signed sender can still see their
-- own row before this marker is set. This is display state only: queue semantics
-- remain unchanged.

ALTER TABLE postcards
    ADD COLUMN IF NOT EXISTS public_at DATETIME(3) NULL AFTER reply_attempts;

UPDATE postcards p
JOIN (
    SELECT
        CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.id')) AS UNSIGNED) AS postcard_id,
        MIN(ts) AS public_at
    FROM events
    WHERE kind IN ('postcard_in', 'fan_mail_in')
    GROUP BY postcard_id
) admitted ON admitted.postcard_id = p.id
SET p.public_at = admitted.public_at
WHERE p.public_at IS NULL;

ALTER TABLE postcards
    ADD INDEX IF NOT EXISTS idx_postcard_archive (public_at, blocked, id);
