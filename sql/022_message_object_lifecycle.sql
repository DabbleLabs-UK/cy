-- Explicit lifecycle state for physical message objects. Existing rows remain
-- NULL until a separately approved reconciliation; this migration does not
-- infer or mutate legacy semantics.

ALTER TABLE world_objects
    ADD COLUMN message_state JSON NULL AFTER status;
