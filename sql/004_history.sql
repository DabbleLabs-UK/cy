-- 004_history.sql - migration for the HISTORY MODE day index (stage 1 of 3).
--
-- Adds a read-only rollup of the `events` log so the "spine" navigation never has
-- to scan the raw event history. Nothing here touches, writes to, or deletes from
-- `events` - the index is built FROM it by lib/history.php and is fully rebuildable
-- from scratch at any time (see scripts/history_backfill.php).
--
-- Idempotent (CREATE TABLE IF NOT EXISTS + a guarded seed row), so it is safe to
-- re-run. Apply once against the live DB:
--
--   mysql <db> < sql/004_history.sql
--
-- The public site degrades safely without it: the live stream is unaffected and
-- the history endpoints simply report an empty/unbuilt index (they never 500 on a
-- missing table - see public/api/history.php).

-- Per-calendar-day rollup. One row per wall-clock day the events span. `acc` holds
-- the running accumulators (vitals-sample count, per-axis sums and peaks) that make
-- the rollup incrementally mergeable; the derived presentation values live in the
-- flat columns and `axes` so the API can read them without touching `acc`.
CREATE TABLE IF NOT EXISTS history_days (
    day             DATE NOT NULL PRIMARY KEY,
    seq_min         BIGINT UNSIGNED NULL,
    seq_max         BIGINT UNSIGNED NULL,
    ts_min          DATETIME(3) NULL,
    ts_max          DATETIME(3) NULL,
    char_count      BIGINT UNSIGNED NOT NULL DEFAULT 0,   -- volume of text he produced
    burst_count     INT UNSIGNED NOT NULL DEFAULT 0,      -- completed generations (`gen` events)
    silence_seconds BIGINT UNSIGNED NOT NULL DEFAULT 0,   -- total deliberate silence
    n_vitals        INT UNSIGNED NOT NULL DEFAULT 0,      -- vitals samples folded into `acc`
    postcards_in    INT UNSIGNED NOT NULL DEFAULT 0,
    postcards_out   INT UNSIGNED NOT NULL DEFAULT 0,
    drawings        INT UNSIGNED NOT NULL DEFAULT 0,
    warden_notices  INT UNSIGNED NOT NULL DEFAULT 0,
    aborts          INT UNSIGNED NOT NULL DEFAULT 0,
    mode_changes    INT UNSIGNED NOT NULL DEFAULT 0,
    day_rollovers   INT UNSIGNED NOT NULL DEFAULT 0,
    dominant_mood   VARCHAR(20) NULL,                     -- the emotional axis that ran highest
    mood_score      FLOAT NULL,                           -- its mean over the day (0..1)
    acc             JSON NOT NULL,                        -- {nv, sum:{axis:t}, peak:{axis:m}} - merge state
    axes            JSON NULL                             -- {axis:{mean,peak}} - presentation
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-hour rollup within a day (0..23). Same shape as history_days minus the daily
-- role; this is what tints the per-hour profile bands on the spine.
CREATE TABLE IF NOT EXISTS history_hours (
    day             DATE NOT NULL,
    hour            TINYINT UNSIGNED NOT NULL,            -- 0..23, wall-clock hour of the event ts
    seq_min         BIGINT UNSIGNED NULL,
    seq_max         BIGINT UNSIGNED NULL,
    ts_min          DATETIME(3) NULL,
    ts_max          DATETIME(3) NULL,
    char_count      BIGINT UNSIGNED NOT NULL DEFAULT 0,
    burst_count     INT UNSIGNED NOT NULL DEFAULT 0,
    silence_seconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
    n_vitals        INT UNSIGNED NOT NULL DEFAULT 0,
    postcards_in    INT UNSIGNED NOT NULL DEFAULT 0,
    postcards_out   INT UNSIGNED NOT NULL DEFAULT 0,
    drawings        INT UNSIGNED NOT NULL DEFAULT 0,
    warden_notices  INT UNSIGNED NOT NULL DEFAULT 0,
    aborts          INT UNSIGNED NOT NULL DEFAULT 0,
    mode_changes    INT UNSIGNED NOT NULL DEFAULT 0,
    day_rollovers   INT UNSIGNED NOT NULL DEFAULT 0,
    dominant_mood   VARCHAR(20) NULL,
    mood_score      FLOAT NULL,
    acc             JSON NOT NULL,
    axes            JSON NULL,
    PRIMARY KEY (day, hour),
    INDEX idx_day (day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Single-row watermark: the highest events.seq already folded into the index. The
-- rollup only ever processes seq > built_through_seq, so it is cheap to run often
-- and a no-op when nothing new has arrived. Backfill resets this to 0.
CREATE TABLE IF NOT EXISTS history_cursor (
    id                TINYINT UNSIGNED PRIMARY KEY,       -- always 1
    built_through_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at        DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO history_cursor (id, built_through_seq, updated_at) VALUES (1, 0, NOW());
