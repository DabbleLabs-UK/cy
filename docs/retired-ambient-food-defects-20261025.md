# Retired ambient food defects

Source-only bounded retirement based on production
`d335e0f6e6642c62d2a955338daea1b2c772027d`. No merge, deployment, restart,
inference, forced meal, migration or historical-state rewrite is authorized.

## Reason and boundary

The 22-25 October natural audit found 172 canonical/public food-defect events:
89 `no_eggs` and 83 `cold_tea`. All lacked meal identity; none overlapped an
unresolved meal transaction. Only fourteen were within fifteen minutes of a
recorded delivery, a descriptive comparison rather than a food-lifetime rule.
The remaining 158 were farther away. Daily totals were 35, 45, 52 and 40
(25 October partial, through 21:30 London time).

The producer ran independently on awake CELL scheduler passes with probability
0.004, then selected either name uniformly. At five-second eligible ticks that
means an expected 2.88 combined events per hour, with no meal/tray check,
cooldown, episode identity or semantic deduplication. Its incident templates
invented further details and recurrence counts. Canonical intake/satiety was
already protected by the September feeding guard, but `no_eggs` still asserted
partial deprivation metadata, both names drove provisional diagnostics, and
both fed narrative context. This retirement does not attach fictional
ingredients, temperatures or tray lifetimes to real meals.

## Runtime changes

1. Remove only the scheduler's independent food-irritation RNG block, including
   its `recordIncident('trivial', ...)` and `fireEvent(sub)` calls. There is no
   replacement roll, quota, flavour event or compensating random draw.
2. Remove the event-name mapper that minted a `meal`/homeostasis record and
   `deprivation_outcome: partial` without food evidence.
3. Remove the food-specific `trivial` incident builder. Explicitly retire that
   kind with a null result, rather than allowing the generic unknown-kind
   fallback to invent replacement texture. The existing record wrapper returns
   immediately for that null result, before timestamp/ledger/incident-clock or
   Soma observation changes.

Real scheduled meal availability/delivery, chooser request/parse/commit/recovery,
canonical feeding, physiological satiety and genuine deprivation are unchanged.
Neighboring ambient producers retain their existing gates and probabilities.
Removing RNG draws does not promise identical subsequent random samples.

## Remaining references and historical compatibility

- Historical `no_eggs`/`cold_tea` event labels and chronology grouping stay in the
  public readers. Historical ledger reconciliation/rendering stays unchanged.
- Generic `applyEvent` deltas/legacy trivial-event classification in `vitals.js`
  and name-sensitive appraisal inside the shared Soma consumer remain unchanged.
  They do not create or schedule observations themselves. With the only live
  named producer removed, they have no new source from this path. Their removal
  would broaden this change into compatibility/legacy-system redesign.
- Shared feeding guards remain, including tests that historical name-only
  records cannot mutate intake or satiety. Generic context, memory, journal,
  dream and real-incident plumbing are unchanged.
- Explicit fixtures and the separate fake viewer feed may still contain the
  names; they are not the natural runner or a production ingest writer.
  The standalone manual live-sample script contains old descriptive examples
  but is not imported or invoked by production; it was not executed.
- Two journal test fixtures now supply persisted historical incident objects
  rather than invoking the retired builder. The offline self-test no longer
  tries to mint a retired incident; its legacy delta demonstration is retained.

Existing stored records, old context and subjective writing are not scrubbed.
They may therefore still contain food motifs; this prevents new originating
events, not all future mentions of food or old experiences.

## Regression and review evidence

The accompanying retirement tests exercise the actual scheduler with offline
dependencies and a pinned old-production control, not model inference or a live
runner. They check removed event/incident effects, the retired direct incident
kind, the absent structured mapper, valid neighboring incidents and historical
readability. Existing meal/feeding/satiety/restart tests cover preserved causal
behavior. Final test counts, control outcomes and independent review are recorded
below before rollout review.

| Validation | Result | Duration |
| --- | --- | --- |
| New retirement regressions | 6/6 | Included in combined run |
| Combined focused suite | 102/102 | 2.671 seconds |
| Full runner suite | 766/766 | 30.109 seconds |
| Standalone offline self-test | Passed | No model/provider invoked |

No failed, cancelled or skipped tests. Syntax checks passed for all changed/new
JavaScript; data-handling and all twelve model-spec JSON documents parse;
whitespace checks pass. The genuine environment, meal-choice, feeding,
physiological-satiety, satiety-restart and vitals modules compare byte-identical
to production after normalizing only checkout line endings. Soma, journal,
dream and prompt modules also have no source changes.

The pinned `d335e0f` control and candidate execute 200 equivalent eligible
awake-CELL scheduler passes, forcing independent random sites rather than
claiming identical post-removal random-stream positions:

| Observed control effect | Old production | Candidate |
| --- | ---: | ---: |
| `no_eggs` public events | 100 | 0 |
| `cold_tea` public events | 100 | 0 |
| Canonical capture calls | 200 | 0 |
| Soma observation calls | 400 | 0 |
| Legacy event-application calls | 200 | 0 |

Retired-kind direct calls leave ledger, incident clock and vitals unchanged.
Direct mapping calls create no food/deprivation record. A valid neighboring
overheard event still creates its ordinary incident, observation and public
event. Historical incidents reconcile and render unchanged. These are offline
deterministic controls, not sampled natural frequencies or model behavior.

Independent review found no material issue after tracing live event/incident
callers, dynamic-name sites and remaining name references. It confirmed remaining
references are consumers, historical readers or separate non-ingesting fixtures,
not an alternate live producer. The reviewer inspected the regressions; the
executed results above come from the main verification run. Unpublished
accelerated-soak tooling outside this candidate is preserved and is not claimed
as a post-retirement scheduler oracle.

Parent-workspace validation-log SHA-256:

| Log | SHA-256 |
| --- | --- |
| `ambient-food-retirement-focused.log` | `f771bb6d38d27fb2edc34fe454433050a251aab2e8b1be1c8b6c7317437d4b7d` |
| `ambient-food-retirement-full.log` | `e505f3b1ce7b8873b025eba45427ac80e923c1afaea8573ece02d317952bf142` |
| `ambient-food-retirement-selftest.log` | `41d2aa5008aa22804255bd383ec25d134a32f363668496b6c86dc2fa9330abe3` |
