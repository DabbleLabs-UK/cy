-- CAPTIVE schema (MariaDB 11.8)
-- Note: MariaDB does not support CAST(x AS JSON) -- payload is always bound
-- as a JSON-encoded string param from PHP, never cast in SQL.

CREATE TABLE events (
    seq     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ts      DATETIME(3) NOT NULL,
    kind    VARCHAR(24) NOT NULL,
    payload JSON NOT NULL,
    INDEX idx_kind_seq (kind, seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE letters (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    from_name     VARCHAR(40),
    body          TEXT,
    ip            VARBINARY(16),
    posted_at     DATETIME,
    deliver_at    DATETIME,
    delivered_at  DATETIME NULL,
    blocked       TINYINT DEFAULT 0,
    block_reason  VARCHAR(80) NULL,
    INDEX idx_delivered_deliver (delivered_at, deliver_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE images (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    path          VARCHAR(255),
    caption       TEXT NULL,
    w             INT,
    h             INT,
    posted_at     DATETIME,
    deliver_at    DATETIME,
    delivered_at  DATETIME NULL,
    significance  FLOAT DEFAULT 0,
    ref_count     INT DEFAULT 0,
    blocked       TINYINT DEFAULT 0,
    INDEX idx_delivered_deliver (delivered_at, deliver_at)
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

-- Not in the original spec: images has no ip column, so image-upload rate
-- limiting (same 3-per-10-minutes rule as letters) needs somewhere to live.
-- This small generic table covers that without adding an undocumented
-- column to images. Letters still rate-limit off letters.ip/posted_at
-- directly, as specified.
CREATE TABLE rate_limits (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    ip          VARBINARY(16) NOT NULL,
    action      VARCHAR(20) NOT NULL,
    created_at  DATETIME NOT NULL,
    INDEX idx_ip_action_created (ip, action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
