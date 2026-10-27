# Discrete yard greeting choice

Unreleased `fix/yard-contact-turn-20261027`, based on production
`0eeb5b6c654e54c807b9b29f0136a1e420fac450`. This work used deterministic
offline fixtures only. No deployment, runner restart or real inference.

## World authority and bounded choice

The unchanged yard schedule, actual location reconciliation, 15-minute
observation cadence, outcome draw and cast draw still select the opportunity.
Only a qualifying canonical inmate `conversation` draw now establishes a
greeting instead of immediately asserting a completed Cy conversation. Root,
Daemon and officers cannot enter this branch. Quiet, company, officer and
other-person-avoidance observations retain their original machinery and draws.
An ineligible draw is never replaced by a reroll.

The greeting is a discrete encounter turn. It establishes that this inmate
greeted Cy at that encounter, not continued NPC presence. Both canonical Social
records are completed zero-duration points with different episode IDs. There is
no presence expiry, waiting duration, inferred departure or relationship change.
The engineering inference timeout is not a world lifetime.

The active character/provider path may return only:

```json
{"action":"respond"}
```

or `{"action":"decline"}`. Extra fields, prose and unsupported values fail
closed. The prompt carries the character knowledge boundary, actual greeting,
canonical counterpart description explicitly labelled as standing description
and not episode evidence, supported bodily context and up to three recent
observed world summaries. It does not ask for dialogue or another person's
reaction. There is no answer-shaped example or generated opportunity identity.

## Checkpointed state

`vitals.yardContactChoice` reuses the existing sectioned vitals checkpoint:

```text
schema: cy.yard-contact-choice; version: 1
encounters[]:
  id, castKey, castName, exerciseEpisodeId, fence, openedAt
  phase: AVAILABLE | OFFERED | COMMITTED | RESOLVED
  offeredAt
  decision: null | {id, encounterId, action, committedAt}
  resolution: null | {id, action, status, executionStatus, reason, resolvedAt}
  opening, resolutionRecord
  projectedRecordIds[], pendingEvents[], acknowledgedDeliveryIds[]
```

Opening and resolved canonical source records are immutable after construction.
Only outbound delivery copies acquire actual consumer receipt metadata, using a
fixed whitelist which cannot replace the world event, observation or Soma input.
Today's receipts, unresolved work, unprojected work and unacknowledged delivery
are retained, plus the newest 56 otherwise completed older receipts.
Unrecognised checkpoint shapes fail rather than silently dropping a decision.

## Resolution meaning

| Result | Authoritative consequence |
| --- | --- |
| Respond | Cy returned that inmate's greeting; CONTACT, RECIPROCAL, actor Cy |
| Deliberate decline | Cy chose not to answer that greeting; OPPORTUNITY, NO_RESPONSE, actor Cy |
| NO_DECISION / NOT_EXECUTED | No Cy social action is established; no hostility, isolation, emotion, waiting or departure inferred |

Provider failure, malformed output, cancellation, timeout, replacement, stale
fences and unfinished restart work are nondecisions, never refusals. A committed
choice that cannot execute remains stored separately from the nonexecuted
resolution. Later grounded context explicitly distinguishes returned greeting,
deliberately declined exchange and no executed decision. An exact timestamp tie
prefers a resolved yard outcome over its opening without extending presence;
all non-yard tie ordering is unchanged.

## Feasibility, ordering and recovery

Live authority is `vitals.locationRegime`, effective sleep, London exercise
minutes and the existing regime override epoch. The turn requires the same
actual yard location entry/source, active daily exercise episode and regime
episode, awake state and compatible restriction/search/routine/lockdown state.
Leaving and re-entering cannot revive the old turn. The hard 15:15 close remains.

1. Construct the greeting privately and checkpoint its stable identity.
2. Project only that durable greeting, checkpoint projection/Soma receipts and
   identified delivery payload, then admit external delivery.
3. Mark OFFERED and checkpoint before the sole permitted provider call.
4. Recheck eligibility after provider and cleanup/accounting return.
5. Checkpoint the committed decision; read fresh feasibility again.
6. Resolve synchronously at that current time, then checkpoint the immutable
   result before any outcome consumer can see it.
7. Project the durable result to existing Soma, history and exercise linkage;
   checkpoint the resulting projection receipts before public/source delivery.
8. Replay missing delivery with the same deterministic UUIDs and source IDs.

