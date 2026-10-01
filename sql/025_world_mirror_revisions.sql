-- Additive world mirror ordering. NULL marks an unversioned legacy row that
-- needs an explicit baseline reconciliation before runner world work is enabled.
ALTER TABLE world_objects
    ADD COLUMN revision BIGINT UNSIGNED NULL AFTER status,
    ADD COLUMN transition_id CHAR(36) NULL AFTER revision;

ALTER TABLE world_threads
    ADD COLUMN revision BIGINT UNSIGNED NULL AFTER state,
    ADD COLUMN transition_id CHAR(36) NULL AFTER revision;
