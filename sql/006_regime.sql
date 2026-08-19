-- 006_regime.sql - migration for an already-deployed database.
--
-- Adds the owner regime override to the single-row `tempo` table:
--   regime_override - forces Cy's day/night + sleep state for testing, overriding
--                     the clock-based lights-out window (22:30-06:30):
--                       'auto'  - the default: follow the clock (no override)
--                       'day'   - force awake (leave dream mode, normal cadence)
--                       'night' - force asleep (dream mode) regardless of the hour
--
-- Owner-set via POST /api/admin.php and read by the runner through its existing
-- tempo poll, so a forced wake/sleep takes effect mid-loop with no restart.
--
-- Idempotent on MariaDB (IF NOT EXISTS), so it is safe to re-run. Apply once
-- against a live DB that predates the regime override:
--
--   mysql <db> < sql/006_regime.sql
--
-- The application degrades safely without it (lib/tempo.php treats the missing
-- column as 'auto'), so the site never 500s if this has not been applied yet -
-- it simply stays on the clock-based regime until it is.

ALTER TABLE tempo
    ADD COLUMN IF NOT EXISTS regime_override TEXT NOT NULL DEFAULT 'auto';
