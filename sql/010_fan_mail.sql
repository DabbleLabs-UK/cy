-- 010_fan_mail.sql - overload-safe postcard intake.
--
-- The reply tray is bounded. Overflow is accepted as durable fan mail, archived
-- in the public event stream by the runner, and may later be promoted into the
-- reply tray. replied_at keeps server queue depth honest after an item has been
-- claimed by Dell but before Cy has completed the reply. fan_final is retained
-- but not promotion-eligible after a model attempt produced no usable reply.

ALTER TABLE postcards
    ADD COLUMN IF NOT EXISTS mail_class VARCHAR(16) NOT NULL DEFAULT 'reply' AFTER deliver_at,
    ADD COLUMN IF NOT EXISTS promoted_at DATETIME NULL AFTER delivered_at,
    ADD COLUMN IF NOT EXISTS replied_at DATETIME NULL AFTER promoted_at;

ALTER TABLE postcards
    ADD INDEX IF NOT EXISTS idx_mail_reply (mail_class, replied_at, blocked, posted_at),
    ADD INDEX IF NOT EXISTS idx_mail_archive (mail_class, delivered_at, blocked, posted_at);

CREATE TABLE IF NOT EXISTS postcard_queue_state (
    id                           TINYINT UNSIGNED PRIMARY KEY,
    reply_capacity               SMALLINT UNSIGNED NOT NULL DEFAULT 8,
    promote_every                SMALLINT UNSIGNED NOT NULL DEFAULT 5,
    completed_since_promotion    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at                   DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO postcard_queue_state
    (id, reply_capacity, promote_every, completed_since_promotion, updated_at)
VALUES
    (1, 8, 5, 0, NOW());
