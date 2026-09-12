# Shared context broker and ambient prison world generator

## Boundary

"The ambient world generator is a narrative world-simulation mechanism, not a cognitive model of Cy. It produces structured candidate events which are validated before becoming world state. Cy's cognition receives those events only through the same observation, Soma and memory pathways as other experiences."

"The context broker controls which information is available to each model-mediated process. It is an engineering analogue of a limited working set, not a claim to reproduce biological conscious access."

No number introduced here is a psychological coefficient. Context limits, pacing, scheduling, validation, storage and display limits are engineering policy.

## Architecture and authoritative files

The data flow is:

```text
source stores
  -> context broker
  -> role-specific structured packet
  -> final model-facing rendering
  -> model job
  -> structured AWG candidate
  -> deterministic validation
  -> authoritative environment event
  -> existing Soma, memory and public-timeline routes
```

- `runner/context-broker.js`: context item schema, epistemic and knowledge labels, privacy policy, per-consumer budgets, source-ID deduplication, selection, omission reasons, rendering and inspection.
- `runner/ambient-world-generator.js`: candidate schema, prompt, parser, deterministic validator, pacing, thread/object state and conversion to the normal environment input.
- `runner/run.js`: source adapters, critical-path fallback, private inspection emission, idle scheduling and accepted-event routing.
- `runner/memory-runtime.js`: brokered supporting context for formation and surfacing. Server retrieval still supplies its already privacy-filtered candidate rows; the broker applies sender scope again before model access.
- `runner/environment-schema.js`: neutral `ambient_world_event` archetype. It contains no emotional or appraisal assignment.
- `lib/world_simulation.php` and `public/api/ingest.php`: validation and private persistence of inspection, run, thread and object records.
- `public/api/world-inspection.php`, `public/world-inspection.js` and `public/world-inspection.css`: admin-only, on-demand inspection of the last 60 generations and current AWG state. Ordinary visitors neither load the inspector assets nor receive the endpoint data.
- `sql/016_context_broker_awg.sql`: private observability and world-continuity tables.
- `config/implementation-registry.json`: truthful implementation status.

The runner's existing persisted `vitals.worldSimulation` is the live runner authority for scheduling and continuity. SQL `world_threads` and `world_objects` are private inspectable mirrors written only after accepted changes. Existing environment records remain the authoritative immutable event history.

## Context packet

A context packet remains structured through access control, deduplication and budget selection. A representative internal shape is:

```json
{
  "schema": "cy.shared-context-packet",
  "version": 1,
  "consumer": "CY_PROSE",
  "generatedAt": "2026-09-12T12:00:00.000Z",
  "generationRef": "journal-prose:example",
  "budget": {
    "classification": "ENGINEERING CONTEXT POLICY",
    "totalChars": 7200,
    "sections": { "mandatory_current_state": 2200, "grounded_soma": 1800 }
  },
  "availableSourceStores": ["world_canon", "current_world_state", "recent_world_history"],
  "sections": [{
    "id": "recent_events",
    "provenanceClasses": ["OBSERVED BY CY"],
    "visibility": ["CY_OBSERVED", "INTERNAL_ONLY"],
    "items": []
  }],
  "omitted": [],
  "metrics": {}
}
```

The AWG packet uses the same structure but admits only world-level material. Its selected sections are world canon, current regime, known cast, unresolved world threads, persistent objects and bounded world history. Stable thread, event and object references remain in world content because causal continuations need them. Internal broker IDs, sender IDs and admin metadata are not rendered.

Epistemic labels are `WORLD FACT`, `OBSERVED BY CY`, `MODEL ESTIMATE`, `LEARNED STATISTICAL EXPECTATION`, `SUBJECTIVE MEMORY`, `SUBJECTIVE BELIEF`, `PUBLIC VISITOR MATERIAL`, `SCHEDULE ASSUMPTION`, `UNKNOWN` and `NOT MODELLED`. Knowledge scopes are `WORLD_KNOWS`, `CY_OBSERVED`, `CY_BELIEVES`, `CAST_MEMBER_KNOWS` and `UNKNOWN_TO_CY`.

Privacy is checked before prompt assembly. `CY_PROSE`, `MEMORY_FORMATION`, `MEMORY_SURFACING` and `EXPRESSIVE_CHOICE` can use internal, public-recallable and correctly matched sender-recallable material within their knowledge rules. AWG accepts only `WORLD_SIMULATION` or public-recallable world material, and rejects subjective memory/belief. A sender-recallable item is omitted unless its opaque sender ID exactly matches the current sender. Omitted records retain inspectable reasons such as `PRIVACY_SCOPE`, `SENDER_SCOPE_MISMATCH`, `KNOWLEDGE_BOUNDARY`, `DUPLICATE_SOURCE` or a budget reason.

