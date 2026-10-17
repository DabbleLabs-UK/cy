# Reduced semantic-core AWG proposer

REHEARSAL ONLY. No production wiring, transport, inference, publication, deployment,
merge or restart. Based on corrected one-call commit
`c3b2b1c9267666e908f11b3f5a6dd49adefec82d`.
Branch: `feature/awg-reduced-semantic-core-20261017`.

## Exact contract

Property order is exactly:

```text
roles -> occurrence -> accessFrameId -> effectChoiceId
roles[].entityId -> roles[].role
```

`semantic-core-schema.json` is the exact frozen-capture JSON schema, not a sketch.
All fields are required; additional fields and a different top-level order fail.

- `roles`: 1-6 distinct semantic entities, selected once. Entity IDs come from the
  supplied eligible cast/usable objects/continuable threads, plus `UNIDENTIFIED`.
  Roles are ACTOR, ADDRESSEE, TARGET, MENTIONED_ONLY. Mentioned people do not become
  physically present participants. Unknown audible sources create no world entity.
- `occurrence`: one concrete account, 1-300 characters. No second observation
  account, event-family choice, generated provenance IDs or presence array.
- `accessFrameId`: one mechanically available geometry/knowledge permission:
  CURRENT_DIRECT, ADJACENT_UNIDENTIFIED, ADJACENT_SELF_IDENTIFIED, WORLD_CURRENT.
  These are access constraints, not incident candidates or an action menu.
- `effectChoiceId`: null or a supplied legal operation choice. For this frozen
  capture the enum is exactly `[null]`: no usable object or continuable thread.

Code reconstructs canonical participants (including known Cy observer), observer,
access, origin, presence, current-state/entity/channel/origin/episode references,
typed effects, technical event code, and downstream classification. The model
cannot fail by omitting any of these mechanically generated fields.

## Safety boundary

The packet still comes from the original production-faithful frozen capture.
Actor eligibility is not presence. Named direct participants require actual live
episode support or a permitted new arrival. A staff approach can establish new
presence; it does not require a fictional prior presence record. Inmate cell entry
and unsupported inmate routes remain rejected. This does not assert where all
NPCs actually are; their location is not known from this packet.

Adjacent hearing keeps Cy in cell. An unidentified sound stays unidentified.
Named audible participation requires an explicit new self-name or introduction;
merely attributing a voice, recognising a familiar name, or citing a roster entry
is not voice-familiarity evidence. A called/quoted name is not a speaker ID.

All declared active roles must be realised. Known/unknown people, movable property,
unavailable operations, hidden effects, conflicting access, movement, and prose
that disagrees with semantic IDs fail closed. Ordinary fixed surroundings, bodily
activity and anonymous sounds remain possible without durable consequences.

Historical replay is not a new occurrence. Historical assertions are accepted only
when an exact supplied fact is quoted with explicit past scope and appropriate
knowledge visibility. Uncertain paraphrases/backstory fail closed. No arbitrary
old source ID is attached to make a new claim look evidenced. The matcher is
deliberately bounded and conservative, not a general natural-language truth oracle.

The unchanged production materialiser and validator are still exercised after the
new checks. Original legacy results are retained. Two narrow rehearsal exceptions
are explicit in telemetry, never hidden repairs:

1. CELL_LANDING_PARTIAL_HEARING: the previous precisely scoped adjacent-hearing
   exception for OBJECTIVE_LOCATION_CONTRADICTION.
2. EXPLICIT_MENTION_IS_NOT_PRESENCE: NAMED_CAST_NOT_PARTICIPANT only after every
   non-participant cast mention is verified as MENTIONED_ONLY and quoted/topic-only.
   A person actually acting/speaking cannot use this exception. This is needed for
   an unidentified voice calling a name, which the old validator cannot encode.

No text is stripped, rewritten, reordered or repaired for acceptance. Family is
derived after semantics (heard activity, officer activity, generic wing activity,
or the actual object/thread operation); neutral family-independent physical checks
still run. Drought does not change the request or require durability.

## Token budget and verified package

```text
C:/Users/jodyf/Documents/Codex/2026-09-03/som/awg-semantic-core-preparation-20261017-ready
```

| Complete token accounting | Corrected previous proposer | Semantic core |
|---|---:|---:|
| Input including system/template/BOS | 2129 | 2251 |
| Context | 3072 | 3072 |
| Maximum output | 420 | 420 |
| Terminal reserve | 1 | 1 |
| Spare after full output | 522 | 400 |

The input grows by 122 tokens because access permissions are explicit input data.
This is an output-contract reduction, not an input-grounding deletion. All original
grounding facts remain in the lossless compact packet. No model, sampler, template,
context, stop list, output allowance or timeout change was made.

Exact wire SHA-256:
`8c91004e56712bc5308c40102f096be039b76b60cea643d347aee9fde532596a`.

The same pinned GGUF tokenizer/template guard runs before each provider callback.
Missing/mismatched/overflowing receipts make zero calls. The wire always includes
`stream:false`, `keep_alive:"5m"`, `truncate:false`. The 420000ms deadline starts
after successful preflight. Invalid/timeout/cancelled/stale results have no repair,
replacement, state application or publication path. This module has no transport.

Package files include full packet, request, exact wire, exact schema/property order,
old/new token receipts, source-file hashes, trace, verified capture provenance,
nine-output replay, original-evidence hashes, and SHA256SUMS.txt.

## Strict offline replay of the nine saved outputs

The original 95-file evidence manifest was verified:
`c63735ac802fa080eb9d723cdb4f967f0b72daf8b76d13de69f73b1a1005428c`.
The original capture/evidence was not modified. The committed regression fixture
contains only the nine retained public prison-world proposals and their provenance
hashes, not private correspondence or a new memory store.

