# One-call context budget: offline audit and corrected LENO handoff

REHEARSAL ONLY. No inference, production merge/deployment/restart, normal Ollama
interruption, or Feddit pause was performed for this correction.

Correction branch: `fix/awg-one-call-token-budget-20261017`, based on `6ad0e7a`.

## Root cause, established against the actual binary

Both LENO's isolated Ollama and DELL's production Ollama are 0.34.1, executable
SHA-256 `1ff56c8b2c791bff69b6457d25aa63ed11073562cd47b14f42dd16dfa4353e05`,
built from `38fdb5dd58c761f850cddd6ba1e78a7954646b4f`, modified=false.
Both run the same CY model/tag/template and `-c 3072 -np 1 -t 4 --context-shift
--keep 4`. DELL /api/ps and both run logs confirm context_length/n_ctx=3072.
No request num_ctx was omitted, ignored, overridden or reduced. The launcher
OLLAMA_CONTEXT_LENGTH=3072 agrees with the explicit request; it was not changed.
The corrected hidden `start ... /B /BELOWNORMAL /WAIT` launcher remains unchanged.

The actual source is
[llm/llama_server.go at the binary revision](https://github.com/ollama/ollama/blob/38fdb5dd58c761f850cddd6ba1e78a7954646b4f/llm/llama_server.go#L280).
`completionPromptForRequest` checks the COMPLETE tokenized/template-rendered input
against `num_ctx - 1`. If it overflows and context shifting is enabled,
`contextShiftPromptLimit` performs the old runner's first half-window shift:

```text
initial full-input limit = 3072 - 1 = 3071
old complete input = 3120 > 3071
shifted input limit = 3072 - floor((3072 - 4) / 2) = 1538
discard = 3120 - 1538 = 1582
retain token IDs [0:4] + [1586:3120]
```

This is NOT 3072 minus a 420-token output reservation, and 1538 is NOT a permanent
input limit. The matching actual log is `llama_server.go:318`,
`truncating input prompt limit=1538 prompt=3120 keep=4 new=1538` (all ten samples).
The source passes num_predict separately as n_predict; it does not subtract 420
in this overflow calculation.

Exact offline reconstruction matches 3120 and the retained 1538 IDs. The four
retained prefix tokens are BOS, `<`, `|`, `im`; the rest starts inside a historical
record near `At":"2026-10-13 21:11:17.216"`. All system/generation instructions,
current state and actor roster were discarded. The first batch therefore cannot
test the complete grounded-proposal contract or establish model inadequacy.

## Complete request accounting

The request actually transmitted used:

- `hf.co/mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated-GGUF:Q5_K_M`;
- temperature 0.65, top_p 0.9, repeat_penalty 1.1, repeat_last_n 128;
- num_ctx 3072, num_predict 420, num_thread 4;
- the full captured stop list, stream=false, keep_alive=5m;
- `/api/generate`, separate system/prompt, model's existing ChatML template;
- default truncate=true and num_keep=4.

The exact GGUF LLAMA3/llama-bpe vocabulary/merge ranks plus pre-tokenizer give:
system body 44 tokens, old prompt body 3040 tokens, complete templated input with
BOS 3120. The net framing/BOS overhead is 36 tokens for these inputs. Thus 3120
ALREADY includes the system and template/BOS tokens; they are not additional
unaccounted tokens. The JSON schema is passed separately as native grammar, not
inserted into the prompt; stops and HTTP envelope are not prompt text.

The 60 neutral-gate requests used the same model/options/context, including
num_predict=420, but the complete input was 2719 <= 3071. Actual completions used
only 6-7 tokens, so 2719+7=2726 fits without either initial truncation or an output
shift. A hypothetical full 420-token completion would NOT have full headroom;
the new conservative preflight correctly distinguishes this from input fit.

| Budget | Old proposal | Corrected proposal |
|---|---:|---:|
| Complete input, including system/template/BOS | 3120 | 2129 |
| Configured context | 3072 | 3072 |
| Output allowance | 420 | 420 |
| Additional terminal reserve | 1 | 1 |
| Spare after complete input + maximum output + reserve | -469 | 522 |
| Provider's initial truncation required | yes | no |

DELL's identical binary, model/tokenizer/template and 3072-token execution profile
would fit the corrected request UNCHANGED. No context/RAM increase is requested,
and no corrected request was sent to DELL or LENO.

## Smallest correction: lossless packet tables

The schema, system text, original eight semantic instructions, checker, production
validator/materialiser, source IDs, sampler, model/framing, output limit and
timeout are unchanged. One short decoding sentence explains two compact tables:

- Actor rows share column names, `actor:` ref prefix and self/eligible-not-present
  defaults, retaining every ID, name, role and exact eligibility.
- Historical rows share column names and historical scope. Their source ID is
  exactly their ref without `event:`; both timestamp representations, locations,
  participants, observed flag, event type and verbatim summary remain present.
- All other packet fields remain intact, including current regime, full source
  references, object/thread availability/transitions, observation conditions,
  adjacent-origin constraints, confirmed presence and bounds.

`expandModelPacket(compactModelPacket(packet))` is exactly the original packet.
No semantic material, historical fact or grounding condition was removed. New
unrecognised fields fail compaction instead of silently disappearing. Original
packets/captures and historical experiment evidence were not rewritten.

## Mandatory exact preflight and failure behaviour

`cy-context-preflight.py` uses only the verified GGUF metadata header (~7.8 MB),
the model manifest, config, parameter and template blobs, and the pinned Ollama
executable hash. It never reads tensor weights into a model, starts Ollama, uses
an endpoint, or performs inference. It reproduces the prior independent tokenizer
method and the retained real-server counts 3120/2719.

The tokenizer port is EXACT for the supported printable-ASCII/tab/CR/LF request
shape and this pinned LLAMA3 tokenizer/template. Unsupported Unicode, embedded
native special tokens, control characters, raw/context/images/alternate-template
requests, model/default/template/build changes fail CLOSED, not to an estimate.
Supporting other shapes requires a separate exact tokenizer/template audit.

The guard requires `input + num_predict + 1 <= num_ctx`, not merely input fit.
It binds the receipt to the whole request fingerprint and validates the 3072
profile. Missing/failed/mismatched preflight prevents the generator callback.
`runOneCallAttempt` now REQUIRES an injected preflight; old unguarded callers make
zero model calls. It retains no-repair/no-replacement and the 420000-ms request
deadline AFTER successful metadata-only preflight.

The corrected wire additionally sets `truncate:false`. This disables provider
lossy-input fallback as defence in depth; it changes no framing, sampler or
model-facing content for a fitting request. It does not replace the offline guard.

## Corrected prepared package

```text
C:/Users/jodyf/Documents/Codex/2026-09-03/som/awg-one-call-preparation-20261017-budget-verified-final/
```

Contains the full canonical affordance packet, compact model-facing request,
exact wire body, unchanged schema/order, token-budget receipt, trace, capture
verification and SHA256SUMS.txt. It is OFFLINE PREPARED ONLY, not a new run.

- Request JSON SHA-256: `cd7e692a72afd567ba477007ddf94b451cf99e72d5e7deda7292879abf47e0f8`
- Wire SHA-256: `04703ce79d0ed640753359b7a0e603b00e9e20c87d279488b25d44a0f7c01ee9`
- Schema SHA-256 (unchanged): `848e712670bac6e370ff4f1b653258a64aa56f2b84b68826065df08bad703f8c`

Offline reproduction, before ANY pause/server start, with a NEW output directory:

```bash
node scripts/rehearsal/prepare-one-call-grounded-proposal.mjs \
  --capture C:/cy-rehearsal/leno-awg-capture-20261013 \
  --out C:/Users/jodyf/Documents/Codex/2026-09-03/som/awg-one-call-preparation-NEW \
  --model-store C:/cy-rehearsal/models
```

Only after separate future batch authorisation, a hardened controller must verify
these hashes and the same isolated binary/model/profile, retain the strict :11535
allow rule/hidden startup/restoration safeguards, and use:

```javascript
await runOneCallAttempt({ capture, nowMs, admitted: true,
  preflight: request => exactContextPreflight(request, { modelStore }),
  generate: existingStrictOneSendTransport,
});
```

The transport must send exactly `{...request, stream:false, keep_alive:'5m',
truncate:false}` and honour AbortSignal as before. It must compare the actual
wire hash and never modify, truncate, repair or replace a request. The previous
external batch wrapper is NOT usable unchanged: mandatory preflight now rejects
it before its send callback. No new count or behavioural experiment is authorised
by this handoff.

## Tests

Tests cover exact retained counts/truncation, complete templating, input-vs-output
headroom, lossless round-trip of the frozen packet, unchanged schema/options and
semantic instructions, unsupported input fail-closed, oversized future packets,
missing/stale receipts and zero generator calls on preflight failure. Existing
grounding, observation, presence, privacy, timeout/cancellation and no-repair
tests remain applicable. Full production runner fixtures are regression-only;
they do not make actual model calls.
