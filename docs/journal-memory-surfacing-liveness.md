# Optional journal memory surfacing liveness

Scope: queue liveness only, based on production ecd0064974f440394935cf297b901230c2368b91.
No deployment, production queue mutation or inference is part of this change.

## Authority and behavior

The runtime already owns one desired compatible context fingerprint. The
fingerprint excludes generationRef, so a later journal with identical compatible
input can reuse prepared work. Only no-sender contexts in the existing exact
`journal:<decimal timestamp>` namespace are governed by this repair. Unknown
legacy namespaces and other optional consumers are not guessed to be journals.

Every surfacing claim supplies that desired journal fingerprint, or explicit
null if the runtime has no desired journal (including after restart). In the
existing claim transaction, incompatible PENDING/RETRYABLE/PROCESSING journal
rows become SUPERSEDED before selection. No age threshold or new queue is used.
The remaining current compatible job competes under unchanged priority ordering
with other live optional consumers; obsolete journals no longer precede it.

The runner rechecks compatibility before indexed search, after search/before
model selection, and after model selection. A formerly live in-flight call may
finish, but cannot activate its result in the newer context. Existing foreground
preemption and timeout mechanisms remain unchanged. Late server completion of
an already superseded job stays SUPERSEDED and creates no prepared set.

## Persisted backlog and later rollout

No manual purge or migration is needed. On the first compatible claim, persisted
incompatible open journal rows are terminally retired without retrieval attempts.
If restart has no live desire, explicit null retires all recognized open journal
work. New journal contexts can enqueue normally afterward. Durable memories,
formation, prepared-set history and historical telemetry are not rewritten.

Any separately authorized rollout must deploy the PHP library/API before the
runner. An older client without fingerprint authority cannot claim journal work
under the new API, but can still claim unrelated optional work. The new runner
must not be deployed alone against an API that lacks SUPERSEDED completion.
Rollback must keep compatible API handling while this runner is installed.

## Telemetry

PENDING means no retrieval result is ready, not a completed zero-hit search:
candidate/offered/selected/inserted counters and retrieval_attempted are null.
Work may be unclaimed or already in flight; readiness alone cannot distinguish
them. Existing PREPARED/LIVE result counts and attempt categories remain.
The private owner inspection adds superseded_before_attempt, counting terminal
queue rows whose attempts remain zero. A claimed job superseded by the runner
has its own SUPERSEDED completion attempt, separate from unattempted retirement.
No raw model responses or extra visitor identifiers are recorded.

## Separate pre-existing activation limitation

The new regression suite exposed an unchanged issue: selected memory projection
omits status, then activatePrepared applies the existing eligibility filter
again, requiring status ACTIVE. The saved projected selection can therefore be
prepared but activate as empty. A deterministic test reproduces this on both the
deployed base and this branch. A full-record prepared set still activates.

This branch deliberately does not alter eligibility/projection or claim that
removing obsolete queue work guarantees journal enrichment. That separate
boundary needs its own bounded investigation/authorization; no live data was
inspected or modified to demonstrate it here. Resource contention, foreground
preemption and genuinely empty selection can also still prevent enrichment.
The existing optimistic query-ledger inserted IDs are not repaired here either;
they must not replace inspection of actual prompt contents/consumption as proof
that a recollection reached character generation.

## Verification

Deterministic runner tests cover 215 obsolete requests with zero search/model
calls, a usable current request, in-flight supersession, compatible fingerprints,
restart authority, unrelated consumers, privacy, pending telemetry and byte-
unchanged journal/prompt/finalization/formation paths. An isolated MariaDB/PHP
integration test exercises the real persisted queue, HTTP claim/completion,
restart, late completion, old-client behavior and unchanged memory/formation rows.
No real provider/model call is used.

### Validation and review (26 October 2026)

- Focused runner memory suites: 55 passed, including 18 new liveness cases.
- Final complete serial runner suite: 873 passed, zero failed/skipped, in 266.046
  seconds. No real provider/model requests were made.
- Liveness plus search-retirement regression check: 28 passed.
- New PHP namespace/authority checks: 15 passed; eight existing PHP memory suites
  also passed.
- Real isolated MariaDB 10.10.2 / PHP 8.4 HTTP suites: four passed, including the
  new persisted-backlog/restart test, formation delivery, formation inference
  accounting and associative-retrieval integration. Synthetic fixture data only;
  the owned database process was stopped afterward.
- PHP/JavaScript syntax, 100 tracked JSON files and git whitespace checks passed.
- Independent read-only review cleared the liveness logic, late-completion
  fencing, privacy/formation scope and API-first handoff after correcting the
  PENDING telemetry ambiguity.

The initial integration fixture omitted existing migration 017; loading that
migration into the disposable database fixed the fixture, not production code.
Initial full runner runs reported one reproducible failure: the old search-
retirement test pinned the entire client file, including the intentionally
changed memory-claim wrapper. That assertion now permits only the exact wrapper
change; every other client byte remains pinned. The 28-case targeted run and
independent review both cleared that test-only adjustment.
