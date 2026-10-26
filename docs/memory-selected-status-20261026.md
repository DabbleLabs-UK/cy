# Selected autobiographical-memory status preservation

Source-only repair, based on production
`a8d4d0ea0cbbb35f399536bed8f1fb2cfbe3ad51`.
No deployment, merge, restart, production inspection/mutation or real inference
is part of this task. Fixtures are deterministic synthetic data using current
production-compatible code and schemas.

## Exact data path and defect

| Boundary | Status behavior |
| --- | --- |
| Canonical autobiographical_memories row | Owns status; retrieval SQL/visibility admit ACTIVE only |
| PHP captive_memory_candidate_items | Copies row status into the candidate response |
| Client queryMemories | Parses JSON without removing status |
| buildSurfacingRequest | Filters ACTIVE/privacy eligibility, offers temporary C references; model prompt deliberately omits status and database IDs |
| Parsed selection | Resolves only offered C references to original candidate IDs |
| processSurfacing selected projection | Calls filterMemoriesBeforePrompt on original eligible candidates, then resolves selected IDs |
| Old filterMemoriesBeforePrompt | Requires exact ACTIVE but omits status in its returned object |
| complete_surfacing / prepared_get | Preserve selected_memories fields as JSON; do not remove or fabricate status |
| activatePrepared | Applies the unchanged visibility filter again; old projection fails because undefined is not ACTIVE |
| Journal context | consumeWorking -> actual buildCtx/brokerItems/buildBrokerContext -> subjective recollection -> journal directives/prompt |

The loss also occurs in the immediate in-memory activation path; serialization
is not required to reproduce it. A legitimately selected ACTIVE memory can be
prepared and logged as selected while the activated selection is empty.

## Smallest repair and safety boundary

Only runtime change, in `runner/autobiographical-memory.js`:

```js
status: memory.status, // Preserve eligibility metadata for later re-filtering.
```

This is inside the existing projection, after the existing exact ACTIVE/privacy
filter. It copies the already-authoritative candidate value, not a constant,
fallback or inference. No security reason for omitting this operational metadata
was found: the authenticated canonical candidate API already returns status, and
the dedicated prompt projections independently omit it.

`memoryVisibleTo` and activation are unchanged. ARCHIVED, DELETED, SUPERSEDED,
unknown, lowercase, empty, null and absent status all remain rejected. Unknown
privacy scope and sender-only cross-sender/no-sender access remain rejected.
Public cross-correspondent material still uses its existing public summary.
Consistency/origin and subjective-memory provenance remain unchanged; recall
never becomes world evidence. All projected fields except status are identical
to the old projection. Both selection and formation requests remain byte-identical.

No API/server/client changes are needed: their JSON round trip already preserves
the selected record. No new model-controlled field is introduced.

## Consumers and unchanged boundaries

The projector is shared, not journal-only. Restoring idempotence fixes optional
prepared-memory activation wherever this runtime is consumed, including journal
context and existing waking/drawing/dream consumers. It does not broaden their
availability, types, ranking, number, privacy policy or prompt representation.

Mandatory postcard continuity and direct indexed associative recall also use the
projector; they retain the extra internal metadata, but their explicit renderers
do not expose it or change text. The old `loadPostcardEnrichment` helper separately
stamps ACTIVE in its legacy snapshot path. Production postcard replies now use
direct indexed associative recall rather than that helper. The legacy helper is
unchanged and is not a new safety behavior introduced by this repair.

Queue-liveness/supersession, compatible fingerprints, in-flight fencing, current
desired context, nonblocking journal construction, prepared TTL, formation,
canonical contents, prompts, cadence, token limits and repeat/finalization rules
are byte-unchanged. Tests explicitly pin these runtime files and verify the only
change in the projection module is the status line.

This copies status as retrieved/prepared, not a new live database revalidation
at consumption time. The existing cache/freshness contract is unchanged. Old
prepared sets whose JSON lacks status remain rejected until normally replaced
or expired; no backfill or historical rewrite is performed. Preparation timing
and successful natural journal enrichment remain unproven by this offline fix.

## Deterministic evidence

- Pinned production projection reproduces one selected record -> zero activated
  records. The fixed projection changes no other field and activates that record.
- JSON serialization and repeated projection preserve ACTIVE without a default;
  all tested non-ACTIVE/missing variants still activate zero records.
- A fake bounded selection runs query -> selection -> completion -> activation.
  The actual unchanged runner context builders and real journal prompt renderer
  receive exactly one recollection with its original content and subjective
  provenance, not world evidence or a technical status label.
- A cached current prepared set follows the unchanged get/activate/consume path.
  A late cached response for an older fingerprint cannot replace the new context.
- Empty model selection and genuine no-candidates results remain empty.
- Real isolated PHP/MariaDB coverage follows stored ACTIVE row -> query API ->
  projection -> complete/prepared JSON/DB round trip -> activation -> actual
  journal context -> consumed receipt, with no model/provider call.
- Existing liveness tests retain 215-obsolete-job zero-retrieval controls,
  in-flight supersession and restart behavior. Their historical defect test now
  imports the pinned old projector as well as old runtime, instead of accidentally
  testing old runtime against the newly fixed projector.

Only the runtime module, matching data-handling metadata, tests/fixture and this
document are changed. No production action is authorized by this implementation.

## Validation and independent review

- Focused selected-status, queue-liveness, memory-runtime and autobiographical
  suites: 73/73 passed, no skipped tests (30.597 seconds).
- Full serial runner suite: 891/891 passed, no failures or skipped tests
  (409.365 seconds). The existing reliable owned TEMP/TMP test configuration
  was used; no production runner was started.
- PHP journal queue-liveness: 15 checks passed. All eight existing PHP memory
  test scripts passed, covering canonical eligibility/privacy, origin, retention,
  tags, generic formation, sender formation/delivery and associative retrieval.
- Four isolated PHP/MariaDB integration suites passed (163.501 seconds): journal
  liveness/status round trip, formation delivery, formation inference accounting,
  and associative recall. Model/provider adapters are fixtures, not real calls.
  The owned temporary database process was confirmed stopped after the run.
- Syntax checks passed for every changed/new JavaScript test/runtime fixture;
  all 100 tracked JSON files parsed; whitespace checks passed.
- Independent read-only review found no material issue, including the final
  tests, data-handling metadata and documented limits.

Ready for a separate rollout review. This establishes deterministic metadata
preservation and journal-context reachability, not natural retrieval readiness,
preparation timing or successful production journal enrichment.
