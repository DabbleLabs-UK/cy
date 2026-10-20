# Materially fresh journal subjects

Status: implemented on an isolated feature branch; not merged or deployed.
Production base: `85a2b7e9966b48d5578226703cc46e9dfb4cc0bb`.

## Authority and previous path

On 20 October 2026, DELL `C:\dev\cy` hashes for `run.js`, `prompt.js`,
`incidents.js` and `expressive-choice.js` matched this production base.
The old path was `recordIncident -> vitals.ledger -> selectJournalTurn ->
turnDirective -> buildDirectives -> buildPrompt`. It selected a salient newer
ledger timestamp; it did not compare material facts or resolve the canonical
source behind the ledger line.

In particular, `fireOverheard` captures an actual structured hearing, but
`makeIncident('overheard')` separately chooses a generic actor/detail paraphrase.
Those random "talking low" notes could repeatedly win while concealing the
source's actual content. `lastIncidentMs` can also advance without a new fact.

## New selection boundary

At the existing canonical world-event capture boundary, build a small private
journal subject projection. The selector uses the existing 24-event recent-world
ring and observed revisioned object-custody transitions. It does not select from
journal prose, memory prose, cast descriptions, Soma measurements or unverified
texture. These sources keep their existing context interfaces; this change does
not remove them globally.

Compare stable canonical material rather than a source record's timestamp or
random ledger wording: participants, location, actual source content, observed
facts, episode identity/stage, intake facts, action/outcome and object revision.
Ignore event-delivery provenance, elapsed metadata, observation/repetition counts,
and the hearing's misheard flag as evidence of a new situation. A changed
perceptual variant of the same underlying hearing is not a second development.
Uncertain text remains explicitly qualified; hidden objective wording is never
substituted for what Cy heard. Typed meals compare meal identity/intake facts,
not an elapsed-time caption. New meal/search/contact episodes and material
outcome changes remain eligible immediately.
Actual direct confirmation can also develop an earlier uncertain hearing; mere
switching between the producer's probable and misheard variants cannot.

Private correspondence is a special provenance boundary: a new arrival/reply
can supply the generic fact that mail arrived/a reply was sent. The selector
cannot copy sender-scoped postcard text or identity into a journal directive.
Existing sender retrieval and privacy mechanisms are unchanged.

Up to 128 material SHA-256 keys live in `journalSubjectKeys`, in the existing
checkpoint's engineering bookkeeping zone. Keys are committed only when a
journal actually emits. An unsuccessful attempt does not consume them. Seed
from world facts predating the last published journal on upgrade; retain keys
across restart and recent-world ring eviction. This is bounded duplicate
bookkeeping, not a topic cooldown, novelty score, quota or second memory store.
Older receipts can eventually fall out after enough distinct material inputs;
this is not unlimited semantic memory.

If nothing qualifies, the directive says:

> no materially new external development since you last wrote. you may develop
> an existing thought, but earlier writing and an unchanged observation are not
> evidence of a new event. stay with ONE thing; do not invent a development.

ONE_SUBJECT, the 520-character subjective continuation, voice/examples, current
model/sampler/context, 93-token ceiling, Tempo, near-repeat and publication
validation are unchanged. No additional inference is introduced.

## Offline replay and fixtures

Run `node runner/replay-journal-freshness.mjs`. It makes no network/provider call.
The fixture contains the 30 audited public journal outputs/directives and 278
deduplicated, compact non-correspondence canonical records supporting their
recent-world inputs. Default unknowns and irrelevant record fields are omitted.
There is no private postcard body or selected autobiographical memory content.

The input boundary is the exact retained `journal-prose:<opportunity-ms>` context
packet's `generatedAt`, not the earlier Soma snapshot/opportunity time. Chooser
and readiness waits sometimes separated those times by several minutes. The
replay follows actual publication boundaries, committing keys after each entry.

Historical full 12-row incident-ledger snapshots were not retained. Old decisions
are the exact retained model-facing directives, not a fabricated old-ledger
reconstruction. The new canonical input ring is reconstructed at each exact
context timestamp. This is a selector replay, not a prediction of new prose.

Result: old **27 fresh / 3 no-new**; revised **19 fresh / 11 continuation**.
All 18 generic quiet-voice directives disappear as freshness claims. Some now
select genuine other developments rather than simply becoming quiet.

| Actual journal/context | Revised decision |
| --- | --- |
| 18 Oct 20:16, `2713356`: generic quiet voices | No material development; underlying hearing already available |
| 18 Oct 20:25, `2713599`: lockdown | Fresh canonical lockdown start |
| 18 Oct 20:43, `2714141`: Bailey/name | No certified fresh event: actual cue is unverified texture without a canonical encounter |
| 18 Oct 21:08, `2714883`: generic quiet voices | Fresh observed handover/search consequence |
| 19 Oct 09:13, `2734721`: recycled meal minutes | No material development |
| 19 Oct 19:51, `2751645`: generic quiet voices | Fresh canonical lifting of lockdown |

The retained unsigned-keys hearings have the same material key despite new
source IDs/times and the alternate mishearing. A first supported discussion is
eligible; its repeated observation is not. A canonical Bailey/name encounter is
eligible in the deterministic positive-control test. Promoting the actual
unverified texture cue to a real encounter would be inventing provenance.

The no-fresh intervals contain no suppressed new canonical key in the available
ring. Meaningful canonical events remain eligible; one selected subject per
entry is not a guarantee that every eligible event is chosen.

## Explicit limits

This is producer-grounded equality, not an arbitrary natural-language semantic
matcher. Current controlled producers give stable canonical content even when
the incident paraphrase changes. Future producers that express the same claim
with different free-form canonical wording may need a typed fact identity at
their own boundary; no fuzzy threshold or extra LLM has been added here.

The meal-minute chain did not originate in `selectJournalTurn`: numbers entered
through the existing grounded Soma block and were then copied through subjective
continuation. They cannot certify freshness here, but this correction alone
cannot guarantee the model stops copying them from those unchanged sources.
It also does not fix the token ceiling, editorial tails, separator imitation or
fixed example echoing. Natural prose quality has not been tested by inference.

Repeated searches are genuinely different canonical episodes in this sample.
They may now become a dominant supplied subject. This change does not hide them
or manufacture diversity; it fixes freshness attribution, not the world cadence.

## Verification

20 October 2026: focused incident/continuation/freshness tests **36/36 passed**;
full `node --test --test-concurrency=2 runner/*.test.js` **494/494 passed**.
The full suite's disposable loopback mock servers required execution outside
the network sandbox; the earlier two sandbox-only transport failures disappeared
without source changes. Checkpoint fixtures used an owned workspace temp folder.
No model inference, production write, deployment, merge or restart was performed.
