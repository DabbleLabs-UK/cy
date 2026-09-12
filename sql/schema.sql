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
    INDEX idx_kind_seq (kind, seq),
    INDEX idx_kind_ts (kind, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Private structured prison-world records. Unlike the public events table,
-- these keep objective facts, observation and Soma input as separate stages
-- for the admin-only event inspector.
CREATE TABLE environment_events (
    event_id     VARCHAR(96) PRIMARY KEY,
    occurred_at  DATETIME(3) NOT NULL,
    event_type   VARCHAR(64) NOT NULL,
    event_family VARCHAR(32) NOT NULL,
    record       JSON NOT NULL,
    created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_environment_occurred (occurred_at),
    INDEX idx_environment_type (event_type, occurred_at)
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
    mail_class    VARCHAR(16) NOT NULL DEFAULT 'reply', -- 'reply' | 'fan' | 'fan_final'
    delivered_at  DATETIME NULL,
    promoted_at   DATETIME NULL,
    replied_at    DATETIME NULL,
    reply_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    blocked       TINYINT DEFAULT 0,
    block_reason  VARCHAR(80) NULL,
    INDEX idx_delivered_deliver (delivered_at, deliver_at),
    INDEX idx_mail_reply (mail_class, replied_at, blocked, posted_at),
    INDEX idx_mail_archive (mail_class, delivered_at, blocked, posted_at),
    INDEX idx_visitor (visitor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Serialises reply-tray admission and records the fan-mail promotion rhythm.
-- Capacity overflow is accepted and archived, never rejected for load alone.
CREATE TABLE postcard_queue_state (
    id                           TINYINT UNSIGNED PRIMARY KEY,
    reply_capacity               SMALLINT UNSIGNED NOT NULL DEFAULT 8,
    promote_every                SMALLINT UNSIGNED NOT NULL DEFAULT 5,
    completed_since_promotion    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at                   DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO postcard_queue_state
    (id, reply_capacity, promote_every, completed_since_promotion, updated_at)
VALUES (1, 8, 5, 0, NOW());

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
-- `provider` is the active model provider ('ollama' local/free, or 'deepseek' paid)
-- the owner selects via /api/admin.php; the runner reads it off the same tempo poll
-- and switches mid-loop, no restart. `deepseek_available` is reported by the runner
-- (a capability event) - whether it currently has a DeepSeek key - so the admin
-- switch can refuse a DeepSeek selection with a clear reason when it has none.
CREATE TABLE tempo (
    id                 TINYINT UNSIGNED PRIMARY KEY,
    custom_speed       TINYINT UNSIGNED NULL,
    paused             TINYINT UNSIGNED NOT NULL DEFAULT 0,
    provider           VARCHAR(16) NOT NULL DEFAULT 'ollama',
    deepseek_available TINYINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at         DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO tempo (id, custom_speed, paused, provider, deepseek_available, updated_at)
VALUES (1, NULL, 0, 'ollama', 0, NOW());

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

-- Persistent subjective autobiography. See sql/015_autobiographical_memory.sql
-- for the migration, seed motif and explanatory comments.
CREATE TABLE autobiographical_memories (
    id CHAR(36) PRIMARY KEY,
    memory_type VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    privacy_scope VARCHAR(24) NOT NULL,
    epistemic_status VARCHAR(48) NOT NULL DEFAULT 'SUBJECTIVE_AUTOBIOGRAPHICAL_MEMORY',
    consistency_status VARCHAR(16) NOT NULL DEFAULT 'UNCERTAIN',
    subject_visitor_id CHAR(32) NULL,
    content TEXT NOT NULL,
    public_summary VARCHAR(600) NULL,
    classification VARCHAR(80) NULL,
    name_recallable TINYINT UNSIGNED NOT NULL DEFAULT 0,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    last_retrieved_at DATETIME(3) NULL,
    retrieval_count INT UNSIGNED NOT NULL DEFAULT 0,
    INDEX idx_memory_status_updated (status, updated_at),
    INDEX idx_memory_subject (subject_visitor_id, status, updated_at),
    INDEX idx_memory_type (memory_type, status, updated_at),
    FULLTEXT INDEX ftx_memory_text (content, public_summary)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE autobiographical_memory_sources (
    memory_id CHAR(36) NOT NULL,
    source_type VARCHAR(32) NOT NULL,
    source_id VARCHAR(128) NOT NULL,
    source_timestamp DATETIME(3) NULL,
    source_excerpt TEXT NULL,
    source_visibility VARCHAR(24) NOT NULL DEFAULT 'INTERNAL_ONLY',
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (memory_id, source_type, source_id),
    CONSTRAINT fk_memory_source_memory FOREIGN KEY (memory_id) REFERENCES autobiographical_memories(id) ON DELETE CASCADE,
    INDEX idx_memory_source_ref (source_type, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE autobiographical_memory_tags (
    memory_id CHAR(36) NOT NULL,
    tag VARCHAR(64) NOT NULL,
    PRIMARY KEY (memory_id, tag),
    CONSTRAINT fk_memory_tag_memory FOREIGN KEY (memory_id) REFERENCES autobiographical_memories(id) ON DELETE CASCADE,
    INDEX idx_memory_tag (tag, memory_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE autobiographical_memory_revisions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    memory_id CHAR(36) NOT NULL,
    version INT UNSIGNED NOT NULL,
    operation VARCHAR(16) NOT NULL,
    snapshot JSON NOT NULL,
    source_type VARCHAR(32) NULL,
    source_id VARCHAR(128) NULL,
    created_at DATETIME(3) NOT NULL,
    CONSTRAINT fk_memory_revision_memory FOREIGN KEY (memory_id) REFERENCES autobiographical_memories(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_memory_version (memory_id, version),
    INDEX idx_memory_revision_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE autobiographical_memory_activity (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    memory_id CHAR(36) NULL,
    activity_type VARCHAR(32) NOT NULL,
    public_text VARCHAR(600) NULL,
    reason_codes JSON NULL,
    privacy_scope VARCHAR(24) NOT NULL DEFAULT 'INTERNAL_ONLY',
    created_at DATETIME(3) NOT NULL,
    CONSTRAINT fk_memory_activity_memory FOREIGN KEY (memory_id) REFERENCES autobiographical_memories(id) ON DELETE SET NULL,
    INDEX idx_memory_activity_created (created_at),
    INDEX idx_memory_activity_public (privacy_scope, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE autobiographical_memory_queries (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    generation_ref VARCHAR(64) NULL,
    current_context JSON NOT NULL,
    sender_known TINYINT UNSIGNED NOT NULL DEFAULT 0,
    candidate_memory_ids JSON NOT NULL,
    retrieval_mechanisms JSON NOT NULL,
    privacy_filter JSON NOT NULL,
    offered_memory_ids JSON NOT NULL,
    selected_memory_ids JSON NOT NULL,
    inserted_memory_ids JSON NOT NULL,
    created_at DATETIME(3) NOT NULL,
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

-- Private shared-context and ambient-world observability. See migration 016.
CREATE TABLE context_broker_inspections (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    generation_ref VARCHAR(160) NULL,
    consumer VARCHAR(32) NOT NULL,
    generated_at DATETIME(3) NOT NULL,
    packet JSON NOT NULL,
    final_rendering MEDIUMTEXT NOT NULL,
    metrics JSON NOT NULL,
    created_at DATETIME(3) NOT NULL,
    INDEX idx_context_consumer_created (consumer, created_at),
    INDEX idx_context_generation (generation_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE ambient_world_runs (
    run_id VARCHAR(160) PRIMARY KEY,
    ran_at DATETIME(3) NOT NULL,
    candidate_type VARCHAR(24) NOT NULL,
    context_packet_summary JSON NOT NULL,
    candidate_output JSON NULL,
    validation_status VARCHAR(24) NOT NULL,
    rejection_reason VARCHAR(600) NULL,
    created_world_event_ids JSON NOT NULL,
    thread_changes JSON NOT NULL,
    model_latency_ms INT UNSIGNED NOT NULL DEFAULT 0,
    validation_latency_ms INT UNSIGNED NOT NULL DEFAULT 0,
    total_latency_ms INT UNSIGNED NOT NULL DEFAULT 0,
    provider VARCHAR(32) NULL,
    model VARCHAR(160) NULL,
    created_at DATETIME(3) NOT NULL,
    INDEX idx_awg_run_created (created_at),
    INDEX idx_awg_validation (validation_status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE world_threads (
    thread_id VARCHAR(160) PRIMARY KEY,
    thread_type VARCHAR(80) NOT NULL,
    state VARCHAR(16) NOT NULL,
    summary VARCHAR(800) NOT NULL,
    participants JSON NOT NULL,
    source_event_ids JSON NOT NULL,
    next_eligible_at DATETIME(3) NULL,
    resolution JSON NULL,
    visibility JSON NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    INDEX idx_world_thread_state (state, next_eligible_at, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE world_objects (
    object_id VARCHAR(160) PRIMARY KEY,
    object_type VARCHAR(80) NOT NULL,
    owner_id VARCHAR(80) NULL,
    holder_id VARCHAR(80) NULL,
    location VARCHAR(80) NOT NULL,
    status VARCHAR(24) NOT NULL,
    visibility JSON NOT NULL,
    source_event_id VARCHAR(160) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    INDEX idx_world_object_location (location, status),
    INDEX idx_world_object_holder (holder_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
