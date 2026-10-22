-- No historical opt-in/backfill. Permission belongs to one submitted exchange.
ALTER TABLE postcards
    ADD COLUMN recall_permission_version VARCHAR(32) NULL,
    ADD COLUMN recall_permitted_at DATETIME(3) NULL;
