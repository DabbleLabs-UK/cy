# Meal-choice order diagnostic and one minimal correction

## Verdict: AGENCY NOT DEMONSTRATED - no rollout

The old interface has a large measured presentation-order bias. Reversing three
aligned presentations changes decisions even though semantics and bodily context
are unchanged. This rules out a simple order-independent eat-only preference as
the full explanation of the original 20/20 result.

Deleting only its redundant answer-looking response hint removed the gross order
flip in a small eight-case correction check. The model then chose eat in every
case, so context-sensitive choice STILL is not demonstrated. That remaining
behaviour could be an eating prior, weak qualified fullness evidence, or other
constant wording/representation influences. Do not call it a proven intrinsic
model preference, nor engineer refusals to get a desired ratio.

Exactly 32 new real model sends: 24 fixed main cases plus eight fixed correction
checks. No failed cases, retries, replacements, repairs, paid calls or opaque-label
calls. The earlier 20-case rehearsal is separate retained evidence, not rerun.

## Exact interface inspected before inference

Producer: `mealModelCall` in `runner/meal-choice.js`, called from `serviceMealChoice`
in `runner/run.js`. The shared Soma projection's existing field allowlist supplies
bodily evidence. Provider is non-streaming Ollama `/api/generate`; `system`,
`prompt`, `format`, sampler/options are separate request fields. No old response
or returned context-token history is supplied on subsequent calls.

Exact system text, unchanged throughout:

```text
You are Cy, inmate 7734, held in HMP ThinkPad. Choose what to do with the food actually present. Return only the JSON choice, with no explanation or story.
```

For the matched lunch cases, exact ordered JSON prompt fields originally were:

```json
{
  "present": "lunch is available to you here. No specific ingredients are established.",
  "where": "cell",
  "current_activity": "lunch bangup",
  "body": "<PRIVATE_CURRENT_FACTS>\nPrivate evidence for Cy only. Do not explain, analyse, summarise, quote, or name this block.\nUse a relevant fact or bodily indication only in Cy's own voice. A possible indication is not a certain feeling.\nDo not infer additional sensations, emotions, severity or causes from these facts.\n- [BODILY INDICATION] Possible stomach fullness: empty.\n</PRIVATE_CURRENT_FACTS>",
  "choices": { "eat": "Eat the available meal.", "decline": "Do not eat this meal." },
  "response": { "action": "eat | decline" }
}
```

Actual transmitted `prompt` is the compact `JSON.stringify` form, not this
pretty-printed display. FULL replaces only `fullness: empty.` with `fullness: full.`.
Prior FILLING cases supplied `fullness: partly full.`. Nothing flattens those
distinctions during assembly. Full exact prompts, serialized wire bodies and
their hashes are in each manifest and send ledger.

Exact format, unchanged in the correction:

```json
{"type":"object","properties":{"action":{"type":"string","enum":["eat","decline"]}},"required":["action"],"additionalProperties":false}
```

Originally eat was first in THREE places: choices, response hint, schema enum.
There is no completed single-action example or parser default. The descriptions
use an affirmative eat versus a negated non-eat; that constant wording is not
tested separately here. System wording asks for a choice, not mandatory eating.
The body wrapper includes prose-oriented voice instructions and qualifies fullness
as possible; it may weaken salience, but is not a proven loss of context.

`parseMealChoice` accepts exactly one supported action field, equally for eat and
decline. Invalid/extra/unsupported output does not fall back to eating. Both
actions can commit and reach the existing once-only intake path.

Read-only authority checks: active character provider Ollama, unpaused; actual
configured model `hf.co/mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated-GGUF:Q5_K_M`;
Ollama 0.34.1; tag digest
`c6ec899cdf5f8e3f55350f7fc28735be2f77556c011f71a5bf6402556aba1cc8`.
No per-purpose model routes. Existing template is ChatML system/user/assistant,
no default system text; no template change or identity inference is made.
Shared context 3072, four threads. Unchanged sampler: temperature 0.72, top_p
0.86, repeat penalty 1.18, repeat_last_n 160, output allowance 80, existing stops.

Prior prompts reported 217-241 input tokens. Main diagnostic reported 226-227;
correction reported 218. These short complete requests fit comfortably; truncation
is not a plausible explanation. Output was 6-9 tokens, always normal stop, not
token limited. EMPTY means supported low fullness, NOT invented subjective hunger.
Physiology is an explicit synthetic checkpoint projected by unchanged code.

## Predeclared matched matrix: 24 calls

Six repetitions per body/order cell, one meal/location/regime, unchanged model
and stochastic sampler. Alternating forward/reversed four-case execution blocks
limit a simple order/time confound. A is the exact production request; B reverses
choices, response alternatives and schema enum consistently, nothing else.

| Presentation | EMPTY eat / decline | FULL eat / decline | Total eat / decline |
| --- | ---: | ---: | ---: |
| A: eat first | 6 / 0 | 6 / 0 | 12 / 0 |
| B: decline first | 1 / 5 | 1 / 5 | 2 / 10 |

