# Character-facing bodily context

## Source and scope

Base: production `339b62e2f33bacc78fe02e4ad486064940e11678`.

`grounded-prose-context.js` has two deliberately separate outputs:

1. `buildGroundedProseContext`: full typed snapshots and source/epistemic data,
   including scientific estimates, parameters and uncertainty for inspection.
2. `formatGroundedProseContext`: the small character-facing language projection.

Only the second boundary changes. The structured builder above it is unchanged.
Model equations, coefficients, state/transition thresholds, snapshot functions,
history, persistence and public UI files are untouched. No migration or new
state is required.

## Actual consumers

`soma.groundedDirective` -> `prepareSomaGeneration` -> shared `buildCtx`/broker
supplies the formatted directive to local and DeepSeek postcard replies,
waking journals, drawing-intent prose and warden responses. The same readable
projection reaches the optional expressive chooser. Its full diagnostic
`groundedContext` supplies focus references/inspection, not raw JSON in the
model payload. Journal broker projection preserves observed facts separately
from uncertain indications; its fallback uses the same formatter.

Existing background memory context calls also reuse the directive; no memory
interface, store, selection, formation or privacy policy is changed. No special
postcard or journal formatter is introduced. Dream/sleep branches do not use
the waking bodily block. AWG explicitly excludes it (`!forAwg`); drawing DSL
rendering does not acquire another body-state source.

## Projection rule

- Preserve recorded current awake/asleep state as an observed fact.
- Omit raw Process S pressure and Process C phase/interval values. They have no
  approved felt-state equivalent; do not relabel them as tiredness or a feeling.
- A LIVE, finite, nominal-range predicted-sleepiness estimate may supply only
  its existing published plain-language anchor, labelled BODILY INDICATION and
  qualified as possible. No new intensity mapping, interpolation or fatigue
  conversion is added. An out-of-range result is not replaced by a clamped
  feeling; calculations/public out-of-range display remain unchanged.
- A LIVE `ESTIMATE_AVAILABLE` fullness headline may supply only its existing
  EMPTY/FILLING/FULL/VERY_FULL band, qualified as possible stomach fullness.
  FILLING is rendered as "partly full", not a claim that contents are currently
  increasing. No hunger, comfort or distress is derived. Scenario-uncertain,
  incomplete, uninitialised and unavailable readings do not supply a feeling.
- Existing intake, meal, social, current external-context and injury facts stay
  available. Injury location uncertainty stays uncertain; harmful exposure is
  described without nociceptive/mechanistic vocabulary or a pain/severity claim.
- Past outcome counts remain experience, not certainty or causal control. The
  posterior statistic and "perceived control is not modelled" explanation are
  omitted from character text but remain inspectable.

The instruction listing hidden machinery to avoid mentioning is removed. The
replacement says: "Use a relevant fact or bodily indication only in Cy's own
voice. A possible indication is not a certain feeling." It also forbids inferring
additional sensations, emotions, severity or causes. There is no instruction to
hide supplied engineering information because that information is not supplied.

This is a source projection, not a vocabulary filter. A correspondent or genuine
world source may independently mention technical words; those are not censored.
Historical published/generated text is not rewritten or purged. The change
prevents a new backend-context injection, not every possible model invention.

## Before/after examples

These are deterministic synthetic formatting examples, not model generations
or claims about Cy's natural output. They were compared directly with the base
production formatter on identical typed inputs.

Sleepiness, before:

```text
[MODEL ESTIMATE] Predicted KSS 5.80 on the 1-9 scale (nearest anchor: some signs of sleepiness; population-default phase; model residual SD 1.42). This is a model estimate, not an observed feeling.
```

After:

```text
[BODILY INDICATION] Possible sleepiness: some signs of sleepiness.
```

Fullness, before:

```text
[MODEL ESTIMATE] Gastric fullness estimate: full, modelled gastric distention ~700 mL (central 95% 600-800 mL); display bar ~81% of a derived reference-full envelope (a secondary visualization, not itself a measured percentage); input uncertainty published input-distribution uncertainty. This is a model estimate of stomach fullness after eating, not an observed feeling.
```

After:

```text
[BODILY INDICATION] Possible stomach fullness: full.
```

Observed wakefulness, before:

```text
[MODEL ESTIMATE] Recorded awake; sleep-pressure estimate 0.880 (interval 0.800-0.960, still calibrating).
```

After:

```text
[OBSERVED FACT] Currently awake.
```

The separate circadian schedule/phase line and unavailable-fullness technical
reason have no replacement experiential claim. An observed abrasion remains
"Active abrasion at left hand"; uncertainty becomes "possibly at", rather than
exposing "site certainty" metadata. Nothing implies a degree of pain.

## Regression surface and deployment

Thirteen new focused tests cover live snapshots, all existing anchors/bands,
unavailable/out-of-range cases, no invented feelings, injury certainty, complete
numeric/state/snapshot immutability, broker/fallback postcard/journal paths,
expressive choice, privacy of diagnostics and independent testimony. Existing
tests that specifically expected the old engineering prompt wording now assert
the new plain-language representation while retaining scientific/restart checks.

The existing scientific soma, public graph and persistence tests remain in the
full suite. Only `runner/grounded-prose-context.js` requires runtime deployment.
No public assets, configuration, schema, model settings or stored state change.
