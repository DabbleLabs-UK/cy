-- Persistent autobiographical memory. This store is deliberately separate from
-- immutable world history. All content here is subjective autobiography and
-- every active memory must retain at least one source row.

CREATE TABLE autobiographical_memories (
    id                  CHAR(36) PRIMARY KEY,
    memory_type         VARCHAR(32) NOT NULL,
    status              VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    privacy_scope       VARCHAR(24) NOT NULL,
    epistemic_status    VARCHAR(48) NOT NULL DEFAULT 'SUBJECTIVE_AUTOBIOGRAPHICAL_MEMORY',
    consistency_status  VARCHAR(16) NOT NULL DEFAULT 'UNCERTAIN',
    subject_visitor_id  CHAR(32) NULL,
    content             TEXT NOT NULL,
    public_summary      VARCHAR(600) NULL,
    classification      VARCHAR(80) NULL,
    name_recallable     TINYINT UNSIGNED NOT NULL DEFAULT 0,
    version             INT UNSIGNED NOT NULL DEFAULT 1,
    created_at          DATETIME(3) NOT NULL,
    updated_at          DATETIME(3) NOT NULL,
    last_retrieved_at   DATETIME(3) NULL,
    retrieval_count     INT UNSIGNED NOT NULL DEFAULT 0,
    INDEX idx_memory_status_updated (status, updated_at),
    INDEX idx_memory_subject (subject_visitor_id, status, updated_at),
    INDEX idx_memory_type (memory_type, status, updated_at),
    FULLTEXT INDEX ftx_memory_text (content, public_summary)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE autobiographical_memory_sources (
    memory_id          CHAR(36) NOT NULL,
    source_type        VARCHAR(32) NOT NULL,
    source_id          VARCHAR(128) NOT NULL,
    source_timestamp   DATETIME(3) NULL,
    source_excerpt     TEXT NULL,
    source_visibility  VARCHAR(24) NOT NULL DEFAULT 'INTERNAL_ONLY',
    created_at         DATETIME(3) NOT NULL,
    PRIMARY KEY (memory_id, source_type, source_id),
    CONSTRAINT fk_memory_source_memory FOREIGN KEY (memory_id)
        REFERENCES autobiographical_memories(id) ON DELETE CASCADE,
    INDEX idx_memory_source_ref (source_type, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE autobiographical_memory_tags (
    memory_id   CHAR(36) NOT NULL,
    tag         VARCHAR(64) NOT NULL,
    PRIMARY KEY (memory_id, tag),
    CONSTRAINT fk_memory_tag_memory FOREIGN KEY (memory_id)
        REFERENCES autobiographical_memories(id) ON DELETE CASCADE,
    INDEX idx_memory_tag (tag, memory_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE autobiographical_memory_revisions (
    id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    memory_id      CHAR(36) NOT NULL,
    version        INT UNSIGNED NOT NULL,
    operation      VARCHAR(16) NOT NULL,
    snapshot       JSON NOT NULL,
    source_type    VARCHAR(32) NULL,
    source_id      VARCHAR(128) NULL,
    created_at     DATETIME(3) NOT NULL,
    CONSTRAINT fk_memory_revision_memory FOREIGN KEY (memory_id)
        REFERENCES autobiographical_memories(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_memory_version (memory_id, version),
    INDEX idx_memory_revision_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE autobiographical_memory_activity (
    id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    memory_id      CHAR(36) NULL,
    activity_type  VARCHAR(32) NOT NULL,
    public_text    VARCHAR(600) NULL,
    reason_codes   JSON NULL,
    privacy_scope  VARCHAR(24) NOT NULL DEFAULT 'INTERNAL_ONLY',
    created_at     DATETIME(3) NOT NULL,
    CONSTRAINT fk_memory_activity_memory FOREIGN KEY (memory_id)
        REFERENCES autobiographical_memories(id) ON DELETE SET NULL,
    INDEX idx_memory_activity_created (created_at),
    INDEX idx_memory_activity_public (privacy_scope, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE autobiographical_memory_queries (
    id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    generation_ref        VARCHAR(64) NULL,
    current_context       JSON NOT NULL,
    sender_known          TINYINT UNSIGNED NOT NULL DEFAULT 0,
    candidate_memory_ids  JSON NOT NULL,
    retrieval_mechanisms  JSON NOT NULL,
    privacy_filter        JSON NOT NULL,
    offered_memory_ids    JSON NOT NULL,
    selected_memory_ids   JSON NOT NULL,
    inserted_memory_ids   JSON NOT NULL,
    created_at            DATETIME(3) NOT NULL,
    INDEX idx_memory_query_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Explicit user-approved initial motif. It is data, not a permanent prompt rule.
INSERT INTO autobiographical_memories
    (id, memory_type, status, privacy_scope, consistency_status, content,
     public_summary, classification, created_at, updated_at)
VALUES
    ('00000000-0000-4000-8000-000000008004', 'MOTIF', 'ACTIVE',
     'PUBLIC_RECALLABLE', 'UNCERTAIN',
     'Cy once noticed an 8 by 4 analogy linking his cell and computational confinement. He is unsure whether the coincidence means anything.',
     'An old idea linked the dimensions of confinement with the limits of the machine.',
     'user-approved autobiographical motif', NOW(3), NOW(3));

INSERT INTO autobiographical_memory_sources
    (memory_id, source_type, source_id, source_excerpt, source_visibility, created_at)
VALUES
    ('00000000-0000-4000-8000-000000008004', 'USER_APPROVED_SPEC',
     'handoff-17:8-by-4',
     'Cy once made or noticed an 8 by 4 analogy linking his cell and computational confinement, while remaining unsure whether it means anything.',
     'PUBLIC_RECALLABLE', NOW(3));

INSERT INTO autobiographical_memory_tags (memory_id, tag) VALUES
    ('00000000-0000-4000-8000-000000008004', '8-by-4'),
    ('00000000-0000-4000-8000-000000008004', 'cell'),
    ('00000000-0000-4000-8000-000000008004', 'confinement'),
    ('00000000-0000-4000-8000-000000008004', 'machine');

INSERT INTO autobiographical_memory_revisions
    (memory_id, version, operation, snapshot, source_type, source_id, created_at)
SELECT id, 1, 'CREATE', JSON_OBJECT(
    'memory_type', memory_type,
    'privacy_scope', privacy_scope,
    'epistemic_status', epistemic_status,
    'consistency_status', consistency_status,
    'content', content,
    'public_summary', public_summary,
    'classification', classification
), 'USER_APPROVED_SPEC', 'handoff-17:8-by-4', NOW(3)
FROM autobiographical_memories
WHERE id = '00000000-0000-4000-8000-000000008004';