If the broker fails for AWG, the cycle is skipped. If it fails for critical Cy prose, the existing minimal grounded prompt path remains available and an error is logged. Inspection failure cannot modify world or memory state.

## AWG candidate and world continuity

One model call returns one JSON object with decision `EVENT`, `CONTINUATION` or `NO_EVENT`. The event form contains:

- schema/version, family, known participant IDs, known location and ISO occurrence time;
- an objective event type and objective summary;
- stable object/message IDs plus owner, holder, location and status;
- explicit observer IDs, access mode and observer-limited summaries;
- separately labelled information claims and truth status;
- resolution flag;
- optional thread open/update/resolve operation;
- source thread/event IDs for continuations;
- a public-timeline trace which is eligible only when Cy observed the event.

Implemented families are `MESSAGE_PASSING`, `OVERHEARD_ACTIVITY`, `SOCIAL_REQUEST`, `RUMOUR`, `OBJECT_TRANSFER`, `OFFICER_ACTIVITY`, `WING_ACTIVITY` and `MISTAKEN_DELIVERY`. The canonical terms are NOTE and MESSAGE. New named cast generation is disabled.

An open thread stores a stable ID, type, creation/update times, participants, state, objective summary, source event IDs, optional next eligible development, optional resolution and observation-based visibility. An object stores stable ID, type, owner, holder, location, status, visibility, source event and update time. The validator rejects a confiscated object being made active and rejects continuation references absent from retained causal history.

Validation covers schema, known cast, known location, chronology, observability, rumour claim truth status, thread and source-event references, object state, duplicate summaries, pacing, public observability, private visitor leakage, emotional/Soma/brain assignments and attempts to rewrite history. Example rejections include `UNKNOWN_CAST_ID`, `INVALID_THREAD_REFERENCE`, `PRIVATE_VISITOR_LEAKAGE`, `FORBIDDEN_MODEL_OUTPUT`, `OBJECT_STATE_CONTRADICTION`, `DUPLICATE_EVENT` and `PUBLIC_TIMELINE_KNOWLEDGE_LEAK`.

A world-only accepted event updates only world continuity and private environment history. It is not put in Cy's prompt or public timeline. A Cy-observed accepted event is converted to the neutral environment archetype and sent through the same capture path as other observations. That path can feed existing threat, defensive context, social, opportunity, autobiographical-memory source and prose mechanisms. AWG never writes an autobiographical memory or an emotion value directly.

The deterministic note fixture demonstrates: Reg hides a stable note intended for Daemon outside Cy's view; a thread remains open; later context contains the real thread/event IDs; Cy finds the note; the continuation updates the thread; a normal environment record and provenance-bearing memory source can then be created; no anxiety, appraisal or other emotion assignment exists in either candidate.

## Scheduling and failure behavior

AWG runs only inside an explicitly marked normal waking idle interval. Pending postcards/notices, pause state, active inference or memory-formation backlog suppress it. Visitor replies, outward generation, critical surfacing and formation are ranked above AWG. An arriving postcard aborts an active local AWG call through the existing generation abort path. The AWG timeout is also capped to the actual idle interval so normal generation is not delayed past that interval.

An unavailable provider, timeout, bad body, invalid JSON or rejected candidate produces no world event and cannot stop Cy. `NO_EVENT` updates only run/scheduling diagnostics, not threads, objects or accepted history. Quiet is a valid outcome.

## Performance measurements

On the development machine on 2026-09-12, `scripts/benchmark-context-awg.mjs` ran 2,000 representative iterations per packet type:

- CY_PROSE: 0.051 ms average, 0.096 ms p95, 2,185 rendered characters, 11 selected, 13 omitted, 4 deduplicated.
- AWG: 0.040 ms average, 0.061 ms p95, 2,499 rendered characters, 13 selected, 11 omitted, 4 deduplicated.
- deterministic candidate validation: 0.038 ms average, 0.057 ms p95.
- database queries during those pure assembly benchmarks: 0. Live memory packets report one server retrieval query; other source adapters use in-memory runner state.

