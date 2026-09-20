-- High-frequency rich current telemetry is overwritten in place. Migration
-- 020 adds the separate compact permanent time-series table.

CREATE TABLE IF NOT EXISTS live_vitals_latest (
    id          TINYINT UNSIGNED PRIMARY KEY,
    updated_at  DATETIME(3) NOT NULL,
    payload     JSON NOT NULL,
    CONSTRAINT chk_live_vitals_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
