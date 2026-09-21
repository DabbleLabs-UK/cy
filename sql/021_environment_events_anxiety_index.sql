-- The operational-Anxiety history transition query filters environment_events
-- on a single nested JSON field, but each `record` document averages ~650KB
-- (the table is ~1GB across only ~2,500 rows), so evaluating that filter
-- inline forces MariaDB to read and parse the full JSON body of every row in
-- the requested time range just to keep the small status string. A 7-day
-- window (~1,600 matching rows) measured at ~20-27s of I/O for this reason
-- alone - independent of, and in addition to, the current-defensive-context
-- boundary-query timeout fixed alongside this migration.
--
-- Adding a generated column plus a covering secondary index lets MariaDB
-- resolve occurred_at range + non-null filtering entirely from the (small)
-- index, without ever touching the `record` column's storage.
--
-- The column MUST be STORED, not VIRTUAL. VIRTUAL was tried first (a
-- metadata-only add, no rewrite needed) and measured working correctly in
-- isolation - but on this MariaDB version (11.8.9), reading a VIRTUAL
-- generated column back via an index-only (covering) scan reproducibly
-- returned NULL for every row, even though the same rows resolved correctly
-- via direct JSON_EXTRACT or a non-covering read. STORED physically persists
-- the computed value as part of the row, which is what a covering index scan
-- actually needs to return correctly. This is the one case where the smaller,
-- cheaper-to-add option (VIRTUAL) was NOT safe to ship, discovered by
-- comparing this migration's query output against the pre-migration inline
-- JSON_EXTRACT query row-for-row before deploying it as the sole code path.
--
-- Table is ~1GB / ~2,500 rows (NOT the ~80GB `events` table Infra owns).
-- Adding a STORED generated column requires MariaDB to rewrite the table
-- (ALGORITHM=COPY - MariaDB rejects ALGORITHM=INPLACE for this specific
-- operation), measured at ~47s for this table's actual size - a one-time
-- cost. The index add afterward is then instant (the value is already
-- materialized). ALGORITHM=INPLACE, LOCK=NONE is safe for the index step;
-- the column step needs the default algorithm/lock (briefly serializes
-- writes to this table for the ~47s rewrite - acceptable given its low,
-- bursty write rate of occasional structured story events, not continuous
-- high-frequency telemetry).

ALTER TABLE environment_events
    ADD COLUMN operational_anxiety_status VARCHAR(32)
        GENERATED ALWAYS AS (
            JSON_UNQUOTE(JSON_EXTRACT(record, '$.current_defensive_context.operationalAnxiety.status'))
        ) STORED;

ALTER TABLE environment_events
    ADD INDEX idx_environment_anxiety (occurred_at, operational_anxiety_status),
    ALGORITHM=INPLACE, LOCK=NONE;
