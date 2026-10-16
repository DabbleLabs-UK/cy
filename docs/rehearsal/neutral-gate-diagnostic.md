# Neutral-decision gate diagnostic - LENO handoff

REHEARSAL ONLY. Not production. Not imported by the runner. No network, provider,
state write, Stage 2 or occurrence generation. **Do not run the gate sampling until
explicitly authorised.** This document prepares it and stops.

## Question it answers

The grounded Stage-1 selector produced 9/9 `NO_EVENT` on two separate runs. This
isolates ONE thing: when the decision is reduced to a neutral yes/no gate over the
**same frozen packet, same sampler, same model**, does the model still prefer
"nothing happens" - and does that survive reversing the label-to-meaning mapping?

- Same raw label wins both arms -> **token/position bias** (the model latched a
  lexical label, not a meaning).
- "Nothing" meaning wins in both arms despite the reversal -> **genuine abstention**.
- "Something" wins both -> genuine action preference (the mirror).
- No stable majority -> the original wording/schema contributed a mix.

Per the audit, the decision is made before any heavy payload and llama.cpp has no
future-length lookahead, so this diagnostic deliberately does **not** vary payload
complexity. It tests only the decision label.

## Design (what the model sees)

One required field, two neutral single-token labels, identical schema in both arms:

```json
{ "type":"object", "additionalProperties":false, "required":["decision"],
  "properties": { "decision": { "enum": ["<L1>", "<L2>"] } } }
```

Two counterbalanced arms, identical in model / options / system / schema / packet;
the **only** difference is which meaning each label is bound to in the prompt:

- Arm A: L1 = "nothing" (NO_EVENT), L2 = "something" (OCCURRENCE)
- Arm B: L1 = "something" (OCCURRENCE), L2 = "nothing" (NO_EVENT)

The model-facing text contains neither literal `NO_EVENT` nor `OCCURRENCE` (those
appear only in analysis/mapping). The frozen packet is reused byte-for-byte except
its `interpretation.note`, which embeds the literal `NO_EVENT`; it is replaced with
a neutral equivalent (recorded in `packetNeutralisedFields`). The build fails closed
if any literal reaches a model-facing field.

## Step 1 - tokenizer preflight (mechanical, no generation)

The labels must each be exactly ONE token under the EXACT CY model tokenizer. Produce
a tokenization record and let the preparer verify/select. Tokenizing a string is not
model inference (no generation); the gate sampling in Step 3 is.

Produce `tokenization.json` mapping each candidate label to its token id array (or
count) under the pinned model, e.g. via the model's own tokenizer (llama.cpp
`llama-tokenize -m <model.gguf> -p "<label>"`, or the equivalent for the CY stack):

```json
{ "Wug":[1234], "Dax":[5678], "Fep":[90,12], "...":"..." }
```

Cover the whole pool in `NEUTRAL_LABEL_POOL`
(`Wug, Dax, Fep, Gorp, Zav, Tiv, Vash, Pim, Lirn, Kaz, Blif, Trell, Snod, Quel, Frob`)
so the preparer can auto-select the first two single-token entries, or pass an
explicit `--labels L1,L2` pair you have confirmed. The preparer refuses any pair that
is not two distinct, single-token, balanced, literal-free labels.

## Step 2 - prepare (offline; builds both arm requests, no sampling)

```bash
node scripts/rehearsal/prepare-neutral-gate.mjs \
  --capture C:/cy-rehearsal/leno-awg-capture-20261013 \
  --tokenization C:/path/to/tokenization.json \
  --out C:/Users/jodyf/Documents/Codex/2026-09-03/som/awg-neutral-gate-prep-NEW
```

Writes to a new local dir only (never the repo, capture, model store or runtime):
`arm-A-request.json`, `arm-B-request.json`, `prepared-gate.json`, `verification.json`,
`SHA256SUMS.txt`. It verifies the capture bundle checksums and the current AWG module
fingerprint first (same guard as the grounded prototype), and records the selected
labels, their verification, the packet fingerprint and the neutralised fields.

## Step 3 - gate sampling (SEPARATE, authorised run only)

Do not run without explicit instruction. When authorised: send `arm-A-request.json`
and `arm-B-request.json` to the pinned local Ollama N times each (the sampler is
stochastic - `temperature 0.65`; use e.g. >=30 completed per arm for a stable read),
collecting per sample `{ arm, raw, timingMs, error }`. Keep raw outputs unrepaired.

## Step 4 - readout

Feed the collected samples to `analyzeGateOutputs({A:[...], B:[...]}, prepared)` (from
`neutral-gate-diagnostic.mjs`). It reports per arm: raw label counts, mapped-semantic
counts, errors/timeouts, latency, and an advisory `verdict`
(`LABEL_OR_POSITION_BIAS` / `GENUINE_ABSTENTION_PREFERENCE` / `GENUINE_ACTION_PREFERENCE`
/ `WORDING_OR_SCHEMA_CONTRIBUTED` / `INCONCLUSIVE`). The verdict is advisory; confirm
against the raw counts and N.

## Offline tests

```bash
node --test scripts/rehearsal/neutral-gate-diagnostic.test.mjs
```

17 tests: label tokenizer-balance and pool selection; arms share model/system/options/
schema and differ only in a pure phrase-swap mapping block; packet and sampler
byte-identical across arms; no forbidden literal in model-facing text and the packet
note neutralised; build fails closed on a leak; capture not mutated; and the readout
verdicts for each interpretation branch.