The configured production model was not present on this workstation. A cold call using the available same-size `llama3.1:8b` stand-in and the real AWG settings reached the 120,000 ms safety timeout and was aborted at 120,023 ms. This is not represented as production latency. It is a pre-deployment load warning: the actual provider/model latency must be read from `ambient_world_runs` during controlled deployment verification. No runner or production state was started for the benchmark.

Expected production work is at most one low-priority model opportunity per 45 minutes, further reduced by priority/backlog/idle checks and `NO_EVENT`. Each eligible cycle adds one bounded inference, one context inspection record and one AWG run record; accepted state changes add one private environment record and only changed thread/object mirrors. The public feed gets a row only for a Cy-observed event marked public-eligible.

## Complete numerical inventory

All limits below are newly introduced by this handoff.

### ENGINEERING CONTEXT POLICY

- CY_PROSE total 7,200 characters: mandatory current state 2,200; grounded Soma 1,800; unresolved threads 900; retrieved history 900; recent events 900; autobiographical memory 900; visitor context 600; recent expression 700.
- AWG total 7,600 characters: mandatory current state 1,800; world canon 1,500; unresolved threads 1,800; retrieved history 900; recent events 1,200; cast context 1,000; persistent objects 800.
- MEMORY_FORMATION total 5,200 characters: mandatory current state 900; provenance source 1,600; grounded Soma 1,100; autobiographical memory 1,600.
- MEMORY_SURFACING total 4,800 characters: mandatory current state 900; current situation 1,200; grounded Soma 900; visitor context 500; autobiographical memory 1,600.
- EXPRESSIVE_CHOICE total 3,200 characters: mandatory current state 900; grounded Soma 1,100; recent events 600; autobiographical memory 600; action options 500.
- Context packet schema version 1; default item priority 50; stable internal IDs capped at 160 characters; recent prose adapter capped at 640 content characters so label overhead stays within its 700-character section.
- Source adapters cap current postcard text at 600, objective/thread/observation/claim summaries at 800, event/object/thread types at 80 and generated model input rendering at 12,000 characters. Candidate parsing caps raw output at 30,000 characters.
- Admin generation inspection retains/selects the latest 60 rows; current UI queries show at most 20 open thread mirrors and 30 object mirrors.

### ENGINEERING WORLD PACING

- Candidate/state schema versions 1.
- Opportunity cadence 45 minutes; minimum accepted-event spacing 30 minutes.
- Sliding event window 6 hours; maximum 4 accepted AWG events in that window.
- Maximum 8 open threads; persisted state retains up to 24 total recent thread records so resolved continuity is not immediately lost.
- Duplicate-summary window 24 hours.
- Recent accepted world-event context/state limit 12; recent AWG run state limit 20; persistent object state limit 100; AWG prompt adapter considers the latest 20 objects.
- Candidate occurrence time may be at most 5 minutes in the future and 24 hours in the past.

### ENGINEERING INFERENCE SCHEDULING

- Priority values: visitor reply 1; Cy outward generation 2; critical memory surfacing 3; memory formation 4; AWG background 5. Lower numbers run first.
- Minimum declared idle interval 60,000 ms.
- Hard AWG timeout 120,000 ms, additionally capped to the available idle interval.
- Retry limit 0.
- Model settings: temperature 0.65; top-p 0.9; repeat penalty 1.1; repeat-last-n 128; maximum prediction 420 tokens.

### DISPLAY

- Inspector JSON/rendering panels cap displayed scroll height at 280 CSS pixels. This changes only presentation.

### TEST FIXTURE

- Deterministic time is 2026-09-12 12:00:00 UTC; continuation advances by the 45-minute policy cadence.
- Duplicate fixture advances 31 minutes so it clears 30-minute spacing but remains inside the 24-hour duplicate window.
- Performance fixture runs 2,000 iterations, builds 24 source items with 20 unique source IDs, uses 120 filler characters per item and reports p95.

## Implementation status

- Shared context broker: IMPLEMENTED.
- Role-specific context packets: IMPLEMENTED.
- AWG candidate generator: IMPLEMENTED.
- AWG deterministic world validator: IMPLEMENTED.
- Open world threads and minimal objects: IMPLEMENTED.
- AWG idle scheduler: IMPLEMENTED.
- Biological global workspace: NOT MODELLED.
- Biological attention: NOT MODELLED.
- World-actor theory of mind: NOT MODELLED.
- New cast generation: NOT MODELLED / disabled.

Migration 016 is required before any runner containing this change is started. This branch must not be deployed during the initial autobiographical-memory trial; deployment requires a separate explicit approval.