The synchronous feasibility check and resolution establish an action fact;
movement during the subsequent disk IO does not backdate or cancel that fact.
Concurrent flushes are serialized per state and snapshot their source envelopes
before IO. A concurrent resolution cannot sneak through an earlier checkpoint.
Failed projection persistence is retried before external delivery without
projecting twice in the same process. After a crash, source/projection sections
recover together through the existing checkpoint protocol.

Restart closes AVAILABLE, OFFERED or COMMITTED work as nondecision: no old
choice is re-asked or executed. A durable resolved outcome is not re-decided.
Opening and terminal world records plus one public event have stable identities;
existing ingest receipts make replay at most one logical publication. Delivery
acknowledgements retire pending copies. Terminal memory-source admission uses
the existing source-ID deduplication path, not a new formation/retrieval call.

For a nondecision, the sole public row describes the established greeting at
its original timestamp and links its original opening event. The later private
canonical closure truthfully records that no executed response/decline is
established. Restart cannot manufacture a new encounter or fresh NPC presence.

## Inference and service boundary

The normal off-CELL generation gate services only an AVAILABLE yard turn and
then retains its previous idle behavior. It does not enable journals/drawings.
Movement/regime scheduling never awaits provider inference. Existing serialized
coordinator, shared arbiter, cancellation and resource admission remain in use.
Only deliberate Tempo quiet is bypassed for `yard_contact_choice`, following the
existing meal-choice precedent. The completed request still paces subsequent
prose. There is at most one call per opportunity, with the existing finite
foreground timeout and no repair/replacement call.

Existing content-free private request/spend accounting remains. Lifecycle
diagnostics add only stage, IDs, phase, chosen action/status and reason to the
existing private inference ledger. No visitor text, generated dialogue, new
store, new public diagnostic or historical rewrite is introduced.

## Runtime surface and rollout boundary

Five runtime files change:

- `runner/yard-contact-choice.js`: pure state machine and identified delivery.
- `runner/run.js`: existing observation admission, current authority, small
  off-CELL service point, startup/fence reconciliation and durable projections.
- `runner/client.js`: identified yard delivery without reminting UUIDs.
- `runner/grounded-prose-context.js`: narrow executed/declined/nondecision cue.
- `runner/social-contact-substrate.js`: resolved-yard-only timestamp-tie rule.

`docs/data-handling.json` documents the existing checkpoint/diagnostic paths.
There is no API, SQL, schema, general NPC simulator or new memory architecture.
Existing byte-pin fixtures normalize only separately tested yard deltas; the
new integration suite reverses the run/client deltas and compares entire files
to the exact production base. Historical journal, memory and world data stay
untouched. Merge/deploy/restart require a separate authorized task. Real-model
response preferences and natural yard usefulness remain empirically untested.

## Deterministic verification

The new module and integration suites cover all requested outcomes, current
world fences, strict parsing, cancellation/cleanup, one-call cardinality,
unchanged observation draws/cadence, actual checkpoint restart/crash points,
immutable source and delivery receipts, late recovery chronology, real Social
and grounded context, ordinary movement and CELL-only generation isolation.

| Check | Result |
| --- | --- |
| New state-machine regressions | 37/37 |
| New actual-runtime/checkpoint integration regressions | 19/19 |
| Focused yard, journal, memory, meal, exercise, location, Social and Tempo | 338/338 |
| Full serial runner suite | 979/979; zero skips/cancellations |
| Focused PHP scripts | 8/8 |
| Isolated MariaDB/PHP API integration groups | 4/4 |
| Changed JS/MJS syntax | 17/17 |
| Tracked JSON/manifest parsing | 100/100 |
| Whitespace | clean |
| Final independent read-only review | looks-good; no material findings |

The complete suite took 311.109 seconds; focused execution took 132.109 seconds
on this run. Both used workspace-owned TEMP/TMP. The complete suite used narrow
command escalation for existing isolated loopback transport fixtures, not
production access. Eight PHP scripts covered journal supersession, canonical
autobiographical memory, origin/retention/tags, generic memory, location API and
environment inspection. Four API integration groups used a fresh, loopback-only
owned MariaDB directory with verified process/data identity and were stopped
after completion; they covered surfacing liveness, generic memory and existing
formation delivery/inference contracts using fake providers only.

Initial suite failures were fixture assumptions about the newly added purpose,
scheduler callback or byte-pinned files, plus pre-enrichment delivery comparison
expectations. Those were corrected narrowly rather than removing the original
behavior checks. Independent review also found that outbound inspection copies
initially omitted actual consumer receipts; the fixed payload copies retain
those receipts durably while original source records remain immutable. The
final complete run above has no failures.
