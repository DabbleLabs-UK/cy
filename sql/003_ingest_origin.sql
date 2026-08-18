-- 003_ingest_origin.sql - migration for an already-deployed database.
--
-- Adds the single-row `ingest_origin` table that records DELL's public IP as
-- seen by the authenticated /api/ingest.php POSTs. A browser whose resolved
-- public IP matches this (same NAT) is auto-granted admin (see lib/admin.php).
-- Idempotent (IF NOT EXISTS), so it is safe to re-run. Apply once against a live
-- DB that predates the automatic same-network admin unlock:
--
--   mysql <db> < sql/003_ingest_origin.sql
--
-- The application degrades safely without it (lib/admin.php treats a missing
-- table as "no auto admin"): the ?111 fallback still works, nothing 500s.

CREATE TABLE IF NOT EXISTS ingest_origin (
    id       TINYINT UNSIGNED PRIMARY KEY,
    ip       VARCHAR(45) NOT NULL,   -- DELL's public IP (v4 or v6), as a string
    seen_at  DATETIME NOT NULL       -- when that IP was last seen ingesting
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
