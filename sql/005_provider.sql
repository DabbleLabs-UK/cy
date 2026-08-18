-- 005_provider.sql - migration for an already-deployed database.
--
-- Adds the switchable model-provider control to the single-row `tempo` table:
--   provider           - the active model the runner generates with
--                        ('ollama' local/free, or 'deepseek' paid + metered).
--   deepseek_available - reported by the runner (a capability event): whether it
--                        currently has a DeepSeek key, so the admin switch can
--                        refuse a DeepSeek selection with a clear reason when not.
--
-- Idempotent on MariaDB (IF NOT EXISTS), so it is safe to re-run. Apply once
-- against a live DB that predates the provider control:
--
--   mysql <db> < sql/005_provider.sql
--
-- The application degrades safely without it (lib/tempo.php treats the missing
-- columns as "ollama" / "not available"), so the site never 500s if this has not
-- been applied yet - it simply stays on ollama until it is.

ALTER TABLE tempo
    ADD COLUMN IF NOT EXISTS provider VARCHAR(16) NOT NULL DEFAULT 'ollama';

ALTER TABLE tempo
    ADD COLUMN IF NOT EXISTS deepseek_available TINYINT UNSIGNED NOT NULL DEFAULT 0;
