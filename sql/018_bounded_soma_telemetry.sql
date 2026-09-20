-- Latest-only private Soma diagnostics. High-frequency public vitals contain a
-- bounded live projection; complete recovery state remains on the runner and
-- meaningful structured history remains in its event-specific stores.

CREATE TABLE IF NOT EXISTS soma_diagnostic_latest (
    channel     VARCHAR(32) PRIMARY KEY,
    updated_at  DATETIME(3) NOT NULL,
    payload     JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
