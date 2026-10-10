-- Current-content origin kind for autobiographical memories.
--
-- The generic UPDATE consolidation guard must only let a generic source
-- (ENVIRONMENT_EVENT / DREAM_EXPRESSION / CY_EXPRESSION) consolidate a memory
-- whose CURRENT canonical content is of the same origin kind. Previously it
-- checked the memory's full historical source-kind set, but a memory that was
-- contaminated once retains that kind in its provenance forever - so a dream
-- that historically clobbered a now-restored waking memory could still pass the
-- gate. This column records the origin kind of the CURRENT content as a
-- first-class property, maintained at write time, so historical provenance can
-- stay fully intact without ever weakening protection of the current content.
--
-- Historical source/revision rows are NOT altered or removed by this migration.
ALTER TABLE autobiographical_memories
  ADD COLUMN IF NOT EXISTS origin_kind VARCHAR(32) NULL AFTER epistemic_status;

-- Backfill from retained history, deriving the kind of EVIDENCE the current
-- content represents (never OWNER_CORRECTION, which is a provenance marker, not
-- evidence). Preference order:
--   1. earliest revision whose snapshot content equals the current content and
--      is a genuine evidence kind - this maps a correction that restored older
--      content (e.g. e4a153ca, the 8-by-4 motif) back to that content's
--      original evidence revision, NOT to the correction or to a dream that
--      only ever contaminated it in between;
--   2. else the earliest evidence revision at all (covers content that evolved
--      via same-kind consolidation, where every evidence revision shares one
--      kind);
--   3. else the earliest non-correction source row.
-- Only NULL rows are touched, so the migration is safe to re-run.
UPDATE autobiographical_memories m
SET origin_kind = COALESCE(
    (SELECT r.source_type
       FROM autobiographical_memory_revisions r
      WHERE r.memory_id = m.id
        AND r.source_type IS NOT NULL
        AND r.source_type <> 'OWNER_CORRECTION'
        AND JSON_UNQUOTE(JSON_EXTRACT(r.snapshot, '$.content')) = m.content
      ORDER BY r.version ASC
      LIMIT 1),
    (SELECT r2.source_type
       FROM autobiographical_memory_revisions r2
      WHERE r2.memory_id = m.id
        AND r2.source_type IS NOT NULL
        AND r2.source_type <> 'OWNER_CORRECTION'
      ORDER BY r2.version ASC
      LIMIT 1),
    (SELECT s.source_type
       FROM autobiographical_memory_sources s
      WHERE s.memory_id = m.id
        AND s.source_type <> 'OWNER_CORRECTION'
      ORDER BY s.created_at ASC
      LIMIT 1)
  )
WHERE origin_kind IS NULL;
