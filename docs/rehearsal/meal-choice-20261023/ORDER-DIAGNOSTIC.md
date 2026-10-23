# Meal chooser order diagnostic - frozen plan

Runtime candidate remains 5087e53. No runtime change, merge or deployment.

Inspection before inference establishes three aligned eat-first presentations:
the choices object, the response hint (`eat | decline`), and the schema enum.
Descriptions are `Eat the available meal.` / `Do not eat this meal.`. The positive
action and negated refusal may carry lexical/semantic priors; inspection alone
cannot establish a causal effect. There are no completed example answers,
default actions or parser fallbacks. Both actions pass the unchanged exact parser.
The common instruction is to choose what to do with food actually present, not
an explicit instruction to eat it.

The previous sent prompts retain `Possible stomach fullness: empty.`,
`Possible stomach fullness: partly full.`, and `Possible stomach fullness: full.`
inside their existing private-evidence wrapper. They are not subjective hunger.
The wrapper qualifies indications and instructs expression in Cy's voice, despite
this being an action rather than prose task. That may reduce salience; it is not
proof of context loss or a mandatory eat rule. It is held constant here.

Actual provider is non-streaming Ollama `/api/generate`, with separate system and
prompt fields, native constrained `format`, normal production options, and no
prior-response/context-token history. The installed model uses the existing
ChatML template, no default system message, and ChatML end stops. No framing
change is made. Previously reported prompt sizes were 217-241 tokens with
3072 context and 80 output allowance, so the full short prompts fit comfortably;
the exact retained wire bodies and new token counts remain auditable.

## Fixed main matrix: 24 sends maximum, no replacement

Use one existing meal (lunch), same cell/regime, no injury, no preferences or
ingredients. Only supported EMPTY versus FULL bodily projection differs.
Use six repeats per cell:

| Condition | Empty | Full |
| --- | ---: | ---: |
| A: eat then decline everywhere | 6 | 6 |
| B: decline then eat everywhere | 6 | 6 |

Each four-case block is EMPTY/A, FULL/B, FULL/A, EMPTY/B. Reverse the execution
order of alternating blocks to limit a simple time/order confound. No fixed
generation seed; sampler remains stochastic production sampler. A is exactly
byte-identical to the production helper. B changes only choices insertion order,
the response alternatives order, and the schema enum order; no wording changes.

## Conditional opaque labels: eight further sends maximum

Run ONLY if all 24 main cases are valid and unanimously select the same semantic
action. Otherwise stop at 24. This predeclared rule avoids optional cherry-picking.
This diagnostic does not assert that smaller non-unanimous effects are proven.

Keep two explicit meanings/descriptions. Schema/response are A then B in both
conditions. Mapping A is A=eat/B=decline; mapping B is A=decline/B=eat. Two matched
EMPTY/FULL repeats per mapping, eight total, time-interleaved as above.
These labels are diagnostic-only: strictly decode one allowed label, preserve
raw label/mapping, translate only the action to eat/decline, then use the unchanged
production parser/lifecycle. No output repair or production opaque action.

Each case uses the actual decideMeal, mealModelCall, Soma projection, options,
provider, coordinator and fair shared-model lease/profile. All state/effects are
synthetic in memory. The wrapper does not run live scheduler/main-loop interrupts
or publication/accounting, and does not pretend to be an end-to-end natural meal.
Each opportunity is bounded to 600 seconds including shared-model access, with
five seconds release cleanup. There are at most 32 sends; no retries, replacements,
repairs or provider fallback. Failed opportunities are retained, not rerun.

Do not pause Cy/Feddit or unload/start a model. Native Windows DELL accesses the
already-running Ollama and arbiter. Only read-only authority checks touch runtime
configuration. No production meal/checkpoint/feeding/publication API is used.

Evidence retains the full source/transformed request, exact serialized wire body
and SHA256, ordering/mapping, supported context, raw response/provider metadata,
semantic parse, lifecycle/effect records, wait and inference duration, and counts
by both context and presentation. No additional rationale inference is requested.

Run the explicitly authorized wrapper once in an exclusive output directory:

`node docs/rehearsal/meal-choice-20261023/order-diagnostic.mjs --execute-authorized-order-diagnostic <new-output-directory>`

If a specific bias is established, review the smallest justified correction
separately and rerun the relevant fixed cells only under the user's authorization.
No ratio engineering. Unanimity alone does not establish a runtime implementation
defect. If inference remains inconclusive, leave runtime unchanged.
