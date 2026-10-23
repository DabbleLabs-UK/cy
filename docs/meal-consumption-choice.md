# Bounded meal consumption choice (unreleased)

Base: production `68056b8`. Feature only; no production actions or real inference
were performed while building this mechanic.

## Before and after

Previously `chooseMealEvent` chose consumption and availability together:
82% eaten, 11% partial (arbitrary 0.45 fraction), 5% missed, 2% refused.
No Cy decision preceded any of those outcomes.

Now the world selects only delivery: the existing 0.93 <= roll < 0.98 missed
interval is unchanged. Other rolls establish meal availability, not intake.
Historical partial/refused records remain untouched. There is no random refusal
path and no partial-consumption menu: an arbitrary 45% is not a grounded portion
choice. A new meal offers only `eat` and `decline`.

The runner does not fabricate a cell delivery while Cy is absent/asleep or a
schedule pass has become stale across the originating regime/window. Such a
pass records unknown delivery/intake, not an institutional failure or refusal.
Restrictions can make a delivered meal non-actionable without rewriting delivery.

## Authoritative checkpoint

`vitals.mealChoice` is a version-1 `cy.meal-choice` object in the existing
sectioned checkpoint, not a new store. It contains `episodes` and `pendingEvents`.
An episode contains:

```json
{
  "id": "2026-10-23:breakfast",
  "meal": "breakfast",
  "date": "2026-10-23",
  "available": true,
  "availableAt": "2026-10-23T06:30:00.000Z",
  "expiresAt": 1792740600000,
  "fence": "opaque internal world snapshot",
  "availabilityEventId": "env-...",
  "phase": "COMMITTED",
  "offeredAt": "2026-10-23T06:30:05.000Z",
  "offeredActions": ["eat", "decline"],
  "decision": {
    "id": "random UUID",
    "mealId": "2026-10-23:breakfast",
    "action": "eat",
    "committedAt": "2026-10-23T06:30:20.000Z"
  },
  "effectEventId": "env-...",
  "failure": null
}
```

Lifecycle: AVAILABLE -> OFFERED -> COMMITTED -> APPLIED. UNAVAILABLE and
NO_DECISION are terminal alternatives. Offer and commit each have a checkpoint
barrier. Application is synchronous and updates the existing Soma intake path,
episode receipt and identified event outbox in one subsequent checkpoint.
The effect time is the current, post-checkpoint time at the final live check.

The permission fence binds day, actual cell entry/source, regime, search and
lockdown identity/status and owner day/night override. Permission ends at the
next existing schedule boundary or an intervening regime/location/sleep or
restriction change. Expiry means permission to apply this result ended; it does
not invent food removal or establish zero intake. The entire transaction owns
the visible cancellation scope, including commit IO. In-session regime changes
are also fenced by the existing epoch, even if the override changes back.

All current-day receipts, unresolved work and the newest 56 older terminal
receipts remain. Identified pending deliveries remain until acknowledged.

## Model boundary and failure policy

One structured call at most, through the existing active character provider,
static waking sampler, shared arbiter and cancellation/admission path. Only the
new short decision response has an 80-token bound; journals retain 93 tokens.
The call receives meal type/availability (not invented ingredients), current
location/regime and existing supported plain-language bodily indications.
No backend meal/decision/source IDs, raw numeric Soma or memory transcript is
sent. Its complete response schema/property order is:

```json
{
  "type": "object",
  "properties": {"action": {"type": "string", "enum": ["eat", "decline"]}},
  "required": ["action"],
  "additionalProperties": false
}
```

No prose execution, explanation, second narrative call, repair or retry.
Malformed/extra fields, unavailable provider, empty output, cancellation or
staleness produce NO_DECISION. Delivered food remains delivered; canonical
consumption/portion/energy are UNKNOWN, never zero/refused/missed by fallback.
This honestly makes feeding/fullness input incomplete where consumption was not
established; no artificial satiety recovery is added. Only a real decline yields
the existing REFUSED zero-intake category, with persisted choice provenance and
no invented motive.

The existing 600,000-ms foreground ceiling also bounds the whole meal request,
including Tempo/coordinator/arbiter waits. Lease release has a meal-only 5,000-ms
cleanup ceiling, using an optional timeout on the existing client. The prose
watchdog cannot reset journal context because a structured meal call is silent.
Inbox and owner/maintenance admission remain ahead of meals; meals do not wait
for journal cadence. Existing Tempo pacing, model/provider configuration and
all other generation allowances are unchanged.

## Intake, restart and publication

Availability is an ambient structured fact (`world.meal_availability`), not an
UNKNOWN ingestion observation. This avoids poisoning the unchanged physiology
before a valid decision arrives. Expectation remains the existing MEAL_EXPECTED
record. Only the terminal effect enters existing feeding/satiety machinery.
Eating uses full/full_consumed/full/1; declining uses none/refused/none/0.
The existing ingestion event-ID deduplicator remains a second safety layer.

Restart never sends an AVAILABLE/OFFERED job again. Only a COMMITTED decision
may recover, still subject to current permission and exact meal identity.
Expired/uncommitted work becomes unknown, with a restart reason. APPLIED work
never executes twice. No intake or attendance is backdated into downtime.

The checkpointed outbox retains UUID ingest receipts across process restart,
disk queue replay and lost HTTP acknowledgements. Flush snapshots its candidates
before awaiting disk IO, so a concurrent newer effect cannot overtake its own
checkpoint. Source-linked memory formation admission/retrieval cues occur only
after this barrier, through the existing canonical path. No memory policy changes.

Private `meal_choice` inference diagnostics distinguish availability, offer and
offered actions, valid returned result, committed decision, effect, no valid
decision/reason, restart recovery and duplicate prevention. They contain IDs and
action enums, not private prompt text or model reasoning. The existing inference
records separately retain wait/provider/abort details.

Public chronology adds only available/unknown meal labels. Existing consumed,
partial, missed and refused labels remain valid. Startup satiety history includes
unknown terminal meals so missing intake cannot disappear during recovery. The
lunch regime note no longer asserts that Cy was already fed regardless of choice.

## Verification and limitations

Focused tests cover exact menus, delivery RNG separation, real intake equality,
decline versus unavailable/unknown, invalid/stale/cancelled output, commit IO races,
single offers, cross-meal replay, outbox snapshot races/receipts, the real Client,
and real sectioned-checkpoint recovery before/after effect application.
Unrelated exercise, journal, postcard, object and social paths remain covered by
the full runner suite.

Verified on Windows/Node 22.14.0: 62/62 focused tests; 655/655 full runner
tests across 133 root test files. Disposable mock HTTP fixtures only; no model
requests. JavaScript syntax, PHP endpoint lint, manifest JSON parsing and
`git diff --check` passed. Independent adversarial review identified outbox,
watchdog, timing/cancellation and lease-release races; those were corrected
before the final complete run.

This proves lifecycle mechanics, not real-model appetite or decision quality.
There is no inference rehearsal yet. A valid model choice is enacted as a bounded
world action, not a scientifically calibrated preference. Unknown intake can
persist after model failure or downtime; that is intentional rather than a
fabricated meal. Availability lifetime is deliberately conservative and does not
model leftovers, storage, later snacking, preparation or external reactions.
No deployment is authorised by this implementation.
