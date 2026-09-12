# Provenanced autobiographical memory

Status: LIVE engineering information-retrieval and subjective character layer.

This is not a biological memory model, a hippocampal simulation, a psychological
activation score, or authoritative world state. The structured environment-event
archive remains the source of truth about what happened. Autobiographical memory
stores what Cy may retain about it, including uncertainty and contradiction.

## Data model

MariaDB is authoritative. Migration `sql/015_autobiographical_memory.sql` adds:

- `autobiographical_memories`: current version, type, lifecycle state, privacy
  scope, consistency, optional subject visitor, private content and optional
  public summary.
- `autobiographical_memory_sources`: immutable provenance links to an environment
  event, postcard, generated expression batch, or explicit handoff seed.
- `autobiographical_memory_tags`: structured retrieval terms.
- `autobiographical_memory_revisions`: versioned CREATE, UPDATE, ARCHIVE and
  DELETE snapshots.
- `autobiographical_memory_activity`: explicitly public-safe activity only.
- `autobiographical_memory_queries`: owner-only recall access traces for every
  working-context refresh.

Memory types are EPISODIC, PERSON, MOTIF, UNRESOLVED_THREAD and SEMANTIC.
Lifecycle states are ACTIVE, ARCHIVED and DELETED. Consistency is CONSISTENT,
CONFLICTED or UNCERTAIN.

## Privacy scopes

- INTERNAL_ONLY can be recalled by Cy but is never exposed through the public
  memory API.
- SENDER_RECALLABLE can be recalled only while the exact signed pseudonymous
  visitor is the current postcard sender. A model cannot widen a postcard-derived
  memory to public scope.
- PUBLIC_RECALLABLE can be recalled by Cy and can expose its explicit public
  summary in the visitor memory browser.

Privacy is applied by the server before a candidate reaches either model call.
Model-facing candidates use temporary references such as `C1`; database memory
IDs and visitor IDs are excluded. Public generation telemetry removes the private
memory prompt block and reports counts rather than exact IDs. The owner-only
inspection endpoint is `public/api/memory-inspection.php`.

## Formation and revision

The runner queues provenance-bearing sources from structured environment events,
current-sender postcards and groups of four screened outward expressions. A
current-sender reply is linked to that same sender and cannot be considered for
another sender's private memory. One source is considered at a time. The server returns at most five privacy-eligible
existing memories. The active model must return one structured decision:

- CREATE a new memory;
- UPDATE exactly one supplied existing memory; or
- NOTHING.

The server validates the decision, provenance, version and privacy scope. UPDATE
uses optimistic version checking. Formation cannot edit or backfill the structured
world archive. A generated expression can become subjective autobiography but
cannot become evidence for a grounded Soma subsystem.

There is no automatic merge score. There is no model-generated chain-of-thought.
A separate periodic consolidation process is not implemented. UPDATE can revise
or merge one supplied higher-level memory while retaining revisions and sources.

## Candidate retrieval

The server discovers candidates across the full active store through indexed
exact-person, structured-tag and MariaDB full-text paths, then deterministically
filters privacy. The indexed pre-filter admits at most 100 person, 200 tag and
200 full-text rows into one at-most-500-row union. It retains only records
matching the current sender, a structured tag, or a lexical token. It returns at
most ten candidates in this lexicographic order:

1. exact current sender match;
2. number of structured tag matches;
3. number of lexical token matches;
4. unresolved-thread type;
5. update recency;
6. memory ID as a deterministic tie-break.

This is engineering ordering, not a scalar memory strength or psychological
salience value. Semantic vector retrieval is NOT IMPLEMENTED because the runtime
has no reliable configured local embedding facility.

## Working context and prompt assembly

A separate small model call sees at most ten already privacy-filtered candidates
and may select zero to three temporary references. Only valid selected references
are converted back to records. The resulting dedicated
`<AUTOBIOGRAPHICAL_MEMORY>` block appears in volatile Zone C after the grounded
Soma context. It labels every inserted item as subjective autobiographical memory
and preserves its consistency status.

The bounded recent-expression Zone B remains separate. It supplies immediate
continuity; autobiography supplies selective longer-term continuity. If retrieval
returns nothing or surfacing selects nothing, no memory block is added. Memory is
not supplied to the expressive action chooser.

## Returning visitors

The signed HttpOnly visitor cookie supplies a pseudonymous 32-character visitor
ID. On a current-sender postcard generation, exact-person retrieval occurs before
the reply prompt is assembled. Only that same visitor can unlock memories scoped
SENDER_RECALLABLE to them. The public page reports only how many such records the
current browser owns, not their contents or identifiers.

## Initial 8-by-4 motif

The user-approved 8-by-4 idea is a normal PUBLIC_RECALLABLE MOTIF with source
`handoff-17:8-by-4`. It is not a permanent prompt instruction. It can enter a
prompt only when ordinary candidate retrieval finds it and the surfacing call
selects it. Its consistency remains UNCERTAIN.

## Limits

These are engineering context and resource limits, not claims about cognition:

- ten retrieval candidates;
- three prompt memories;
- five formation-match candidates;
- 32 queued formation sources in runner memory;
- four outward expressions per CY_EXPRESSION formation source;
- one queued formation source attempted per four ordinary outward generations,
  with a current-sender postcard exchange forcing an immediate attempt;
- eight server operations per request;
- 20 public memory summaries per page;
- 100 exact-person, 200 tag and 200 full-text pre-filter rows, with at most 500
  unique rows passed to the deterministic ranker.

No time-based forgetting, periodic consolidation or reconsolidation model, stress narrowing, Soma-modulated
access, cognitive breakdown, or hippocampal activation mapping is implemented.
ARCHIVE retains revision history. Privacy DELETE removes content, visitor linkage,
sources, tags, prior revisions and public activity, retaining only an unlinked,
content-free tombstone and deletion revision.

## Authoritative files

- `runner/autobiographical-memory.js`: model contracts, privacy recheck, source
  adapters, prompt formatting and public telemetry redaction.
- `runner/memory-runtime.js`: bounded formation and working-context orchestration.
- `runner/prompt.js` and `runner/run.js`: live prompt integration.
- `runner/client.js`: authenticated server calls.
- `lib/autobiographical_memory.php`: validation, deterministic retrieval,
  versioned persistence and deletion.
- `public/api/memory.php`: public-safe browser data plus runner CRUD/query calls.
- `public/api/memory-inspection.php`: owner-only exact access traces.
- `public/assets/memory.js`: visitor browser and owner inspection surface.
