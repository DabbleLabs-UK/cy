-- 002_paused.sql - migration for an already-deployed database.
--
-- Adds the operator pause flag to the single-row `tempo` table. Idempotent on
-- MariaDB (IF NOT EXISTS), so it is safe to re-run. Apply once against a live DB
-- that predates the admin pause/resume control:
--
--   mysql <db> < sql/002_paused.sql
--
-- The application degrades safely without it (lib/tempo.php treats a missing
-- column as "not paused"), so the site never 500s if this has not been applied
-- yet - it simply cannot be paused until it is.

ALTER TABLE tempo ADD COLUMN IF NOT EXISTS paused TINYINT UNSIGNED NOT NULL DEFAULT 0;
