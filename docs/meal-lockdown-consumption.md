# Meal consumption during lockdown

## Audit decision: B - the admission veto was overbroad

Authority: production `1790d137cc4efbc2f24508a8761ebc943bfba893`.
Read-only DELL inspection on 24 October confirmed the deployed runtime hashes
and the breakfast/lunch `STALE_BEFORE_OFFER` diagnostics. Both were available,
awake CELL opportunities; neither reached inference. Historical records remain
unchanged and terminal. This fix does not reoffer either meal.

`location-regime.js` defines a lockdown start as "movement and association
stopped". The runner starts it while Cy is in CELL. One persisted 25-90 minute
release target is chosen at onset; release completes the same episode. Location
reconciliation prevents exercise and scheduled routines, interrupts routines
where applicable and marks the current activity LOCKDOWN. AWG admission is also
blocked. This is not a blanket ban on all voluntary in-cell activity; expressive
action availability does not require absence of lockdown.

`fireScheduled` distinguishes schedule/expectation from observed delivery. It
requires the actual CELL location, wakefulness and the applicable schedule/day
window before it can create availability. `chooseMealEvent` then establishes
"arrived and was available to eat", with `world.meal_availability.available=true`
and CELL context. The meal prompt describes food actually present. Availability
is not merely an announcement awaiting movement or release. No independently
authoritative rule removes this food or prohibits consuming it during lockdown.
The pre-agency meal path likewise did not exclude lockdown consumption.

The exclusion first appeared in the initial meal-choice commit `5087e53`, with
the combined search/lockdown/routine restriction predicate and identity fence.
The implementation/documentation supports a conservative admission and stale
world-state safeguard, not a separate food-inaccessibility rule. There is no
retained rationale establishing that all voluntary activity must cease or proof
that this was literally copied from another guard.

## Narrow correction

Only remove ACTIVE lockdown from `currentMealContext().restricted`. Keep its
episode ID/status in `restrictionIdentity` unchanged. The patch does not alter
delivery, movement, search, routine, sleep, clock, model or action semantics.
Only an already available meal in the same actual CELL location can be offered.

A lockdown beginning or ending during an offer/inference/commit still changes
the fence and discards the result as stale. This deliberately retains the prior
conservative transition policy rather than broadening the fix. Search/routine
changes, owner regime changes, sleep, location changes, meal expiry/unavailability,
cancellation and provider failure retain their existing fail-closed behavior.
Offer/commit/effect persistence, restart recovery, delivery receipts and canonical
feeding/satiety calculations are untouched. No migration is needed.

## Offline regression boundary

`meal-lockdown.test.js` executes the actual `currentMealContext` function body
with controlled clock/sleep/regime inputs, never importing or starting the live
runner. It combines this projection with the existing decision, location,
lockdown lifecycle and real Soma/feeding machinery. Mock responses only:

- delivered CELL meals with/without lockdown, for both eat and decline;
- sleep, unavailable/missed delivery, being away, active search/routine;
- lockdown onset/release and all retained validity/cancellation changes in flight;
- release during commit IO and recovery of a persisted commit in the same lockdown;
- invalid/absent output, exactly-once intake and zero-intake decline;
- lockdown still excluding exercise, routines and unrelated AWG.

Existing meal/checkpoint tests cover unknown intake, cross-meal identity,
canonical physiology equivalence, outbox receipts and real disk recovery.
No real model, production state, clock or meal is manipulated by these tests.

## Verification (24 October 2026)

- Focused meal/lockdown/location/checkpoint tests: 98/98 pass, including 27 new
  regressions. JavaScript syntax checks and `git diff --check` pass.
- Full root runner suite: 683/683 pass across 134 files with test concurrency 2;
  no skipped/cancelled tests. Duration 74.325 seconds, not a performance claim.
- Initial sandboxed focused run hit the existing Windows atomic checkpoint
  rename EPERM; the identical disposable checkpoint test passed outside that
  restriction. No product/test workaround was introduced.
- Initial default-concurrency full run passed 682/683. The unchanged mock-HTTP
  abort test missed its 20-ms connection-close observation. It passed in isolation
  and in the complete bounded-concurrency run; its assertions were not changed.

Logs are retained outside the checkout in
`C:\Users\jodyf\Documents\Codex\2026-09-03\som\cy-meal-lockdown-evidence-20261024`:
`focused-tests.log`, `full-runner-tests.log` (initial run), and
`full-runner-tests-bounded-concurrency.log` (complete passing run).

The sole runtime change is the meal-only restriction predicate in `runner/run.js`.
No merge, deployment, production restart, historical replay or inference occurred.
