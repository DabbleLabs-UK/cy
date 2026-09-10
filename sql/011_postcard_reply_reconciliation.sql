-- 011_postcard_reply_reconciliation.sql - close historical reply tray rows.
--
-- Migration 010 introduced replied_at after replies already existed in the
-- event log. Backfill those completed postcards so old delivered rows do not
-- make a newly-created bounded tray appear full.

UPDATE postcards p
JOIN (
    SELECT
        CAST(COALESCE(
            NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.reply_to')), ''),
            NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.id')), '')
        ) AS UNSIGNED) AS postcard_id,
        MIN(ts) AS replied_at
    FROM events
    WHERE kind = 'postcard_out'
    GROUP BY postcard_id
) replies ON replies.postcard_id = p.id
SET p.replied_at = replies.replied_at
WHERE p.replied_at IS NULL;
