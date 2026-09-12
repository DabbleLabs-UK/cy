-- Private observability and persistent mirrors for the shared context broker and
-- Ambient World Generator. These tables do not feed the public event stream.

CREATE TABLE context_broker_inspections (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    generation_ref      VARCHAR(160) NULL,
    consumer            VARCHAR(32) NOT NULL,
    generated_at        DATETIME(3) NOT NULL,
    packet              JSON NOT NULL,
    final_rendering     MEDIUMTEXT NOT NULL,
    metrics             JSON NOT NULL,
    created_at          DATETIME(3) NOT NULL,
    INDEX idx_context_consumer_created (consumer, created_at),
    INDEX idx_context_generation (generation_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE ambient_world_runs (
    run_id                  VARCHAR(160) PRIMARY KEY,
    ran_at                  DATETIME(3) NOT NULL,
    candidate_type          VARCHAR(24) NOT NULL,
    context_packet_summary  JSON NOT NULL,
    candidate_output        JSON NULL,
    validation_status       VARCHAR(24) NOT NULL,
    rejection_reason        VARCHAR(600) NULL,
    created_world_event_ids JSON NOT NULL,
    thread_changes          JSON NOT NULL,
    model_latency_ms        INT UNSIGNED NOT NULL DEFAULT 0,
    validation_latency_ms   INT UNSIGNED NOT NULL DEFAULT 0,
    total_latency_ms        INT UNSIGNED NOT NULL DEFAULT 0,
    provider                VARCHAR(32) NULL,
    model                   VARCHAR(160) NULL,
    created_at              DATETIME(3) NOT NULL,
    INDEX idx_awg_run_created (created_at),
    INDEX idx_awg_validation (validation_status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE world_threads (
    thread_id           VARCHAR(160) PRIMARY KEY,
    thread_type         VARCHAR(80) NOT NULL,
    state               VARCHAR(16) NOT NULL,
    summary             VARCHAR(800) NOT NULL,
    participants        JSON NOT NULL,
    source_event_ids    JSON NOT NULL,
    next_eligible_at    DATETIME(3) NULL,
    resolution          JSON NULL,
    visibility          JSON NOT NULL,
    created_at          DATETIME(3) NOT NULL,
    updated_at          DATETIME(3) NOT NULL,
    INDEX idx_world_thread_state (state, next_eligible_at, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE world_objects (
    object_id        VARCHAR(160) PRIMARY KEY,
    object_type      VARCHAR(80) NOT NULL,
    owner_id         VARCHAR(80) NULL,
    holder_id        VARCHAR(80) NULL,
    location         VARCHAR(80) NOT NULL,
    status           VARCHAR(24) NOT NULL,
    visibility       JSON NOT NULL,
    source_event_id  VARCHAR(160) NOT NULL,
    created_at       DATETIME(3) NOT NULL,
    updated_at       DATETIME(3) NOT NULL,
    INDEX idx_world_object_location (location, status),
    INDEX idx_world_object_holder (holder_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
