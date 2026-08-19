-- 008_regime_lease.sql - migration for an already-deployed database.
--
-- Turns the owner regime override (006) into something the PUBLIC can drive too,
-- but only as a short, self-releasing LEASE. Three columns on the single-row
-- `tempo` table describe WHO set the current regime and, for a public set, when it
-- lapses:
--   regime_source     - 'admin' (a sticky owner set, exactly as 006 behaved) or
--                        'public' (a visitor's short lease). Defaults to 'admin'
--                        so the pre-existing owner override keeps its old meaning.
--   regime_holder     - for a public lease, the signed visitor id (lib/visitor.php)
--                        that set it. NULL for an admin set / the default. The
--                        lease releases the moment this visitor is no longer present
--                        (presence keys this as 'v:'<id> in the `viewers` table).
--   regime_expires_at - for a public lease, the hard 5-minute ceiling. NULL for an
--                        admin set / the default.
--
-- A public lease lapses on READ, never on a timer (no cron): lib/tempo.php's
-- captive_tempo_regime() returns 'auto' and opportunistically clears these columns
-- the first time it reads an expired lease or one whose holder has left. An admin
-- set never lapses, and a public set can never override an admin set that is forcing
-- a non-'auto' regime (refused server-side).
--
-- Idempotent on MariaDB (IF NOT EXISTS), so it is safe to re-run. Apply once against
-- a live DB that predates the public regime lease:
--
--   mysql <db> < sql/008_regime_lease.sql
--
-- The application degrades safely without it (lib/tempo.php treats the missing
-- columns as "an admin set with no lease", i.e. exactly the 006 behaviour), so the
-- site never 500s if this has not been applied yet - the regime simply stays
-- owner-only until it is.

ALTER TABLE tempo
    ADD COLUMN IF NOT EXISTS regime_source     VARCHAR(8)  NOT NULL DEFAULT 'admin',
    ADD COLUMN IF NOT EXISTS regime_holder     VARCHAR(64) NULL,
    ADD COLUMN IF NOT EXISTS regime_expires_at DATETIME    NULL;
