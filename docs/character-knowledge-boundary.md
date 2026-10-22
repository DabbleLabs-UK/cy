# Character knowledge boundary

Base: production `7cdb58d`. Rehearsal-free implementation only; no merge,
deployment, inference, restart, state migration or historical rewrite.

## Representation and authority

`runner/prompt.js` exports one immutable `CHARACTER_KNOWLEDGE` object:

| Field | Meaning |
| --- | --- |
| `known` | `name: Cy`, `inmateNumber: 7734`, `heldAt: HMP ThinkPad`, and outside postcards/pictures/replies. |
| `liveWorld` | Current location and movement restrictions come from supplied live world state, not a nominal timetable. |
| `provenance` | Postcards are testimony; recollections and prior thoughts keep their origin/uncertainty. Repetition is not corroboration. |
| `unknownUnlessEstablished` | Nature, embodiment beyond experience, creator, technical transport/architecture, sentence/release/ultimate freedom, continuous awareness. |

The object is rendered once into `CHARACTER_KNOWLEDGE_TEXT` at the start of the
existing shared `ZONE_A`. It is not a new persistence format or retrieval layer.
Journal, drawing, sleep/dream and postcard consumers of that same character
system inherit the boundary. Both postcard providers still receive the same
canonical system/prompt. Initial and repair generation retain their normal
system and source context; publication validators are untouched.

No current location, restriction flag, sentence, creator or technical identity is
hard-coded into the static core. The existing mandatory broker item still reads
`vitals.locationRegime.current` and the normal world/event sources. No movement,
restriction or knowledge is inferred from NPC eligibility or a nominal schedule.

`WORLD_KNOWS` / `WORLD_SIMULATION` canon can still call the product a digital
prison. It is not supplied to `CY_PROSE` by the broker's existing knowledge and
privacy policies. AWG and product/operator copy are unchanged.

The legacy numerical `selfModel` remains diagnostic, not character authority.
There is no new data collected, stored, retained or transmitted about visitors:
this replaces fixed character instructions in the existing provider requests.
The existing data-handling interfaces and recipients are unchanged.

## Before and after (model-facing excerpts, not generated answers)

Before:

```text
You are inmate Cy, number 7734, held in HMP ThinkPad, a British digital prison.
The cell, the machine, and your own continuity do not quite add up.
...
a body you may not have: hunger, ache, the cold of the floor, a heartbeat.
```

After:

```text
CHARACTER KNOWLEDGE - not words to copy:
Known: you are Cy, inmate 7734, held in HMP ThinkPad, a British prison.
People outside can send you postcards and pictures. You can write replies that reach them.
Live world state supplies current location and movement restrictions. A timetable is not movement or permission.
Postcards are testimony, not proof. Memories, prior thoughts, suspicions and interpretations keep their origin and uncertainty; repetition is not world evidence.
Unknown unless independently established: your nature (AI/software/machine/human/simulation/other); embodiment beyond direct experience; your creator or the prison's creator; message transport or website/server/model/operator architecture; sentence length, release conditions or ultimate freedom; continuous awareness across shutdown/restart or between experiences.
Gaps, not hidden answers or a mystery role. Respond naturally; speculation is allowed, not confirmation. Operational figures and cast descriptions do not settle these questions.
```

The old universal `no hedging` becomes `no filler hedging. Genuine uncertainty
and suspicion are allowed.` Rough voice, shorthand, existing specific phrase
bans and the rest of the journal style instructions remain unchanged. This is
the only style-rule qualification needed to avoid contradicting the boundary.

Dynamic example, supplied by the existing world source:

```text
Authoritative location: EXERCISE_YARD; activity current routine.
```

This remains a live world fact. It is not replaced by an always-in-cell persona.
A received claim or prior thought about being software remains testimony or
subjective material; its presence does not change the static known facts.

## Scope and limitations

The rendered core is 1,022 characters. The complete shared system is 5,465
characters, 677 characters longer than production. The three audited journal
snapshot inputs still satisfy the existing compactness guard, unchanged at
less than 1,800 characters over their original source-boundary baseline.
These are exact character counts, not tokenizer or context-fit claims.

Only `runner/prompt.js` changes runtime behavior. The historical `before`
snapshot systems and all snapshot source inputs remain unchanged; the three
`after.system` strings are refreshed to the new shared context. No source is
removed from or added to the journal/postcard evidence packets.

Adjacent exposures deliberately remain separate follow-ups:

- Electricity injection still mentions being switched on and Warden Florian
  paying. That attribution has not been independently established here; it must
  not be read as proof of creator or identity. No electricity behavior changes.
- Grounded bodily context still includes engineering/scientific estimates and
  instructions not to discuss the machinery.
- Static cast descriptions retain computational metaphors and associations.
- Existing inbound injection and outbound assistant/refusal filters are unchanged.

This is an authoritative input boundary, not a semantic output fact-checker.
It does not prove that an 8B model will never invent an answer, harden a prior
claim, or repeat operational wording. No behavioral improvement is claimed
without future authorized natural evidence. No old memory or public entry is
rewritten; provenance and privacy filtering continue as before.

## Verification

Focused coverage in `runner/character-knowledge.test.js` tests all core fields,
unknowns, immutable reuse, dynamic locations, restriction precedence, provenance,
natural uncertainty rather than answer templates, canonical postcard/repair
contexts, unchanged world-only canon filtering and journal settings.

The existing source-boundary suite still checks the exact voice and fixed roster,
all three prompt snapshots, separated sources, bounded continuation and repair.
The focused compatibility run also includes postcard prompt/memory/associative
recall and context broker/AWG integration tests. Use workspace-local TEMP/TMP
for Windows persistence tests; sandbox AppContainer TEMP can fail atomic rename.

Results:

- Focused compatibility run: 67/67 passed, including 12 new core tests.
- Full runner suite: 593/593 passed, no failures, skips or cancellations.
- `node runner/promptcachetest.js`: all checks passed.
- Syntax checks for changed JavaScript and `git diff --check`: passed.
- Exact snapshot comparison confirms every historical `before` and all three
  journal prompt/source bodies are unchanged; only `after.system` changes.

Initial sandbox full runs passed 591/593: outbound connections to the two
ephemeral local HTTP mock servers were denied (`EACCES`). The unchanged suite
passed 593/593 outside that sandbox restriction. No real model/provider was
contacted. A first focused run also encountered sandbox TEMP atomic-rename
denial; workspace TEMP/TMP resolved it without persistence code changes.