Every row enters reconstruction/checking. Cy-observer copies and prerequisite refs
are derived; legacy actor IDs are not silently replaced by names from prose. An
old hearing/current-cell tuple cannot be guessed into an adjacent-landing frame.
Both original occurrence and observation prose are preserved and checked as
constraints. They are not concatenated into newly authored output or discarded.

| Request | New reason / phase |
|---|---|
| 2 | Projection: Bill presence/target conflicts with declared Cy/Root |
| 3 | Projection: Bill presence conflicts with declared Cy |
| 4 | Projection: partial hearing + cell origin has no unambiguous new frame |
| 5 | Checker: Bill arrival not authorised under selected direct-cell semantics |
| 6 | Projection: partial hearing + cell origin remains ambiguous |
| 7 | Projection: Ping presence conflicts with Root; hearing/cell frame ambiguous |
| 8 | Checker: Bill's audible identity has no self-identification support |
| 9 | Checker: undeclared Keyes in the preserved observation |
| 10 | Projection: partial hearing + cell origin remains ambiguous |

Acceptance remains 0/9: six projections cannot resolve old contradictory choices,
three map but still fail semantics. All first-reason codes change; none is now
missing sourceRefs or a missing Cy SELF record. This is not a behavioural test of
the new contract, and does not prove that a newly generated smaller response will
succeed. Synthetic deterministic tests separately prove valid ordinary/self/arrival/
anonymous/self-introduced occurrences reconstruct without any model bookkeeping.

## Offline preparation / tests

From this worktree (Node 22, Python stdlib, verified local metadata only):

```bash
node --test scripts/rehearsal/semantic-core.test.mjs
node scripts/rehearsal/prepare-semantic-core.mjs \
  --capture C:/cy-rehearsal/leno-awg-capture-20261013 \
  --out C:/Users/jodyf/Documents/Codex/2026-09-03/som/awg-semantic-core-preparation-NEW \
  --legacy-evidence C:/Users/jodyf/Documents/Codex/2026-09-03/som/awg-one-call-corrected10-20261017/execution-20261017-172057
```

The CLI disables networking and has no run/send/provider mode. Output must be a new
directory outside the repository, capture, runtime and model/state roots. It checks
the full evidence manifest and real token receipts before writing a package.

The current `runner/*.test.js` and `scripts/rehearsal/*.test.mjs` regression suites
are the relevant automated test boundary. Sandbox runs initially hit temp-file
rename and mock-loopback EACCES restrictions; the final run uses an owned workspace
temp directory and narrowly permitted disposable mock HTTP servers. None contacts
an actual inference provider. The separate legacy manual `promptcachetest.js`
reports seven prefix-length failures identically on untouched c3b2b1c and this
branch; its old append-only assumptions are not repaired by this AWG-only task.
The legacy print-only selftest also reports obsolete grudge/drawing diagnostic
expectations; it is not an inference or an acceptance test for this prototype.

Final result: 563/563 automated tests passed, including all 18 semantic-core tests.
Only the new rehearsal files have LF attributes pinned for stable source/package
hashes on Windows checkout; no existing production file's attributes were changed.

## LENO handoff: future authorisation required

No inference is authorised or executed by this preparation.

1. Pin this feature commit; require clean source. Verify package SHA256SUMS and
   prototype-source.json against the checkout. Require the exact wire hash above.
2. Before isolation, repeat exact offline preflight: input 2251, context 3072,
   output 420, spare 400, initialTruncation=false, fits=true, truncate:false.
3. Use the existing hardened LENO drain/hold/watchdog/restoration procedure and
   unchanged corrected hidden-startup launcher. Preserve ordinary Feddit/Qwen.
   Strict normalised origin allow rule remains http://127.0.0.1:11535 only.
4. Verify isolated Ollama 0.34.1 and exact original CY model/blob/tag/profile.
   No warm-up generation or production contact. Recheck resources/isolation.
5. A newly authorised controller must use runSemanticAttempt, not the historical
   runOneCallAttempt. Its injected generator receives the COMPLETE wire object:

```javascript
await runSemanticAttempt({ capture, nowMs, admitted: true,
  preflight: request => exactContextPreflight(request, { modelStore }),
  generate: async (wire, { signal }) => {
    // Existing strictly isolated one-send transport, wired by an authorised controller.
    // Assert SHA-256(JSON.stringify(wire)) and truncate:false BEFORE dispatch.
    // Honour signal; retain raw body, metrics, checked core and reconstruction.
    return savedOrAuthorisedProviderResponseText;
  },
});
```

The example is interface documentation, not a runnable inference script. The old
external batch wrapper must NOT be reused unchanged: its worktree/package names,
wire hash and generator/evaluator API describe the older contract.

6. Only when separately authorised, count exactly 10 sends, no repairs/replacements,
   Stage 2 or variants. Preserve identical frozen requests. Before every send the
   same mandatory preflight runs; abort the whole batch on any truncation risk.
   Returned prompt_eval_count must equal 2251; any mismatch or truncation warning
   stops sampling. Timeouts remain counted; no cold extension or hidden retry.
7. Retain original production validation, every explicit rehearsal exception,
   reconstructed provenance, semantic/role errors, latency and raw output. Judge
   grounding, not mere parsing, family diversity or disappearance of old motifs.
8. Stop owned isolated processes first, restore normal Ollama/Qwen/Feddit, verify
   original config/control hashes, and wait for controller/watchdog/sampler exit.

No quota, admission probability, pacing change or automatic follow-up batch is
introduced by this prototype.
