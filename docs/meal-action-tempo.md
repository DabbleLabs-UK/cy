# Bounded meal action selection and Tempo

## Verdict: B - generic pacing is overbroad here

Authority: production `61f3cd0a4c97a24a44740c6e735e2e19f5eb342b`.
This is an undeployed correction, not a new model experiment. No production
meal, inference, replay, restart or state mutation was performed.

Tempo is deliberate silence around inference/expression, not token-rate control
or a measurement of CPU load. The original duty equation is
`idle = busy * (100 / speed - 1)`. Background work retains this equation. Waking
expression instead has a bounded rest and a persisted opportunity clock. At
speed 5, waking rest is capped at 450 seconds and the nominal autonomous waking
opportunity interval is 1,800 seconds. These are pacing controls, not a promise
of publication or literal 5% hardware utilization.

The per-request pacer remembers the most recent completed inference, including
background work and aborted calls. Elapsed quiet pays down that debt. Both raw
and streaming transports check pacing before acquiring the local coordinator
and again before acquiring the shared-model lease, so another call cannot make
a waiting request evade newly established quiet. Resource serialization itself
is supplied by the coordinator and shared arbiter, independently of Tempo.

Existing postcard and warden purposes already bypass this deliberate quiet for
responsiveness, while preserving admission/cancellation. A successful expressive
chooser and its immediately paired journal share one visible pacing cycle.
Other journals/drawings/expressive choices use bounded waking pacing; other
generic purposes use the uncapped equation unless their caller explicitly owns
an existing scheduling exemption, such as AWG's reserved idle opportunity.

The meal chooser is a bounded causal action, not a choice of expressive form.
There is no authoritative world mechanic saying Cy must deliberate for minutes
after food becomes available. Its initial commit `5087e53` reused `rawGenerate`
without a purpose-specific Tempo exemption; documentation preserved existing
Tempo globally. That establishes inherited request policy, not evidence of an
intentional meal-deliberation rule. Because `meal_choice` is not one of the three
waking purposes, it inherited the stricter uncapped duty equation.

## What actually happened at tea

All human times below are 24 October 2026 BST.

- Meal availability: 16:45:03.101.
- Offer receipt: 16:51:50.396; offer checkpoint completed 16:51:54.083.
- Preceding memory call ran 16:49:50.217-16:51:50.250, 120,033 ms, and aborted.
- The pacer charged `120033 * 19 - 3833 = 2276794 ms`: 37m 56.794s of remaining
  quiet at the meal request's queue time. This exactly matches retained
  `inter-request-tempo` telemetry.
- 185.306 seconds is only the observed/cancelled prefix of that wait, NOT the
  intended delay. Wing noise cancelled it at 16:54:59.389 before model startup.
- Coordinator and arbiter waits were zero. No request reached the model.

With the same debt and unchanged speed, no other pacer updates, and even no
noise, intended Tempo clearance would have been about 17:29:50.877. The meal
transaction's existing 600-second ceiling would expire much earlier. Thus this
was not merely a 185-second piece of human-like deliberation followed by bad luck.
The correction does not remove the earlier wait for admitted foreground work,
the offer checkpoint, infrastructure contention or the model's own latency.

## Offline reachability evidence and limits

`rehearsal/meal-action-tempo-20261024/retained-timing.json` contains content-free
natural timings from the initial meal rollout cutoff through 17:13:26.307 BST on
24 October. Verified restart boundaries reset the pacer. The accompanying
`replay.mjs` uses the unchanged production Tempo formula, not a character-count
estimate or random simulation. All recorded Tempo settings in the inspected
period were 5.

At 45 actual journal/drawing/expressive-choice/meal request-queue instants, ask
the counterfactual timing-only question: what generic meal debt would the latest
completed request impose at speed 5?

- 3 instants have zero debt.
- 36/45 (80%) exceed the entire 600-second meal budget on pacing alone.
- Median debt: 1,098,729 ms (18m 18.729s); maximum: 3,777,246 ms (62m 57.246s).
- Of 41 completely observed projected wait windows, 25 contain no recorded
  mid-generation wing-noise event. Four windows extend beyond observation.
- Only 7/45 fit the pre-model ceiling and avoid those observed noise timestamps.

These are NOT 45 meal opportunities and NOT a predicted 7/45 success rate.
Location, sleep, search, regime, inference duration and shared-resource waits
are omitted; recorded noise-mid flags depend on historical execution. Future
background calls could change pacing debt. The window is selected by actual
request timing rather than randomized exposure. Those limits prevent a genuine
meal survival-rate estimate. Actual admitted post-fix meal evidence is still
one offer, cancelled before inference. The replay establishes unnecessary
practical fragility, not certainty that the fix will produce natural success.

Run offline: `node docs/rehearsal/meal-action-tempo-20261024/replay.mjs`.

## Small correction and safety boundary

Extend the EXISTING central `waitForInferenceTempo` purpose exemption from
postcard/warden to `meal_choice`. Do not add a new action framework or an
arbitrary delay. This exempts only deliberate pre-model quiet, not coordination,
priority, shared-profile enforcement, cancellation, liveness or validation.

The meal transaction still owns the visible cancellation controller and its
600-second end-to-end ceiling. Wing noise may still cancel it while it waits for
the coordinator/arbiter or while inference runs. Search, sleep, location, meal
expiry/availability, admission and lockdown-transition fencing are unchanged.
Decision checkpoints still precede canonical consequences; no repair/retry or
reopening of terminal meals is introduced. The completed action call still
records pacing debt for subsequent prose. Journals, drawings, expressive choices,
background pacing, model, prompts and sampler are unchanged.

## Regression boundary

`causal-action-tempo.test.js` executes the actual production pacing/raw-generation
function bodies in an isolated VM with a fake clock and mock provider. It uses
the real coordinator, cancellation registry, meal transaction, timeout wrapper
and canonical Soma feeding path; it cannot reach a real server/model.

Coverage includes substantial pre-existing pacing debt, retained journal/drawing
and generic waits, interactive coordinator ownership, shared-model acquisition
and execution profile, cancellation in both resource queues, world/lockdown
changes during inference, invalid actions, UNKNOWN intake, commit-before-effect,
recovery/no replay and continued pacing of subsequent expressive requests.

## Validation and handoff

- 15 new focused cases pass. Final combined focused suite, including real
  disposable sectioned-checkpoint recovery: 100/100 pass.
- Full runner suite: 698/698 pass across 135 root test files, concurrency 2,
  no failures, skips or cancellations; duration 83.595 seconds, not a benchmark.
- Runtime/test/replay JavaScript syntax, manifest/fixture JSON parsing,
  offline timing replay assertions and `git diff --check` pass.
- The real checkpoint/full suite ran outside the Windows sandbox's known atomic
  rename restriction. No live model, public event or production fixture was used.

Local test logs are retained at
`C:\Users\jodyf\Documents\Codex\2026-09-03\som\cy-causal-action-tempo-evidence-20261024`.
SHA-256:

- `focused-tests.log`:
  `0f5314960247a470ee731174a1639be85b26319b5162e6983d267dd8e734eb7a`
- `full-runner-tests.log`:
  `c8abef136425036927ddd84b254626c7e85d80d12914ce01770b3cbc54a3f6b4`

The only runtime change is the existing central purpose gate in `runner/run.js`.
There is no new persistent subsystem, payload, recipient, retention policy,
provider call, action category framework or public control. No data-handling
manifest/schema change is needed. The background Tempo gate and exported Tempo
equations are unchanged. Await separate merge/deployment authorization; do not
replay historical meals or generate synthetic evidence after rollout.
