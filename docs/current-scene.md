# Episode-bound current scene

`runner/current-scene.js` records a narrowly authoritative encounter, not a
general NPC location map. This capability is not exposed to AWG, and does not
change cast eligibility into presence.

The isolated feature is based on deployed-production capture lineage
`85a2b7e`, not the older local `current/production-lineage` checkout. Before
changes, `runner/run.js` matched the deployed bytes (SHA-256
`475b6de2b49fd00907b44f995f0fc198c8122ca5fb795f26f6c97501c565b783`).
The location/regime, environment, social-contact and sectioned-checkpoint
modules were also checked against deployed source after normalizing CRLF/LF.
No runtime source was edited or copied back to DELL.

## Source and lifecycle

The existing yard mechanic samples an outcome every 15 minutes while Cy is in
an active exercise episode. Previously its company/conversation outcomes were
completed instantaneous social contacts: `start_at` and `end_at` were equal.
Those records cannot establish a later interval of occupancy. The 15-minute
sampling interval is not an encounter duration.

The new routine producer makes only company/conversation outcomes explicit
brief encounters:

1. `prepareYardEncounter` requires active daily exercise in the yard, with no
   active lockdown. It creates an `ONGOING`, continuously observed, in-person
   contact and a producer-owned `current_scene_source` marker.
2. `captureEpisodeEvent` assigns the canonical environment-event identity.
   `openCurrentYardScene` binds that actual event to the active exercise and
   location-entry identities. It cannot open from an old contact record,
   plausible cast membership or a relationship value.
3. The encounter completes on the next existing world tick (`config.tickMs`,
   normally 5 seconds). This is a new explicit, deliberately brief routine
   lifecycle, not an interval recovered from historical text or a recency
   threshold. No extra scheduler or model call is introduced.
4. A structured `yard_encounter_end` event closes the same social episode ID.
   The social-contact history merges the start and end into one episode rather
   than counting two encounters. Quiet and avoided-contact outcomes do not open
   a scene; existing social-contact opportunity semantics remain separate.

Routine probabilities, cast selection and 15-minute sampling stay unchanged.
The companion is introduced by the deterministic encounter outcome itself,
not inferred to have been present before it.

## Checkpoint shape

The top-level private `vitals.currentScene` capsule is checkpointed using the
existing sectioned vitals storage:

```json
{
  "schema": "cy.current-scene",
  "version": 1,
  "revision": 1,
  "active": {
    "id": "yard-episode-id",
    "revision": 1,
    "status": "ACTIVE",
    "participants": ["cy:7734", "ping"],
    "location": "EXERCISE_YARD",
    "startedAt": "2026-10-19T13:45:06.639Z",
    "completionDueAt": "2026-10-19T13:45:11.639Z",
    "locationEnteredAt": "parent-location-entry-time",
    "observation": {
      "observerId": "cy:7734",
      "channel": "IN_PERSON",
      "access": "CY_DIRECT",
      "identityBasis": "DIRECT_ROUTINE_ENCOUNTER",
      "voiceRecognition": false
    },
    "source": {
      "producer": "exercise-yard-encounter-v1",
      "startEventId": "canonical-environment-event-id",
      "parentEpisodeId": "exercise-episode-id",
      "parentStartedAt": "parent-exercise-start-time",
      "variant": "conversation",
      "completion": "NEXT_WORLD_TICK"
    },
    "endedAt": null,
    "endReason": null,
    "social": {}
  },
  "lastEnded": null
}
```

`social` contains the original structured `ONGOING` social episode, not an
additional transcript. On close, `active` becomes null and `lastEnded` retains
one bounded terminal snapshot, with incremented revision, `ENDED` or
`INTERRUPTED` status, `endedAt`, `endReason` and `detectedAt`. The end event links
the start event ID and carries the same social episode ID. This capsule is not
an unbounded scene-history store or a general world-entity revision system.

## Invalidation and freshness

`advanceCurrentYardScene` closes or interrupts the scene for:

| Reason | Boundary |
| --- | --- |
| `ENCOUNTER_COMPLETED` | Scheduled next-world-tick completion |
| `PARTICIPANT_DEPARTED` | Explicit departure of either bound participant |
| `CY_LOCATION_CHANGED` | Different location or location-entry identity |
| `REGIME_CHANGED` | Active lockdown |
| `EXERCISE_ENDED` | Exercise no longer active, daily-exercise regime ended, or parent episode identity changed |
| `OBSERVATION_LOST` | Observation no longer justified or Cy asleep |
| `RESTART_OBSERVATION_GAP` | Startup reconciliation, even if exercise itself survives restart |

The runner checks the location/regime/sleep boundaries on its existing world
tick. Explicit departure and observation-loss inputs also exist on the module
API; there is no newly invented NPC movement producer. The present encounter
has no independent companion movement before its scheduled completion.

`currentScenePresence` is the time-aware read boundary: it returns null at or
after `completionDueAt`, even if the next tick is delayed. A delayed close is
bounded to the scheduled completion, never extended to the later detection
time. Restart interrupts at the start timestamp, preserving the detection time
separately: downtime is not counted as observed contact. Restart closure still
closes factual social-contact state, but does not supply new Cy knowledge or
update other Soma consumers as an observed event.

Only the new producer marker can open a scene. Neither completed historical
contacts nor restoring a routine can reopen one. Root/Daemon and unrelated
eligible cast are not participants in this source. No voice familiarity,
routes, officer rosters, object effects or AWG affordances are added.

## Offline natural-path projections

These are counterfactual projections of the new policy from retained natural
production metadata, not production edits or measured encounter durations.

| Natural source | Before | New-policy start | Next normal tick |
| --- | --- | --- | --- |
| Ping `DIRECT_INTERACTION`, `2026-10-19T13:45:06.639Z`; social episode `yard-4aeff40f-08ef-444b-90ae-3c5789f37cef`; environment event `env-31f8f013-de81-4e4f-9e72-9530bb116cca` | Existing completed contact has zero duration and creates no current presence | If produced by the new active-routine path, bind only Cy/Ping, yard, direct in-person observation, canonical start event and parent exercise | At `13:45:11.639Z` with normal 5-second tick, clear active scene and close the same episode; an earlier invalidation would interrupt it |
| Reg `ATTEMPTED_CONTACT`, `2026-10-19T14:00:07.855Z`; social episode `yard-c3f96112-d385-4744-98b2-ee3d2c08909c`; environment event `env-4b10ae36-31a0-404c-8108-0551628117b0` | Existing completed attempted contact has zero duration | No scene: attempted/avoided contact is not the affirmative company/conversation source | No current-scene completion event |

Historical records remain unchanged. This first source supports only the short
encounter it now explicitly stages. It does not establish longer yard
co-presence, visibility of other inmates, or general NPC whereabouts.

## Offline verification

`node --test runner/*.test.js` runs the complete offline runner suite. The new
`runner/current-scene.test.js` covers source binding, quiet/avoided outcomes,
history rejection, actor/role consistency, expiry, departures, movement,
regime/observation loss, restart, real sectioned-checkpoint round trips, merged
social history, single formation admission and the two natural-path
counterfactuals above. Runtime wiring checks verify that no AWG context input
was added and that the existing yard sampling probabilities are unchanged.
