-- Routine historical readings live separately from the public event stream.
-- The rich current presentation remains in live_vitals_latest; this table holds
-- only the small time-series projection used by charts.

CREATE TABLE IF NOT EXISTS vitals_history (
    observed_at    DATETIME(3) NOT NULL PRIMARY KEY,
    schema_version TINYINT UNSIGNED NOT NULL,
    payload        JSON NOT NULL,
    INDEX idx_vitals_history_schema_time (schema_version, observed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
