# CELL-only waking-journal publication

Unreleased bounded repair based on production
`95daf45c95c8be398745bbf6baaf6d32493173d2`. No deployment, restart or model call.

## Demonstrated boundary

The main generation loop permits autonomous waking journals only in CELL, but
movement continues independently while inference, accounting and staging await.
The old publication edge validated prose without rechecking authoritative
location. Retained natural records show:

| Date | CELL journal context | Yard entry | Journal text publication |
| --- | --- | --- | --- |
| 22 October 2026 (BST) | 14:16:58.971 | 14:17:05.024 | 14:19:15.074-.078, sequences 2859646-2859647 |
| 23 October 2026 (BST) | 14:34:21.421 | 14:35:04.596 | 14:49:34.948, sequence 2898496 |

Context inspections 73557 and 73701 recorded CELL. These timestamps are evidence
of the boundary, not reconstructed complete provider responses.

## Narrow invariant and ordering

`streamGenerate` reads `vitals.locationRegime.current.id === LOCATIONS.CELL`,
the same live authority used by the existing main-loop eligibility gate. It does
not use the prompt snapshot, a cached location reference, elapsed time or an
invented scene epoch.

The unchanged complete-candidate filters, staging and final journal validator
run before the final location check. There is no await from the accepted live
check to `publishChunk`'s synchronous text enqueue. Only publication then appends
continuation; output feedback follows, and the existing outer loop admits
published journal timestamps, subject receipts, cadence and expression-memory
sources only for actual emitted/produced prose.

Two journal-only result fences use that same predicate: after collection/cleanup
before character repair, and before returning a repeat result after awaited
diagnostics/accounting. They prevent a departed journal from requesting the
existing quality-repair/repeat inference instead of being invalidated. They do
not add retries or cancel an already-spent request.

An invalid result has empty `full`, `repeat: false`, `aborted: true`,
`abortReason: JOURNAL_LOCATION_CHANGED` and `journalLocationRejected: true`.
Existing outer abort handling terminates that attempt without publication,
continuation, Soma output, recent openers, published journal bookkeeping or a
journal-derived expression-memory source. No prose is salvaged, deferred or
repurposed. World movement remains independent and untouched.

## Truthful diagnostics

The already-spent request still finishes its provider/coordinator lifecycle,
records the existing private termination diagnostic and accounts spend with no
emission. The existing private outcome ledger can record
`rejected-journal-location`; existing cycle diagnostics can report an abort.
Neither is evidence of a published journal. No extra prose, prompt, provider
payload, store, retention period or external recipient is added.

Earlier prompt preparation may already have consumed a cue or a prepared memory
working set. Those are truthful attempted-generation operations, not proof that
a journal occurred; this repair does not roll back or redesign memory handling.

## Scope and verification

The only runtime change is in `runner/run.js`. Prose validators, finalization,
provider termination handling, angle sanitation, repeat matching, prompt bytes,
token cap, existing retry limits, memory implementation and movement are pinned
against production in deterministic tests. Other prose modes are unchanged.
The old production control publishes a canned journal after actual offline yard
reconciliation; the repair produces zero prose/feedback while preserving the
identical movement state. Tests also execute the actual outer retry and
expression-memory admission bodies with in-memory sinks.

The rule deliberately checks current location, not departure history. A journal
whose final authority is CELL remains eligible; no general scene/epoch contract
is introduced. Other eligibility dimensions and unrelated yard mechanisms are
outside this repair. Natural production behavior remains untested until a
separately authorized deployment and subsequent natural activity.

## Validation on 27 October 2026

| Check | Result |
| --- | --- |
| New actual-runtime location/feedback regressions | 15/15 |
| Focused journal, drawing-boundary, memory and exercise suite | 253/253 |
| Full serial runner suite | 923/923; zero skips/cancellations |
| Isolated MariaDB/PHP API integration groups | 4/4 |
| Focused PHP scripts | 8/8 |
| Changed JS/MJS syntax | 7/7 |
| Tracked JSON/manifest parsing | 100/100 |
| Whitespace | clean |
| Independent read-only review | looks-good; no material findings |

Focused execution used workspace-owned TEMP/TMP after the sandbox default
temporary path rejected an unchanged exercise persistence rename (EPERM).
Sandbox full-suite attempts also denied existing loopback mock connections
(EACCES), affecting the unchanged transport and sender-formation tests.
The transport control passed outside the sandbox, followed by the entire serial
runner suite passing in that configuration without source/test-policy changes.
Disposable database initialization likewise required narrow escalation. The
four API integration groups used a new loopback-only instance with verified
PID/data-directory identity; the owned database was stopped after completion.
No existing database/service or production endpoint was used.

The focused suite includes existing complete-cap-question, incomplete explicit
length termination, missing/unknown termination, angle-prefix controls, repeat
exposure, private termination telemetry, queue supersession and selected ACTIVE
memory regressions. Old byte-pin fixtures normalize only the exact separately
tested location delta; the new suite verifies that reversing it reproduces the
whole production runtime source, not merely selected functions.

A future rollout requires only `runner/run.js` and matching data-handling
metadata. There is no new runtime module, API/schema change or deployment-order
dependency. Merge, guarded restart and natural production evidence are separate
authorization steps; none occurred during implementation.
