-- Durable asynchronous orchestration for autobiographical memory.
-- Memory content remains in the migration 015 tables. These tables record work,
-- prepared recall sets and operational evidence only.

CREATE TABLE autobiographical_memory_formation_queue (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    source_type         VARCHAR(32) NOT NULL,
    source_id           VARCHAR(128) NOT NULL,
    source_payload      JSON NOT NULL,
    subject_visitor_id  CHAR(32) NULL,
    privacy_scope       VARCHAR(24) NOT NULL DEFAULT 'INTERNAL_ONLY',
    priority            SMALLINT UNSIGNED NOT NULL DEFAULT 50,
    status              VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    attempts            SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    available_at        DATETIME(3) NOT NULL,
    queued_at           DATETIME(3) NOT NULL,
    started_at          DATETIME(3) NULL,
    completed_at        DATETIME(3) NULL,
    last_error          VARCHAR(1000) NULL,
    updated_at          DATETIME(3) NOT NULL,
    UNIQUE KEY uniq_memory_formation_source (source_type, source_id),
    INDEX idx_memory_formation_work (status, available_at, priority, queued_at),
    INDEX idx_memory_formation_subject (subject_visitor_id, queued_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE autobiographical_memory_formation_attempts (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    queue_id            BIGINT UNSIGNED NOT NULL,
    source_type         VARCHAR(32) NOT NULL,
    source_id           VARCHAR(128) NOT NULL,
    started_at          DATETIME(3) NOT NULL,
    completed_at        DATETIME(3) NOT NULL,
    provider            VARCHAR(32) NULL,
    model               VARCHAR(160) NULL,
    prompt_chars        INT UNSIGNED NOT NULL DEFAULT 0,
    latency_ms          INT UNSIGNED NOT NULL DEFAULT 0,
    result_category     VARCHAR(32) NOT NULL,
    resulting_memory_id CHAR(36) NULL,
    queue_depth_before  INT UNSIGNED NOT NULL DEFAULT 0,
    queue_depth_after   INT UNSIGNED NOT NULL DEFAULT 0,
    error_text          VARCHAR(1000) NULL,
    created_at          DATETIME(3) NOT NULL,
    CONSTRAINT fk_memory_formation_attempt_queue FOREIGN KEY (queue_id)
        REFERENCES autobiographical_memory_formation_queue(id) ON DELETE CASCADE,
    INDEX idx_memory_formation_attempt_created (created_at),
    INDEX idx_memory_formation_attempt_result (result_category, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE autobiographical_memory_surfacing_queue (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    context_fingerprint CHAR(64) NOT NULL,
    context_payload     JSON NOT NULL,
    subject_visitor_id  CHAR(32) NULL,
    sender_scope_key    CHAR(32) NOT NULL DEFAULT '',
    priority            SMALLINT UNSIGNED NOT NULL DEFAULT 80,
    status              VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    attempts            SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    available_at        DATETIME(3) NOT NULL,
    queued_at           DATETIME(3) NOT NULL,
    started_at          DATETIME(3) NULL,
    completed_at        DATETIME(3) NULL,
    last_error          VARCHAR(1000) NULL,
    updated_at          DATETIME(3) NOT NULL,
    UNIQUE KEY uniq_memory_surface_context (context_fingerprint, sender_scope_key),
    INDEX idx_memory_surface_work (status, available_at, priority, queued_at),
    INDEX idx_memory_surface_subject (subject_visitor_id, queued_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE autobiographical_memory_prepared_sets (
    id                  CHAR(36) PRIMARY KEY,
    context_fingerprint CHAR(64) NOT NULL,
    subject_visitor_id  CHAR(32) NULL,
    sender_scope_key    CHAR(32) NOT NULL DEFAULT '',
    candidate_ids       JSON NOT NULL,
    selected_ids        JSON NOT NULL,
    selected_memories   JSON NOT NULL,
    privacy_scope       VARCHAR(24) NOT NULL,
    provider            VARCHAR(32) NULL,
    model               VARCHAR(160) NULL,
    prepared_at         DATETIME(3) NOT NULL,
    expires_at          DATETIME(3) NOT NULL,
    consumed_at         DATETIME(3) NULL,
    consumed_by         VARCHAR(96) NULL,
    INDEX idx_memory_prepared_lookup (context_fingerprint, sender_scope_key, expires_at),
    INDEX idx_memory_prepared_created (prepared_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE autobiographical_memory_surfacing_attempts (
    id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    queue_id              BIGINT UNSIGNED NULL,
    prepared_set_id       CHAR(36) NULL,
    context_fingerprint   CHAR(64) NOT NULL,
    subject_visitor_id    CHAR(32) NULL,
    generation_ref        VARCHAR(96) NULL,
    started_at            DATETIME(3) NOT NULL,
    completed_at          DATETIME(3) NOT NULL,
    provider              VARCHAR(32) NULL,
    model                 VARCHAR(160) NULL,
    prompt_chars          INT UNSIGNED NOT NULL DEFAULT 0,
    latency_ms            INT UNSIGNED NOT NULL DEFAULT 0,
    candidate_count       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    candidate_ids         JSON NOT NULL,
    privacy_removed_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    selected_ids          JSON NOT NULL,
    result_category       VARCHAR(32) NOT NULL,
    consumed_by           VARCHAR(96) NULL,
    consumed_at           DATETIME(3) NULL,
    error_text            VARCHAR(1000) NULL,
    created_at            DATETIME(3) NOT NULL,
    CONSTRAINT fk_memory_surface_attempt_queue FOREIGN KEY (queue_id)
        REFERENCES autobiographical_memory_surfacing_queue(id) ON DELETE SET NULL,
    CONSTRAINT fk_memory_surface_attempt_set FOREIGN KEY (prepared_set_id)
        REFERENCES autobiographical_memory_prepared_sets(id) ON DELETE SET NULL,
    INDEX idx_memory_surface_attempt_created (created_at),
    INDEX idx_memory_surface_attempt_result (result_category, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
