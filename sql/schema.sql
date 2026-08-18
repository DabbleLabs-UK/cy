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

-- Generic keyed action log for rate limiting. The `ip` column holds whatever
-- 16-byte key an action rate-limits on: the client IP for public writes
-- (action='postcard'), or a 16-byte md5 of the viewer token for tempo changes
-- (action='tempo'). Keeping the window here decouples it from the row lifecycle
-- of whatever it is guarding.
CREATE TABLE rate_limits (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    ip          VARBINARY(16) NOT NULL,
    action      VARCHAR(20) NOT NULL,
    created_at  DATETIME NOT NULL,
    INDEX idx_ip_action_created (ip, action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Live-viewer presence for the tempo (duty-cycle) control. A viewer is anyone
-- polling stream.php; each is keyed by a short-lived token (the signed visitor
-- cookie if they have one, else a random per-session id). last_seen is bumped at
-- most once every 5s per viewer (throttled in lib/presence.php), and a viewer
-- counts as present if seen within the last 15s. Nothing identifying is stored -
-- just an opaque token and a timestamp; stale rows are swept on write.
CREATE TABLE viewers (
    token       VARCHAR(64) PRIMARY KEY,
    last_seen   DATETIME NOT NULL,
    INDEX idx_last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Single-row store for the viewer-set tempo. custom_speed is the value a watching
-- viewer chose via POST /api/tempo.php (1..100), or NULL when there is no custom
-- value in force. It is DISCARDED (set back to NULL) the moment the last viewer
-- leaves, so a returning viewer starts from the 30% "someone watching" default,
-- never a stale custom value. The effective tempo is derived (see lib/tempo.php):
-- nobody watching -> 5%, someone watching + no custom -> 30%, custom -> that value.
-- `paused` is the owner's operator pause: an admin (?111) POST to /api/admin.php
-- sets it, and the runner picks it up on its existing tempo poll. While paused the
-- runner makes NO generation calls to ollama at all (the point being to watch the
-- machine's CPU/memory/draw fall with the model idle); every other timer keeps
-- running. It is deliberately NOT part of the derived duty-cycle rule above.
CREATE TABLE tempo (
    id            TINYINT UNSIGNED PRIMARY KEY,
    custom_speed  TINYINT UNSIGNED NULL,
    paused        TINYINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at    DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO tempo (id, custom_speed, paused, updated_at) VALUES (1, NULL, 0, NOW());

-- Single-row record of DELL's public IP as seen by the authenticated ingest
-- POSTs (/api/ingest.php sets it via X-Cy-Key, so it is trustworthy). It exists
-- for the automatic admin unlock (lib/admin.php): a browser whose resolved public
-- IP matches this - i.e. is behind the same NAT as DELL - is treated as the owner
-- (admin), unlocking the pause control and RAW view without typing ?111. Traffic
-- arrives via Cloudflare, so the real client IP comes from CF-Connecting-IP, but
-- only when REMOTE_ADDR is a verified Cloudflare edge (else it is forgeable). The
-- write is throttled to once a minute; a value older than 15 minutes is treated
-- as stale and grants nothing. HONEST CAVEAT: anyone else behind DELL's home NAT
-- is also admin - accepted and intended here (see lib/admin.php).
CREATE TABLE ingest_origin (
    id       TINYINT UNSIGNED PRIMARY KEY,
    ip       VARCHAR(45) NOT NULL,
    seen_at  DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Completed drawings. Cy draws through the same pen engine as his handwriting
-- (a coarse 0-100 stroke DSL parsed in runner/draw.js); the `draw` events carry
-- each build-up pass into the public stream, and this table is the durable
-- record of the finished thing. `id` is the client-side drawing id that ties the
-- passes together. strokes/mood are JSON but always bound as STRING params from
-- PHP (MariaDB has no CAST AS JSON). `requested_by` is the visitor who asked for
-- it, when he honoured a request, else NULL.
CREATE TABLE drawings (
    id            VARCHAR(40) PRIMARY KEY,
    ts            DATETIME(3) NOT NULL,
    title         VARCHAR(200) NULL,
    subject       VARCHAR(120) NULL,
    strokes       JSON NOT NULL,
    mood          JSON NULL,
    stroke_count  INT NOT NULL DEFAULT 0,
    requested_by  CHAR(32) NULL,
    INDEX idx_ts (ts),
    INDEX idx_requested_by (requested_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