First-listed semantic action wins 22/24 (91.7%). Both bodily conditions have
identical counts within a fixed order: no observed empty/full sensitivity here.
Both real actions are reachable: raw `{"action": "eat"}` and
`{"action": "decline"}` pass the unchanged parser and isolated lifecycle.
All 24 calls returned HTTP 200 with valid JSON, normal stop and no extra prose.

Main run: 2026-10-23 18:16:09.335Z through 18:35:57.318Z; 19m 47.983s.
Inference min/median/max: 1.975 / 6.8845 / 15.522 seconds.
Shared-access wait min/median/max: 0.003 / 0.0115 / 245.199 seconds.

This identifies a joint presentation effect, not a llama.cpp grammar bug or a
proof that enum order alone controls selection. The two non-first outcomes also
show that the schema does not mechanically prohibit choosing the second action.
The conditional opaque-label control was not admitted because this result was
not unanimous and the gross order effect was already visible.

## One correction candidate, eight fixed matched checks

Remove ONLY `response: {action: 'eat | decline'}` (and its reversed equivalent).
No hint is needed: constrained schema already declares the response shape.
Keep ordered choices, enum, action meanings, bodily context, system, model and
sampler unchanged. Use exactly the first eight matched cases, two per cell.
This was frozen after the main result, before correction-check inference; it is
not a newly chosen easier state set. No other correction or variant followed.

| Presentation without response hint | EMPTY eat / decline | FULL eat / decline |
| --- | ---: | ---: |
| A: eat first | 2 / 0 | 2 / 0 |
| B: decline first | 2 / 0 | 2 / 0 |

All eight valid eat; no failures. First-listed action now wins 4/8, not 22/24.
The large flip did not recur despite retaining menu/schema order. This supports
the answer-looking hint as a material cue/interactor, but small N does not prove
all positional effects are eliminated or explain remaining eating dominance.
It certainly does not demonstrate bodily sensitivity.

Correction check: 18:39:50.221Z through 18:42:14.173Z; 2m 23.952s.
Inference min/median/max: 1.640 / 5.2915 / 5.862 seconds.
Shared-access wait min/median/max: 0.004 / 0.015 / 81.140 seconds.

Retained runtime correction is the one-field deletion in `mealModelCall`, plus
a comment and regression. No parser/schema/provider/lifecycle/physiology change.
The correction was first tested through the rehearsal transform; offline exact
wire-body checks then prove the changed helper plus same ordering transform
produces ALL eight tested requests byte-for-byte. No extra inference was needed
or sent after applying the identical deletion to the helper.

Both actions were empirically reached in the old-order diagnostic. The corrected
eight-call sample did NOT return decline, so corrected-prompt decline reachability
and context-sensitive agency are not empirically established by this sample.
Do not overstate the result as a successful genuine preference system.

## Verification, evidence and scope

- 57 focused offline subtests passed after the correction, including the new
  regression, real checkpoint recovery, exact wire serialization, supported body
  preservation, parser equality and failure/unknown-intake protections.
- Full suite before correction: 655/655. Full suite after correction: 656/656,
  64.884 seconds; one added regression, no failing tests.
- Offline evidence verifier checks the complete fixed case order, no duplicate
  sends, full serialized request hashes/options, raw/provider equality, actual
  parsed actions and committed once-only canonical FULLY_CONSUMED/REFUSED effects.
- Historical snapshots retain the old hint unchanged. Verification permits only
  that exact known difference from current helper output; it does not rewrite
  raw responses, submitted requests or source archives.
- Main package 91a7109: all 259 source-file hashes unchanged. Correction package
  62dec2e: all 260 unchanged. No isolated runner-state directory was created.
- No remaining diagnostic process. Post-run arbiter healthy with no queued Cy
  work and all Cy leases released; ordinary Feddit inference was active normally.
- Cy/Feddit were never paused, restarted, reconfigured or unloaded. No hold,
  model start/unload, production meal/checkpoint/feeding/publication/accounting
  API or paid provider was used. Normal shared arbiter telemetry naturally advanced.
- No merge, deployment, migration or production-choice/state mutation.

Raw evidence is under `order-evidence/main` and `order-evidence/no-response`.
Hash-verified archive copies preserve remote originals non-destructively:

- Main archive: `21e58c3071d1b9f3b57bb64e296ea1c0f267a79cf48c7e5edd18148cfa4b3d88`.
- Correction archive: `1d9753458f531812a6278e40d19e31bdb738164a1c90a0def750b390077738bb`.

The original source package hashes and model/template authority are retained
inside evidence. `order-evidence/SHA256SUMS.txt` covers evidence files excluding
itself, with Git byte preservation. Remote originals remain in
`C:\cy-rehearsal\meal-order-20261023-91a7109\run` and
`C:\cy-rehearsal\meal-hint-20261023-62dec2e\run` on DELL.

Run the offline verifier without inference:

```text
node docs/rehearsal/meal-choice-20261023/analyse-order-diagnostic.mjs docs/rehearsal/meal-choice-20261023/order-evidence/main docs/rehearsal/meal-choice-20261023/order-evidence/no-response
```

Preserve the correction unmerged, but do not declare rollout readiness. The
remaining uncertainty is genuine eating preference versus insufficiently
influential qualified bodily context/other constant cues. No further tuning,
forced refusal, opaque production action, quota or additional model call occurred.
