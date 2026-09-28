-- Retrieval-cue provenance for the autobiographical memory query ledger.
--
-- This is instrumentation only: it adds columns to record WHY a candidate
-- matched (which terms/tags, and which prompt-material pool those terms came
-- from), not new retrieval behaviour. The matching/ranking/selection logic in
-- lib/autobiographical_memory.php and runner/memory-runtime.js is unchanged;
-- these columns are populated from data that already exists at query time.
--
-- query_source_type records what built THIS query's text/tags (the caller's
-- own label, e.g. 'ENVIRONMENT_EVENT' or 'POSTCARD') -- current-world/
-- external material versus another explicit prompt source.
--
-- candidate_match_provenance is a JSON object keyed by candidate memory id,
-- recording the actual matched tags/terms plus independent boolean flags:
-- whether the match was lexical (tag/term overlap with the query text), a
-- structured sender-identity match (not lexical at all), and whether any of
-- the matched tags/terms also independently appear in Cy's own recent-
-- expression buffer at the time of the query. Recording raw attribution here
-- (rather than a single derived label) lets later analysis classify
-- external/self/mixed/neither without needing to reconstruct it from text.
--
-- repeated_from_previous_generation_ids names candidates that were also
-- explicitly inserted into the immediately preceding generation context
-- (the previous consumeWorking() call), the fact needed to detect a memory
-- being surfaced again right after it was last used.

ALTER TABLE autobiographical_memory_queries
    ADD COLUMN query_source_type VARCHAR(32) NULL AFTER current_context,
    ADD COLUMN candidate_match_provenance JSON NULL AFTER retrieval_mechanisms,
    ADD COLUMN repeated_from_previous_generation_ids JSON NULL AFTER inserted_memory_ids;
