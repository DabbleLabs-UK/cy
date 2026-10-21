# Episode-bound exercise admission

Unreleased feature based on production fd1397d. No AWG integration or LLM call.

## Scope and fictional policy

The existing 14:15-15:15 Europe/London exercise window is unchanged. Its former
22% exercise late-unlock draw now happens once in the admission state machine,
before location reconciliation. Conditional delay choices remain 15/20/25/40
minutes, equally weighted. These are fictional HMP ThinkPad pacing policy, not
real prison policy, scientific parameters or inferred staff activity.

The hold starts at the actual observed decision, not at an invented earlier
time. Thus a late first observation can leave too little window for admission.
A restarted persisted hold keeps its original target, never a fresh duration.
No officer, escort, staffing cause, conversation or explanation is generated.
The morning unlock and cancelled-association legacy paths are out of scope.

## State

The existing `locationRegime.exerciseEpisodes` history (14 entries) owns each
`exercise:YYYY-MM-DD` record. Its existing attendance fields remain separate:

```json
{
  "id": "exercise:2026-10-21",
  "type": "DAILY_EXERCISE",
  "date": "2026-10-21",
  "status": "PENDING",
  "started_at": null,
  "ended_at": null,
  "event_ids": [],
  "interaction_count": 0,
  "admission": {
    "decision_at": "2026-10-21T13:15:00.000Z",
    "delay_minutes": 20,
    "scheduled_start_at": "2026-10-21T13:15:00.000Z",
    "scheduled_end_at": "2026-10-21T14:15:00.000Z",
    "release_target_at": "2026-10-21T13:35:00.000Z",
    "withheld_at": "2026-10-21T13:15:00.000Z",
    "permitted_at": null,
    "window_ended_at": null,
    "observation_gap": false,
    "last_observed_at": "2026-10-21T13:15:00.000Z"
  }
}
```

`started_at` is actual first attendance, never permission or the planned opening.
`ACTIVE`/`COMPLETE` still describe actual exercise. `MISSED` means the window
closed without recorded attendance, not proof of experience during downtime.
`last_resume_at` deduplicates restart-gap annotations. Existing observation gaps
remain bounded at 20. This is additive schema-v1 state; no database migration or
historical repair is required. Legacy existing exercise episodes are not rerolled.

## Ordering, observation and restrictions

Each scheduler pass prepares admission, commits a changed decision/transition,
then reconciles location. A held decision never moves Cy. After permission,
lockdown, active-search entry restriction, an ongoing routine and effective sleep
can still prevent yard entry. A search elsewhere does not evict an already
attending Cy from the yard. The original closing time is never extended.

Fresh initialization starts in the cell, even during the window. Only the first
world reconciliation can admit Cy. Transit recovery respects the hold and records
attendance only at actual recovery, not retroactively. No-delay days keep the
normal two movement transitions and duration; exercise arrival wording makes no
additional escort/actor claim.

Private structured facts distinguish `exercise_admission_withheld`,
`exercise_admission_permitted` and `exercise_admission_missed`. Actual attendance
uses existing `location_transition` records into/out of EXERCISE_YARD, linked to
the same episode and source IDs. Only awake, observable withholding/missed-window
facts enter the public chronology. Permission is always world-only: a timer is
not evidence that Cy heard an announcement. Existing public event rows render
the new observable names in handwritten and plain reading views; no layout change.

## Durability and history delivery

The decision commits before movement. New exercise world/public events are staged
in `locationRegime.pendingExerciseEvents` and committed before network enqueue.
This small outbox is necessary to close the crash-between-state-and-publication
gap; it is not another incident/history store. Client delivery retains each
random UUID across disk-queue retry and checkpoint replay. Existing transactional
server ingest receipts deduplicate an already committed result after a lost ACK.
Delivery acknowledgement removes pending entries and requests an urgent save.
Events remain pending while the server is unreachable rather than being dropped.
Scheduler passes are single-flight across checkpoint waits.

Location reconciliation for exercise also rechecks the wall clock and effective
sleep regime AFTER the decision checkpoint. A changed minute/day, backward or
invalid clock, or changed sleep regime defers movement to the next ordinary tick
without rerolling or extending the target. Otherwise movement uses the fresh
post-checkpoint time. This prevents a pass begun before 15:15 from admitting Cy
after closing while backdating attendance to the tick-start time. Non-exercise
routine reconciliation keeps its original path. Deferral reasons are content-free
operational diagnostics, not inference requests or new admission decisions.
Admission preparation also samples a fresh clock after flushing an older pending
checkpoint, so that save cannot cause a backdated hold to be created after close.

Restart preserves decisions and targets. If the target expired during downtime,
permission is recorded only at resumption; movement starts only then, if possible.
If the window has ended, no yard visit is synthesized. A completely unobserved
window with no existing decision does not acquire a new historical story. Gaps
are explicitly recorded, and no continuous waiting/attendance duration is inferred.

## Verification and limits

Focused tests cover each delay, ordinary exercise, no rerolls, repeated ticks,
sectioned persistence, restart before/after target and after closing, late first
observation, lockdown/search/routine/sleep precedence, transit recovery, BST/GMT,
source links, no actor invention, checkpoint failure and stable delivery replay.
The full runner suite is required before handoff. Tests use disposable state and
no real provider or production state.

Verification on 21 October 2026: 55 focused checks passed; the final full runner
suite passed 555/555 with no failures, skips or cancellations. Initial sandbox
temporary-directory atomic renames failed in both the new and pre-existing
persistence test; rerunning with TEMP/TMP inside the writable workspace passed.
Syntax checks, manifest JSON parsing and `git diff --check` passed. No live
runner, browser, inference or production-state test was performed.

## Adversarial review gate

The review of candidate a9c52d6 found a material stale-clock defect. A synthetic
pass prepared at 15:14:59 BST, whose checkpoint completed at 15:15:02, still used
15:14:59 for location reconciliation and recorded an invalid late yard entry.
An effective sleep override changing during the save could likewise be missed.
The post-checkpoint guard above closes that asynchronous boundary. Eight new
deterministic regressions cover closing-time crossing, fresh attendance time,
sleep override, current restriction checking, invalid/backward clock, failed
checkpoint, unchanged non-exercise reconciliation and fresh decision time after
an older pending save. Focused checks: 63/63.
The corrected final tree also passed 563/563 full runner tests with no failures,
skips or cancellations, plus syntax, manifest JSON and whitespace checks.
No real clock, world state, exercise event or inference was manipulated.

Review disposition: correction required; remain on the feature branch. No merge,
deployment, runner restart or natural-evidence cutoff is authorized by this review.

Remaining limits: this does not model locks, staff or actual escort routes;
permission is not a promise that another restriction will clear. A downtime gap
remains unknown. Legacy completed episodes retain their original semantics.
Malformed admission timestamps fail closed for movement and need operator review,
not a silent new decision. A prolonged publication outage can grow the pending
outbox until the existing queue/receipt path recovers. These are not grounds for
reconstructing missing history or rerolling a hold.
