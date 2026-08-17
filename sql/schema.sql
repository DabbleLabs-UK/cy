-- CY schema (MariaDB 11.8)
-- Note: MariaDB does not support CAST(x AS JSON) -- payload is always bound
-- as a JSON-encoded string param from PHP, never cast in SQL.
--
-- MIGRATION NOTE (2026-08-17): the original `letters` and `images` tables were
-- merged into a single `postcards` table (a letter and an image were never two
-- separate features). The `visitors` table is new: people who write to Cy are
-- remembered by a signed cookie and woven back into his experience. Nothing is
-- deployed yet, so this file is simply the new source of truth -- there is no
-- ALTER path to run; a fresh import gives the current shape.

CREATE TABLE events (
    seq     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ts      DATETIME(3) NOT NULL,
    kind    VARCHAR(24) NOT NULL,
    payload JSON NOT NULL,
    INDEX idx_kind_seq (kind, seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- People who write to Cy. Keyed by a random visitor_id carried in a signed,
-- httpOnly cookie issued on the first postcard. We store NOTHING identifying
-- beyond a chosen handle and a compact rolling summary of what they have said;
-- IPs live only on postcards/rate_limits for rate limiting, never here.
--
-- warmth/suspicion/grudge are the SAME relations triple the inmate cast uses
-- (runner/cast.js): a visitor is just another entity Cy holds a standing toward.
CREATE TABLE visitors (
    visitor_id      CHAR(32) PRIMARY KEY,
    handle          VARCHAR(40) NULL,
    first_seen      DATETIME NOT NULL,
    last_seen       DATETIME NOT NULL,
    visit_count     INT NOT NULL DEFAULT 1,
    postcard_count  INT NOT NULL DEFAULT 0,
    warmth          FLOAT NOT NULL DEFAULT 0.30,
    suspicion       FLOAT NOT NULL DEFAULT 0.35,
    grudge          FLOAT NOT NULL DEFAULT 0.05,
    notes           TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- A postcard: text on one side, image on the other. At least one of body or
-- image_path is present (enforced in post-postcard.php, not by the schema).
CREATE TABLE postcards (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    visitor_id    CHAR(32) NULL,
    from_name     VARCHAR(40),
    body          TEXT NULL,
    image_path    VARCHAR(255) NULL,
    image_source  VARCHAR(20) NULL,   -- 'upload' | 'openverse'
    image_attrib  VARCHAR(300) NULL,  -- attribution string for openverse images
    caption       TEXT NULL,
    ip            VARBINARY(16),
    posted_at     DATETIME,
    deliver_at    DATETIME,
    delivered_at  DATETIME NULL,
    blocked       TINYINT DEFAULT 0,
    block_reason  VARCHAR(80) NULL,
    INDEX idx_delivered_deliver (delivered_at, deliver_at),
    INDEX idx_visitor (visitor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE news (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    source        VARCHAR(40),
    headline      VARCHAR(300),
    summary       TEXT NULL,
    url           VARCHAR(500),
    published_at  DATETIME,
    deliver_at    DATETIME,
    delivered_at  DATETIME NULL,
    UNIQUE KEY uniq_url (url(190)),
    INDEX idx_delivered_deliver (delivered_at, deliver_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Generic per-IP action log for rate limiting the public write endpoint.
-- Postcards rate-limit off this table (action='postcard'), keeping the
-- rate-limit window independent of the postcards row lifecycle.
CREATE TABLE rate_limits (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    ip          VARBINARY(16) NOT NULL,
    action      VARCHAR(20) NOT NULL,
    created_at  DATETIME NOT NULL,
    INDEX idx_ip_action_created (ip, action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
