# Persistent location, exercise regime, and cell searches

## Status and authority

`runner/location-regime.js` is the authoritative factual state machine for Cy's
physical location. Its state is stored inside the atomic sectioned-state checkpoint.
It does not infer emotion, subjective experience, biological state, or prose.

Locations are `CELL`, `EXERCISE_YARD`, and the transient
`WING_OR_LANDING`. Each transition records its time, reason, source environment
event, current regime activity, and transition provenance. A restart during a
transient movement is reconciled against the current regime window and creates
an explicit observation-gap record.

## Exercise regime provenance

The exact daily 14:15-15:15 exercise slot is classified
`FICTIONAL_HMP_THINKPAD_REGIME_CONFIGURATION`. The duration is informed only by
the GOV.UK statement that prisoners should be able to spend between 30 minutes
and one hour outside each day:

https://www.gov.uk/life-in-prison/prisoner-privileges-and-rights

This is not evidence that a real prison uses Cy's exact time or sequence.

While Cy is on the yard, autonomous journal, drawing, sleep, and cell-only
events are unavailable. Structured yard contact may update the existing factual
social-contact ledger. Quiet exercise is also a valid outcome and does not create
social contact.

## Cell-search episodes

A search is one persistent episode with factual stages:

1. `INITIATED`
2. `CY_INSTRUCTION`
3. `SEARCH_ONGOING`
4. `PROPERTY_RESULT`
5. `SEARCH_COMPLETE`
6. `AFTERMATH_OBSERVED`

Present searches reuse the existing deterministic `COMPLY`/`REFUSE` and, when
an existing stored object is involved, `HAND_OVER`/`WITHHOLD` opportunities.
Searches never invent property. `NOTHING_FOUND` is valid. During an off-screen
search Cy receives no direct observation and learns only from a later observable
aftermath. The general operational reference is the Ministry of Justice
Searching Policy Framework; the simulated search sequence is fictional:

https://www.gov.uk/government/publications/searching-policy-framework

## Engineering constants

These values are world-pacing heuristics, not scientific or policy parameters:

- search stage minimum: 15 seconds;
- yard observation interval: 15 minutes;
- retained exercise episodes: 14;
- retained observation gaps: 20;
- per-five-second-tick random cell-search chance: 0.0008;
- yard observation outcomes: quiet 0.35, company 0.25, conversation 0.25,
  avoided contact 0.15.

The ambient world generator retains its 45-minute cadence. When overdue, it may
start in a fairness slot ahead of another queued memory-formation call, but it
never interrupts an already running memory call or higher-priority reply work.
