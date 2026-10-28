# Cue-bound journal memory preparation

Status: source-only implementation. No production deployment or inference is
authorized by this change. Base: production lineage `8363197`.

## Trigger and one opportunity allowance

`rememberEnvironmentRecord` observes the same bounded environmental source used
by the previous journal query path. It retains one latest cue, not one queued job
per event. Formation admission remains independent and unchanged.

Only `client.onDelivered` for the exact `world_event_record` authorizes that cue.
The server independently checks that the canonical `environment_events` row
exists, has the observed-consumer marker, and matches the cue and digest. Producer
checkpoint/delivery ordering is unchanged. Postcard world records cannot enter
this lane.

The preparation binding is:

```text
version: cy.journal-preparation.v1
slotAnchorMs: existing expressiveCadence.lastOpportunityAtMs
slotKey: SHA256(version + ':' + slotAnchorMs)
cue:
  version: cy.journal-cue.v1
  sourceEventId, occurredAt, eventType, eventFamily
  text: existing source projection, at most 600 Unicode codepoints
  tags: existing source tags, lower-case, distinct, sorted
  location: original canonical event location, or null
  scope: NO_SENDER_JOURNAL
  digest: SHA256(JSON encoding of the preceding cue values in this order)
```

The queue fingerprint is the slot key; cue identity is an additional mandatory
binding, not a fuzzy compatibility hint. The original location is a retrieval
cue, not a claim Cy still occupies it. Existing retrieval/ranking/selection
policies remain unchanged. Only this selector's formerly mutable broker inputs
are replaced by the frozen observed cue: no live clock, Soma, history or prior
journal text is silently added to preparation. The eventual journal retains its
normal live world/body context.

Preparation starts no earlier than the next opportunity's TTL horizon minus the
existing 120-second background work ceiling (15 minutes minus 2 minutes). Tempo
changes or interruptions may still make that forecast miss; nothing waits or
extends the TTL. There is no new expressive opportunity or psychological score.

Before admission, new cues coalesce. Admission spends the local allowance before
the first network await. The server inserts-or-reads an immutable queue slot;
existing/conflicting slots are never reopened. A new runtime refuses an already
existing slot, including a lost-acknowledgement slot. Claim durably increments the
existing attempt counter before retrieval. New-contract failures and recovered
interrupted attempts are terminal, not retryable. New cues invalidate an admitted
cue without buying another attempt for that slot. A newer source may qualify
only for a later existing opportunity.

## Narrow quiet-time reservation

Only `journal_preparation` worker admission may bypass deliberate generic quiet.
Ordinary optional surfacing still uses both existing quiet gates. A quiet-time
claim carries `journal_preparation_only: true` and cannot service other optional
consumers. A private identity-checked reservation accompanies the one background
selection call; purpose alone is insufficient.

Baseline `rawGenerate` already skips pre-model Tempo waiting for background work.
No broader exemption was added there. Coordinator admission, the shared arbiter,
execution profile, provider/sampler, background timeout and completed-call pacing
remain in place. The new reservation is expendable at the arbiter. Foreground,
pause, shutdown, location/eligibility changes and real wing noise can invalidate
or interrupt it. The narrow wing-noise hook does not change noise probabilities
or cancel ordinary formation/surfacing. Aged sender first refusal and the separate
generic-formation reservation/cadence are preserved.

### Mixed-queue classification correction

