-- Private, structured prison-world records used by the admin event inspector.
-- These rows do not enter the public event stream. The JSON keeps objective
-- world facts, Cy's observation, and the normalized Soma input distinct.
CREATE TABLE IF NOT EXISTS environment_events (
    event_id     VARCHAR(96) PRIMARY KEY,
    occurred_at  DATETIME(3) NOT NULL,
    event_type   VARCHAR(64) NOT NULL,
    event_family VARCHAR(32) NOT NULL,
    record       JSON NOT NULL,
    created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_environment_occurred (occurred_at),
    INDEX idx_environment_type (event_type, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
