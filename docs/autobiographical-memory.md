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

Migration `sql/017_memory_runtime_queue.sql` adds durable formation and surfacing
queues, expiring prepared working sets, and owner-only attempt records containing
provider/model, prompt size, latency, result category, queue depth and errors.
Migration `sql/027_memory_formation_delivery.sql` adds claim receipts, consecutive
failure counts and terminal/quarantine status without discarding old sources.
Migration `028_memory_formation_contract.sql` adds an independent invalid-model
decision counter. It starts at zero because the old failure count also included
infrastructure errors; existing statuses and completion receipts are not reset.

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

The runner writes provenance-bearing sources to a restart-safe Dell disk spool,
then transfers them idempotently to the durable server queue. Sources include structured environment events,
current-sender postcards and groups of four screened outward expressions. The
postcard's observed world record remains, but does not create a second unlinked
generic formation source. Old unlinked correspondence sources are quarantined
before claim, retaining their provenance. A
current-sender reply is linked to that same sender and cannot be considered for
another sender's private memory. One source is considered at a time by a
background worker. Aged sender correspondence gets a turn before optional
surfacing, plus one reserved waking turn at most every ten minutes, including
an already-running sender formation; immediate
visitor replies still preempt it. The server returns at most five privacy-eligible
existing memories. The active model must return one structured decision:

- CREATE a new memory;
- UPDATE exactly one supplied existing memory; or
- RESOLVE one offered same-sender UNRESOLVED_THREAD only when the new source
  clearly settles it, archiving it with a revision and resolving provenance; or
- NOTHING.

Sender POSTCARD/CY_REPLY formation uses an Ollama JSON Schema with separate
action shapes and no additional properties. CREATE needs only type/content;
NOTHING has no other fields. UPDATE/RESOLVE use exact offered `FM1`-style refs,
distinct from shared-context labels. Without an eligible target those actions
are absent from the schema. CY attaches sender-only scope, IDs and provenance;
the parser independently enforces fields, reference membership and privacy.
PERSON represents durable sender facts, UNRESOLVED_THREAD a persistent open
issue, EPISODIC a meaningful episode rather than a personal-fact fallback, and
trivial greetings normally yield NOTHING. Other source contracts are unchanged.

The server validates the decision, provenance, version and privacy scope. UPDATE
and RESOLVE use optimistic version checking. The operation and queue completion
commit in one transaction, so replay of a claim token returns its original
receipt without applying a second memory. Errors, invalid responses and timeouts
use bounded exponential backoff. Six rejected model decisions for a source enter
a retained FAILED state. Operational errors, timeouts and foreground preemption
do not consume that separate invalid-decision allowance; they remain retryable
at a capped rate so shared-model contention cannot discard a
valid source. Formation cannot edit or backfill the structured
world archive. A generated expression can become subjective autobiography but
cannot become evidence for a grounded Soma subsystem.

Owner-only attempt inspection exposes bounded structural rejection codes and
both retry counters from the transactional receipt. It does not retain raw model
responses or source text in the new diagnostics. The production timeout and
preemption policy are unchanged. The opt-in synthetic probe is
`scripts/probe-sender-formation-contract.mjs`; it never uses production memory.

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

A separate background model call sees at most ten already privacy-filtered candidates
and may select zero to three temporary references. Only valid selected references
are converted back to records. The resulting dedicated
`<AUTOBIOGRAPHICAL_MEMORY>` block appears in volatile Zone C after the grounded
Soma context. It labels every inserted item as subjective autobiographical memory
and preserves its consistency status.

Prepared sets are keyed by a SHA-256 context fingerprint and exact sender scope,
expire after 15 minutes, and are marked with the generation that consumed them.
A stale or differently scoped set is never reused. Journalling does not wait for
surfacing. Postcards independently require a canonical same-sender continuity
read (up to 5 seconds, no model selection), reserving two PERSON and two unresolved
topic slots at most, bounded to 600 characters each. A failed required read holds
the reply under existing claim retry/expiry rules. Identity still comes from the
inbox visitor record. Optional broader enrichment waits at most 750 ms for a
compatible prepared set and cannot displace required continuity. Both providers
use one privacy-filtered turn snapshot. See `postcard-inference.md` for timing
evidence and limits; this does not promise exhaustive recall or completed memory
formation for every exchange. Interactive foreground work preempts local
background memory work; interrupted jobs remain retryable. Remote sender
formation uses no local-model lease and is not preempted by local foreground
work. Pause and shutdown still cancel it.

## Sender formation provider and accounting

POSTCARD/CY_REPLY sources with canonical sender identity and SENDER_RECALLABLE
provenance use a dedicated server setting: DEEPSEEK by default, LOCAL only by
explicit owner selection, or OFF to retain work without inference. There is no
provider fallback. All routes use the same canonical request, exact FM candidate
references, parser, provenance rules and transactional apply/completion. DeepSeek
uses the beta strict forced-tool encoding of the same decision schema; it does
not own a second memory store. Its configured alias is deepseek-v4-flash; the
actual returned model is recorded separately. Other formation/surfacing remains
on its existing route.

Every cloud attempt first reserves conservative cost in an independent ledger:
the serialized request's UTF-8 byte length plus 4096 framing tokens, and the full
260-output-token allowance. Defaults are concurrency 1, 20/100/1000 requests and
GBP 0.05/0.25/2 per hour/day/month. The hour rolls; day/month use UTC calendar
boundaries. Prices use conservative peak USD/M 0.30 uncached input, 0.006 cached
input and 1.20 output, converted at GBP 0.79/USD. These are estimates, not invoices.
The generous small-use allowance remains bounded during a backlog or viral event.
Reply budgets are independent. Settings survive restart in SQL.

Admission is unique per canonical queue claim. A lost admission acknowledgement
cannot dispatch a second paid call for that claim. Unknown provider usage keeps
its reservation; expiry releases concurrency but never retrospectively refunds
uncertain cost. Settlement is idempotent. Decision/application results join the
accounting row in the canonical completion transaction. Operational holds and
failures use durable backoff, not the invalid-decision terminal counter. Completed,
FAILED and quarantined jobs are not reset. Pending sources keep their original IDs.

The existing inference panel separates REPLY and MEMORY caps, ranges and owner
controls. Public output is aggregate only. No prompt, private source text or raw
model response is added to the formation accounting ledger.

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
- no fixed formation backlog cap; every unique source is retained durably;
- four outward expressions per CY_EXPRESSION formation source;
- one background memory model call at a time, with aged sender formation before
  optional surfacing, then other formation;
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