Rollout review reproduced a scope leak in candidate `5aedc3b`: when both gates
were open, a pending unrestricted claim was labelled from an unrelated open
journal reservation. An ordinary returned job then inherited journal-only
wing-noise cancellation (PREEMPTED instead of the control's PREPARED).

A pending claim now has ordinary, unprivileged classification. Only its returned
job can establish journal preparation: its fingerprint, generation reference,
exact cue/slot binding and no-sender scope must match the current acknowledged
private slot. An ordinary row never receives the reservation token. Binding
failure remains closed, including after restart with no live desire.

The adjacent admission audit also requires the returned job's own gate before
retrieval and before model dispatch. A quiet-only claim cannot lend its gate to
an unexpectedly returned ordinary row, nor can an ordinary row borrow a
concurrent reservation after its normal gate closes. Completed-call accounting
and pacing are not reinterpreted as a failed admission. Server claim ordering,
one-attempt accounting, formation service and fairness are unchanged.

The correction adds no data, persistence, API, prompt or generation settings.
The existing storage/privacy manifest therefore remains unchanged.

Correction validation on 28 October 2026:

- 21 new mixed-queue tests, including the unchanged pinned old-code reproducer.
- 152 focused preparation/liveness/status/formation-runtime tests passed.
- Full serial runner suite: 1,044/1,044 passed, 84.211 seconds, no skips.
- Eleven PHP scripts: 254 checks passed; all five isolated MariaDB/API groups
  passed, with owned database and fixture PHP processes stopped afterward.
- JS syntax, existing JSON metadata and whitespace checks passed.
- Independent scope/privilege review found no material issue. Formation first
  refusal, generic service, completed-call pacing and durable attempt limits
  remain unchanged. No production action or real provider call was made.

## Private preparation and nonblocking consumption

New-contract results never activate into `working.selected`. The expressive
chooser, drawings, postcards and other consumers cannot inherit them by default.
Opening the actual opportunity binds the old persisted slot anchor before cadence
advances. Already canonically validated, compatible READY data survives opening;
an optional asynchronous refresh may run, but the journal never joins it. This
matters because an ordinary journal-only choice is deterministic and supplies no
network-read lead time. Unfinished earlier reads are fenced at slot opening and
an unfinished initial revalidation still means omission.

The existing subject selector runs once with its unchanged inputs. Consumption
requires its exact `sourceEventId`, the exact open slot, cue/digest/no-sender
binding, current journal eligibility and unexpired preparation. Missing alignment,
unfinished canonical validation, changed sources, privacy/provenance problems,
missing/non-ACTIVE status or expiry means omission, not replacement or waiting.

Query-time canonical candidate versions travel in a private sidecar, not model
text. Completion compares them with current rows, so a change during selection
cannot certify stale selected prose against a newer row. A hash sidecar in the
existing queue context binds the unchanged sanitized selected projection to the
canonical content/version/status/privacy/provenance it selected. Prepared-get
rechecks those rows and the canonical cue. It rejects changes rather than
substituting content. Known local formation clears readiness and fences older
in-flight reads without changing formation itself.

This is an asynchronous snapshot contract, not an atomic database transaction
simultaneous with prompt freeze. External revocation after the final read remains
a synchronization limit; the change does not claim to solve that broader issue.

An eligible set is consumed once for the frozen journal context. The existing
prose retries reuse that context without another memory call. Consumption is not
proof of publication. Drawing, silence, freeze, closure or failure closes the
slot; a late result cannot change the frozen context. Startup contains no desire
or READY data. Old work retires through normal fingerprint supersession, with no
queue purge or historical rewrite.

## Storage, rollout and limitations

No migration, memory mutation, vector store, new memory system or formation call.
The existing private queue context holds the cue/slot and canonical hash sidecar;
attempt/prepared records retain existing lifecycle/selection data. Candidate
version sidecars are non-content metadata. Existing private inference accounting
and journal inspection identify attempted preparation versus actual insertion.
No new public diagnostic or autobiographical text export is introduced.

For a separately authorized rollout: deploy `lib/journal_memory_preparation.php`
before its PHP callers, then the compatible API/library changes, then the runner
module/client/runtime/run files and guarded restart. API-before-runner is required
for immutable slots, terminal attempts and canonical revalidation. No queue purge,
backfill, synthetic journal or demonstration inference is required or authorized.

The user explicitly accepted that initial attempts could increase toward existing
request/opportunity budgets (historically 9 toward 27), not new budgets. Success
is not guaranteed: short lead time, preemption, no candidates, changed sources,
strict subject alignment, TTL and unfinished reads remain legitimate omissions.
Deterministic tests prove the contract, not natural journal enrichment or model
relevance. Natural post-deployment evidence would still be needed.

## Verification on 28 October 2026

- Final complete serial runner suite: 1,023/1,023 passed, 86.517 seconds.
- Focused preparation/liveness/status/formation-runtime suite: 131/131 passed.
- New lane and production-wiring regressions cover acknowledgement, coalescing,
  one-attempt limits, quiet admission, cancellation/timeout, source alignment,
  exact ACTIVE/privacy gates, expiry, unfinished and negative canonical reads,
  deterministic journal selection, context isolation, restart and projected yard
  records. Existing formation and journal boundary regressions also pass.
- Eleven PHP memory scripts: 254 checks passed, including 29 new contract checks.
- Five exclusively owned local MariaDB/API groups passed: new preparation,
  existing journal liveness/status, formation delivery, formation inference and
  associative postcard memory. Final group run took 194.178 seconds. Owned
  database process and temporary PHP fixture servers were stopped afterward.
- JS/PHP syntax, changed JSON metadata and whitespace checks passed.
- Independent adversarial review: no outstanding material findings.

The review corrected query-versus-completion version races, real wing-noise
interruption, preservation of prevalidated READY through a deterministic chooser,
negative refresh invalidation, startup recovery reseeding and the marked yard
projection. No timestamp-age heuristic or extra model call was used to fix them.

The initial sandbox suite encountered EPERM temporary-file replacements and
EACCES loopback fixture connections. The complete suite was rerun in the normal
writable test-temp/isolated-loopback configuration. Older whole-source regression
pins now reverse only exact approved wiring deltas; dynamic publication,
finalization, location, sanitation, repeat, telemetry and privacy tests were not
weakened. No source test was excused as an unexplained production regression.

No production database, queue, runtime, clock or history was changed. No real
provider/model request, journal, drawing, movement or world event was forced.
