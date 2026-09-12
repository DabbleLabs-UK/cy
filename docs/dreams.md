# Dream expression boundary

Cy's dream output is a model-mediated subjective process. It uses a bounded
sleep-only context packet containing the current sleep period, up to four recent
world residues, up to three immediate dream-material items, and up to three
eligible public autobiographical traces. It is inspired by the idea that dreams
can recombine recent and older material, but it is not a validated biological
model of human dreaming or memory consolidation.

Dream generation is separate from waking prompt assembly. It never receives the
waking prose buffer, normal expressive-choice prompt, or current visitor
conversation. The model returns `cy.dream-fragments.v1`: one to five locally
meaningful fragments, each capped at twelve words and 96 characters. The model
call has a 96-token output limit and no retries. These are engineering context,
model-call, and presentation limits, not psychological coefficients.

`DREAM_MEMORY_SURFACING` queries the existing autobiographical store but passes
only active `PUBLIC_RECALLABLE` episodic, person, motif, or unresolved-thread
records to the model. `SENDER_RECALLABLE` and `INTERNAL_ONLY` records are excluded
because dream output is public. A dream expression may enter the existing memory
formation queue as `DREAM_EXPRESSION`; the formation model may decide `NOTHING`.
There is no separate dream-memory database.

Dream output is never world truth. It does not create an environment event,
modify an injury or feeding ledger, update threat learning, establish a social
fact, enter the prison incident ledger, or update grounded/legacy Soma state.
Its only durable cognitive route is provenance-bearing autobiographical memory
formation as subjective expression.

The public renderer uses one dark dream field per sleep period. Fragments remain
separate and receive deterministic, non-overlapping layout values derived from
event identity and fragment index. The abstract drawing is accumulated as a
lightweight SVG inside the same field. A 4.8-second CSS fade is available only on
the newest live fragment; completed and historical dreams contain no timers,
observers, Pen renderers, or persistent animation loops.

## Numerical inventory

All values below are engineering limits, not biological or psychological claims.

| Value | Number | Classification |
| --- | ---: | --- |
| Maximum fragments per event | 5 | ENGINEERING DREAM PRESENTATION |
| Maximum words per fragment | 12 | ENGINEERING DREAM PRESENTATION |
| Maximum characters per fragment | 96 | ENGINEERING DREAM PRESENTATION |
| Model output token limit | 96 | ENGINEERING MODEL CALL SETTING |
| Model retry limit | 0 | ENGINEERING MODEL CALL SETTING |
| Maximum recent world residues | 4 | ENGINEERING CONTEXT BUDGET |
| Maximum immediate material items | 3 | ENGINEERING CONTEXT BUDGET |
| Maximum autobiographical traces | 3 | ENGINEERING CONTEXT BUDGET |
| Serialized context packet limit | 1,200 characters | ENGINEERING CONTEXT BUDGET |
| Memory retrieval deadline | 750 ms | ENGINEERING CONTEXT BUDGET |
| Live fragment fade duration | 4,800 ms | ENGINEERING DREAM PRESENTATION |
| Horizontal offsets | 4, 18, 9, 27, 13 percent | ENGINEERING DREAM PRESENTATION |
| Inter-fragment gaps | 10, 18, 8, 22, 14 px | ENGINEERING DREAM PRESENTATION |
| Fragment opacity values | 0.86, 0.72, 0.80, 0.66, 0.76 | ENGINEERING DREAM PRESENTATION |
| Fragment scale values | 1.00, 0.96, 0.98, 1.01, 0.97 | ENGINEERING DREAM PRESENTATION |

The pre-existing dream cadence is unchanged: murmurs are scheduled 5-20 minutes
apart and the single abstract drawing still releases one stroke every 1-2 minutes
during the existing small-hours window.
