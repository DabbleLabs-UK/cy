# Message object lifecycle

Physical message state, message lifecycle and Cy's knowledge are separate facts.
Possession by Cy never implies that he observed delivery or knows the contents.

## States

- `CREATED`: a distinct physical message exists but has not been delivered.
- `DELIVERED`: the recipient holds it; delivery may still be world-only.
- `READ`: a grounded observation established that the recipient obtained its content.
- `RESOLVED`: the message no longer represents an open current-world concern.
- `RETIRED`: the physical message has left current salient world state.

`RESOLVED` and `RETIRED` messages remain in durable state and event provenance but
are excluded from the current-object facts offered to AWG.

## Stored facts

Each message records sender/owner, recipient, current holder, location, bound
content and source claim, observed receipt, read state, lifecycle state, thread
association and all source world-event IDs.

## Continuations and knowledge

A continuation advances the object already associated with its thread. It may
create a new object only for a genuinely distinct physical message. `WORLD_ONLY`
delivery may change possession without creating Cy knowledge. A `CY_DIRECT` or
`CY_LEARNS_LATER` receipt establishes receipt only; content enters Cy's observed
facts on an explicit grounded `READ` transition.

Legacy objects without lifecycle metadata remain untouched until an explicit,
reviewed reconciliation. The migration only adds nullable storage for new state.
