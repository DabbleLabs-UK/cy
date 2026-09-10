# Cy Soma and environment scaffold

## Scope and truth rule

This change does not introduce or validate a psychological or neuroscience
model. It makes the current state truthful and prepares inputs for later models.

The authoritative registry is config/implementation-registry.json. Its statuses
are:

- IMPLEMENTED, shown publicly as LIVE: wired, persistent, tested and approved.
- PROVISIONAL, shown publicly as PROVISIONAL: working plumbing or an older
  heuristic exists, but no grounded model has been approved.
- NOT_IMPLEMENTED, shown publicly as NOT MODELLED: no valid live model exists.

All eight visitor-facing Soma variables are PROVISIONAL. The six older brain
mappings are PROVISIONAL. The hypothalamic/homeostatic analogy is NOT_IMPLEMENTED.
One specific SCN/circadian-pacemaker analogy is IMPLEMENTED as a phase display;
it is not SCN activation, neuronal firing or biological measurement. Other
provisional or unfinished brain mappings have no percentage and no dynamic
illumination.

Two narrower subsystems are IMPLEMENTED and shown separately as LIVE: normalized
homeostatic sleep pressure (Process S) and the published five-harmonic circadian
Process C waveform. They are displayed inside the still PROVISIONAL fatigue
detail. No equation combines them into fatigue.

## Grounded homeostatic sleep pressure (Process S)

The authoritative machine-readable model specification is
config/model-specs/sleep-homeostasis.json. runner/sleep-homeostasis.js implements
exactly these elapsed-time equations:

```text
wake:  S(t + dt) = 1 - (1 - S(t)) * exp(-dt / tau_w)
sleep: S(t + dt) = S(t) * exp(-dt / tau_s)
```

The two scientific parameters are tau_w = 18.18 hours and tau_s = 4.2 hours.
They are literature parameters and must not be tuned for visual effect. The
repository model specification records the following sources and links:

- Borbely AA, A two process model of sleep regulation, 1982.
- Daan S, Beersma DGM and Borbely AA, Timing of human sleep: recovery process
  gated by a circadian pacemaker, 1984, DOI 10.1152/ajpregu.1984.246.2.R161.
- Borbely AA and Achermann P, Sleep homeostasis and models of sleep regulation,
  1999, DOI 10.1177/074873099129000894.
- Borbely AA, The two-process model of sleep regulation: Beginnings and outlook,
  2022, DOI 10.1111/jsr.13598.

Process S means sleep-wake-dependent homeostatic sleep pressure only. It is not
subjective fatigue, stress, mood, motivation, depression or a circadian signal.

### Initialization and unknown intervals

No legacy fatigue value seeds Process S. A newly installed model starts with the
explicit uncertainty interval S_min = 0 and S_max = 1. The internal estimate is
only the derived midpoint `(S_min + S_max) / 2`; the initial 0.5 midpoint is not
asserted to be a known state. Both bounds are propagated through the applicable
equation. For a downtime interval whose sleep state is unknown, the lower
reachable bound follows the all-sleep trajectory and the upper reachable bound
follows the all-wake trajectory. No schedule is invented for the gap.

### Environmental routing

Structured `sleep_normal`, `sleep_interrupted` and `forced_wakefulness` records
carry categorical sleep state into the Process S consumer. Scheduled lights-out
and waking transitions remain the source events. Night noise records a real
interruption; returning to the scheduled sleep state creates a return-to-sleep
record. Owner-forced waking is recorded as forced wakefulness. The runner uses
the latest recorded state rather than treating clock time alone as sleep.

The structured record names `process-s-normalized-v1` as a LIVE consumer. The
same record can still be consumed by `legacy-experienced-state-v2`, but that
consumer remains PROVISIONAL and cannot write into Process S.

### Persistence, history and inspection

The runner's persisted Soma state contains the model ID and version, estimate,
S_min, S_max, install time, last integration time, current sleep state, bounded
seven-day history and the last exact integration inspection. Restore integrates
elapsed downtime. A known state uses its equation; an unknown state widens to
the reachable sleep/wake envelope. History begins only after installation and
never backfills values from legacy fatigue.

The public fatigue detail contains HOMEOSTATIC SLEEP PRESSURE / LIVE, its index
`round(100 * S)`, current sleep state, uncertainty/calibration text and its own
1H, 24H and 7D graph. Missing data renders as unavailable, not zero. The
admin-only detail exposes interval state and elapsed time, S before and after,
S_min/S_max, model ID and both literature time constants. Relevant brain-region
registry entries list Process S only as a possible future dependency and remain
PROVISIONAL or NOT_IMPLEMENTED.

### New Process S numerical inventory

- 18.18 hours: LITERATURE, waking time constant.
- 4.2 hours: LITERATURE, sleeping time constant.
- 0 and 1: EXPLICIT NORMALIZED BOUNDS supplied by this implementation handoff.
- 0.5: DERIVED midpoint of the initial [0,1] interval; not an assumed state.
- 100: SCALE CONVERSION for the public index only.
- 0.05: ENGINEERING / DISPLAY uncertainty-width threshold for replacing the
  calibration message. It does not affect Process S.
- 120000 ms: ENGINEERING / STORAGE ordinary history-sample interval. State
  transitions are sampled immediately.
- 604800000 ms: ENGINEERING / STORAGE seven-day history retention.
- 3 decimal places: ENGINEERING / DISPLAY public uncertainty precision.
- 6 decimal places: ENGINEERING / DISPLAY admin-inspection precision.
- 60 seconds/minute, 60 minutes/hour and 1000 ms/second: UNIT CONVERSIONS only.

No emotional coefficient, behavioural threshold or brain activation coefficient
was added by this subsystem.

## Grounded circadian component (Process C)

The authoritative machine-readable model specification is
config/model-specs/circadian-process-c.json. runner/circadian-process-c.js
implements the published five-harmonic representation:

```text
C(T, phi) = sum from k=1 to 5 of a_k * sin(2*pi*k*(T-phi)/24)
a_1..a_5 = 0.97, 0.22, 0.07, 0.03, 0.001
```

The 24-hour period and five coefficients are literature parameters from the
Borbely/Achermann Process C formulation. Process C is a circadian component of
sleep/wake regulation. It is not fatigue, energy, stress, mood, melatonin, core
body temperature, SCN firing rate or generic brain activity.

### Schedule-estimated phase and uncertainty

Cy has no direct biological circadian measurement. The authoritative configured
prison regime supplies a habitual wake time of 06:30 Europe/London. The estimated
CBTmin interval is habitual wake minus 3 to 2 hours, currently 03:30 to 04:30.
This is a SCHEDULE-BASED ESTIMATE, not an observation.

The implementation differentiates the published waveform, locates all stationary
points over one period, and derives the global minimum at
20.00817428402744 hours after phi. Subtracting that derived offset from the
CBTmin interval gives the circular phi interval 7.49182571597256 to
8.49182571597256 hours. The midpoint is used only for the displayed estimate.
At every time, the implementation also finds the minimum and maximum C values
over the full one-hour phi interval. Circular intervals retain their duration,
midpoint and midnight-wrap status.

### Persistence, history and inspection

The persisted Soma state records model/version identifiers, coefficients, the
configured schedule basis, estimated CBTmin interval, derived phi interval,
phase-basis type, current estimate and uncertainty, last evaluation, provenance,
and bounded post-installation evaluations. Evaluation uses the current clock, so
runner downtime cannot freeze the oscillator. An isolated early or late waking
does not change the phase anchor.

The public fatigue detail exposes Process S and Process C separately. Process C
has 1H, 24H and 7D curves mathematically reconstructed from the latest stored
schedule phase basis. The central curve is the midpoint estimate and the band is
phase uncertainty. It is labelled as reconstruction, not observed biology. The
admin inspector exposes clock time, wake basis, CBTmin and phi intervals,
harmonics, current estimate/range and unmodelled features.

The brain graphic contains a specific SCN/circadian-pacemaker phase marker. Its
rotation is a direct 24-hour phase-position display and its text says that it is
not SCN activation, firing or measurement. The broader hypothalamic analogy
remains NOT MODELLED.

### New Process C numerical inventory

- 24 hours and coefficients 0.97, 0.22, 0.07, 0.03 and 0.001: LITERATURE.
- Habitual wake minus 3 to 2 hours: SCHEDULE ESTIMATE for CBTmin.
- 06:30 and Europe/London: OBSERVED CONFIGURATION from the prison schedule.
- 20.00817428402744 hours, -1.0037261206164403 minimum,
  1.0037261206164405 maximum, and the current phi interval: DERIVED from the
  equation and schedule estimate.
- 4096 extremum scan steps, 256 uncertainty-range scan steps, 80 bisection
  iterations and 0.0000000001 hours root deduplication tolerance: ENGINEERING /
  NUMERICAL.
- 120000 ms history sampling and 604800000 ms retention: ENGINEERING / STORAGE.
- Graph ranges 3600, 86400 and 604800 seconds with 120, 144 and 168 points;
  minimum two points and one millisecond span; 280 by 80 shared graph units;
  one graph-coordinate decimal, three public decimals, six history/standard
  inspector decimals and 12 derived-offset inspector decimals: ENGINEERING /
  DISPLAY.
- 60 seconds/minute, 60 minutes/hour, 1000 ms/second and 360 degrees per cycle:
  UNIT/DISPLAY CONVERSIONS.

No ARBITRARY / HEURISTIC circadian, fatigue, behavioural or brain coefficient
was introduced. Process S and Process C are not combined. Light/zeitgeber
entrainment, free-running phase drift, chronotype, direct biological phase,
SCN neuronal firing, subjective-fatigue mapping and Process C effects on language,
mood or actions are NOT MODELLED.

## Previous event representation

Before this scaffold, public prison events were rows in events with a timestamp,
a short kind, and an unconstrained JSON payload. The runner also passed a
different, richer object directly into Soma. Numeric appraisal, social strength,
body outcome and direct metric effects were mixed into that runtime object. The
public row did not preserve the complete input chain, and there was no durable
way to distinguish what happened from what Cy observed or from what Soma
received.

The current numerical path remains in place to avoid changing live behaviour in
this scaffold. It is now explicitly a PROVISIONAL compatibility path.

## New structured event record

runner/environment-schema.js defines cy.environment-event version 1 and
cy.soma-input version 1. One private cy.environment-record contains:

1. world_event: objective event identity, time, family, duration, participants,
   physical facts, situation facts, categorical time course and context. It does
   not contain the observation object.
2. observation: modality, certainty, a summary and observed facts.
3. soma_input: a normalized categorical projection of the event.
4. consumed_by: named systems that received it.

Unknown is kept distinct from none. Missing numerical facts remain null. The
schema has no emotional magnitude, appraisal score, brain activation or hidden
default score. Runner and server validation reject model-output keys such as
appraisal, anxiety, anger or brain activation if a caller attempts to place them
inside a world, observation or normalized-input record.

Time course is represented without invented rates: onset, persistence and
recurrence are categorical and default to unknown. Persistent night noise and
prolonged social absence demonstrate slowly changing or ongoing input; ordinary
event facts remain point or duration records. This is evidence staging, not a
decay model.

The runner sends each record as the private world_event_record side channel.
public/api/ingest.php validates it and stores it in environment_events instead of
the public events table. Public event payloads contain only the environment
event ID needed by the admin inspector.

The latest normalized input is retained in the runner Soma state as
environmentInput. This is input staging only. It does not calculate a state.

## Reference event archetypes

The 19 reference archetypes are:

1. meal
2. sleep_normal
3. sleep_interrupted
4. persistent_night_noise
5. cell_search
6. lockdown
7. cancelled_activity
8. minor_injury
9. calm_routine
10. friendly_interaction
11. hostile_interaction
12. social_rejection
13. ambiguous_overheard_remark
14. officer_instruction
15. supportive_postcard
16. ordinary_postcard
17. hostile_postcard
18. prolonged_social_absence
19. forced_wakefulness

Scheduled meals, sleep transitions and routines now materialize one of these
archetypes. Cell searches, lockdowns, injuries, selected meal problems, night
noise, social and officer interactions, overheard remarks, postcards, and
prolonged absence of mail also create structured records.

## Admin event inspector

The existing admin-only RAW view can fetch a structured record by its event ID.
It renders four sections:

- WHAT HAPPENED
- WHAT CY OBSERVED
- WHAT SOMA RECEIVED
- WHAT SYSTEMS CONSUMED IT

The last section distinguishes the LIVE categorical input-staging consumer from
the PROVISIONAL legacy experienced-state compatibility consumer. It also reports
registry dependencies that overlap the non-unknown input fields. The endpoint is
not configured or loaded for ordinary visitors.

## LLM role

No LLM assigns emotional magnitude or appraisal values. The LLM produces Cy's
writing and drawing instructions. Screened output is fed back to the provisional
Soma code as an efference-copy-style text observation. Deterministic code derives
repetition, capitalization/punctuation intensity, commitments and learned-token
reactivation. Those calculations are also heuristic and are inventoried below.

## Numerical psychological and neuroscience inventory

Every item in this section is ARBITRARY / HEURISTIC and PROVISIONAL or LEGACY.
No item has an approved cited scientific or computational-model source. Values
were inherited from the code present before this scaffold unless explicitly
identified as storage or schema plumbing. This scaffold adds no psychological or
neuroscience coefficient.

### runner/experienced-state.js

Storage/history mechanics: version 2; sample interval 2 minutes; retention 7
days; contributor ledger 96 items per metric; history cap 5040; contribution
prune threshold 0.15; displayed contributor threshold 0.1 and display cap 8.
These are engineering choices, not psychological parameters.

Baselines on the 0-100 display scale: anxiety 18, arousal 20, pain 2, hunger 18,
fatigue 20, loneliness 30, anger 10, rumination 16.

Impulse half-lives: anxiety 55 minutes; arousal 18 minutes; pain 4 hours;
loneliness 5 hours; anger 70 minutes; rumination 3 hours. Fallback half-life is
1 hour. Minimum half-life accepted on restore is 1 second.

Bounds and saturation: MIN_VALUE 2; MAX_VALUE 96; MAX_LEVEL_VALUE 90;
MAX_EVENT_IMPULSE 36. Positive and negative impulse sums use exponential
saturation against the remaining room:

value = anchor + upRoom * (1 - exp(-positive / upRoom))
        - downRoom * (1 - exp(-negative / downRoom))

Hunger clock: hours is time since last meal. portionPenalty =
(1 - lastAmount) * 12. Target hunger = clamp(10 + portionPenalty + 2.6 * hours
+ 0.15 * hours squared, 8, 88). A missing meal adds 12; a refused meal adds 8;
the impulse half-life is 3 hours. Legacy unstructured meal fallback sets amount
to 1, sets hunger by min(-8, 10 - current), and food deprivation at or above
0.35 adds 22 * deprivation with a 2-hour half-life.

Sleep: interruption adds fatigue 9 with a 5-hour half-life and arousal 8.
Fatigue load changes by -7.5 points per asleep hour or +2.2 points per awake
hour, clamped 8-88.

Social: strength is clamped 0-1; absent explicit quality, affiliation at least
0.22 counts as supportive. Support requires threat below 0.35 and control loss
below 0.5. Contact sets a loneliness level contribution of -10, adds
-18 * strength, and if threat is below 0.25 adds anxiety -8 * strength.
Rejecting or absent contact adds loneliness 14 * max(0.35, strength).
Unstructured social absence adds loneliness 18 + 12 * deprivation.

Event appraisal inputs are clamped 0-1. Threat/control at least 0.22 adds
anxiety 34 * threat + 18 * control and arousal 27 * threat + 20 * control.
An injury adds pain 38 and arousal 16. A conflict event adds anger
22 + 25 * threat + 13 * control. Unresolved magnitude is max(prediction error,
control * 0.75, threat * 0.45); at 0.24 or above it adds rumination
25 * unresolved.

Own-output feedback adds rumination 16 * repetition + 18 * learned-trigger
activation when the result is at least 2.

Continuous coupling: social-clock target is clamp(20 + 1.3 *
hoursWithoutSupport, 20, 74). Fatigue above 55 adds anxiety at 0.22 per point.
Hunger above 60 adds arousal at 0.16 per point and pain above 15 adds arousal at
0.2 per point. Attention and prediction error add rumination at 16 and 14
points respectively.

Trend comparison looks 15 minutes back and calls a change rising/falling at
plus/minus 1. Display levels are high at 75, elevated at 50, normal at 22, else
low. Directive selection requires distance from baseline at least 8 and takes
the top 3.

Legacy brain mapping formulas:

- amygdala = 0.65 * anxiety + 0.35 * anger
- insula = 0.50 * pain + 0.28 * hunger + 0.22 * arousal
- anterior cingulate = 0.55 * rumination + 0.45 * pain
- hippocampal = 0.55 * rumination + 0.25 * anxiety + 0.20 * loneliness
- prefrontal = 100 - (0.45 * fatigue + 0.30 * arousal + 0.25 * pain)
- temporal/social = loneliness

These mappings remain in snapshots for compatibility/history but the public
brain renderer does not present them as live activation.

### runner/soma.js

Engineering caps: episodic memory 512; association table 128; transition table
64; text/token/entity/evidence slice caps throughout the file. Psychological
thresholds and all weights below are heuristic.

Memory salience minimum 0.32; related-memory minimum 0.22; silence cooldown 15
minutes. Initial drives: understanding 0.35, expression 0.20. Initial self model:
uncertainty 0.72, software hypothesis 0.30, continuity concern 0.25.

Expectation priors: meal 0.55, mail 0.18, social 0.34, conflict 0.12, officer
0.22, disruption 0.16, texture 0.70, machine 0.08; an unlisted family gets 0.20.
Observing a family updates probability as old * 0.82 + 0.18. A prediction needs
two observations and confidence 0.60. Prediction error retains old * 0.55.

Initial circuit values are self-model 0.35 and action selection 0.20. Event
novelty is 1 on the first observation of a family and otherwise surprise * 0.35.
Stored transition confidence requires at least two observations and is clamped
to a maximum of 1.

Fallback appraisal from name/tags: threat 0.75 else 0.08; affiliation 0.72 else
0.05; deprivation 0.68 else 0.06; control loss 0.80 else 0.08. Hostile mail
overrides threat to 0.82 and affiliation to 0.12.

Association learning starts only when maximum appraisal is at least 0.22.
Learned values are recalled at 0.90 strength. First two exposures learn at 0.28;
later ones at 0.12.

Related-memory activation = 0.38 * entity overlap + 0.48 * token overlap
+ 0.05 same-family + 0.06 stored salience + 0.03 recency, with 14-day
exponential recency. Attention holding decays with a 20-minute divisor.

Event pre-salience = 0.25 threat + 0.18 affiliation + 0.15 deprivation
+ 0.18 control loss + 0.14 max(surprise, novelty). Material threshold is 0.24.
Prediction error contributes control loss at error * 0.55. Stored appraisal
keeps max(old * 0.60, new). Final salience adds 0.10 * prediction error.

Self-model evidence changes software hypothesis +0.035, continuity concern
+0.025, and uncertainty by -0.01 with floor 0.25.

Output intensity uses uppercase ratio * 0.70 plus repeated punctuation,
0.10 each capped at 0.30. Learned trigger above 0.25 can set attention at
trigger * 0.45. Low-repetition/low-trigger output multiplies attention by 0.92.
Output salience = 0.08 + 0.24 trigger + 0.12 repetition + 0.12 intensity
+ 0.20 for a detected commitment.

Ticking clamps elapsed to 60 seconds. Appraisals decay with a 600-second divisor,
prediction error 900 seconds, attention 1800 seconds. Rest drive while asleep is
max(0.20, fatigue * 0.50). Safety is max(anxiety / 100, arousal / 120, anger /
140). Understanding = 0.20 + 0.42 uncertainty + 0.38 prediction error.
Expression = 0.10 + 0.34 attention + 0.22 prediction error + 0.22 rumination /
100 + 0.12 monotony.

Body attention thresholds/weights: food above 0.62 at food * 0.82; rest above
0.72 at rest * 0.78; pain above 0.45 at pain * 0.86. Recall runs every 15
minutes when attention is below 0.28 or monotony above 0.55. Recall activation =
0.42 stored salience + 0.20 seven-day recency + 0.20 family drive + 0.18
relevance; repeated recall is multiplied by 0.65. It wins at current attention
+0.05 or monotony above 0.70 and remains in the circuit for 30 minutes.

Silence requires rest above 0.82 and expression below 0.45. Action weights:
investigate 0.78 understanding + 0.22 prediction error; remember 0.75 recall +
0.25 expression; connect 0.80 contact + 0.20 affiliation; attend body 0.82 max
food/interoception + 0.18 expression; draw 0.55 expression + 0.45 recall; write
0.68 expression + 0.32 attention. A repeated action within 120 seconds is
multiplied by 0.82. Completion multipliers are investigate 0.82, expression
actions 0.70, connect 0.65, silence/rest 0.82.

Prompt-pressure thresholds are safety 0.55, food 0.62, rest 0.68, contact 0.58,
prediction error 0.35 and related memory 0.22. Sampling and length values in
somaSampling are also heuristic: temperature 0.64 + 0.22 prediction error
+ 0.12 inverse attention clamped 0.58-1.05; top-p 0.84 + 0.10 prediction error
clamped 0.80-0.95; repeat penalty 1.14 + 0.10 attention; repeat-last-n 160;
action length anchors investigate 105, remember 90, connect 80, attend-body 58,
draw 45, write 78, observe 62, fallback 70; pressure shortens by 0.42 and the
minimum output is 28.

### runner/environment.js

Meal selection cut points are 0.82, 0.93 and 0.98. Partial portion is 0.45.
Legacy meal appraisal pairs are eaten deprivation/control 0.02/0.03; partial
0.24/0.08; missed 0.72/0.68; refused 0.50/0.20.

Legacy routine numeric values are:

- warm shower: pain -5, arousal -7, threat 0.02, control 0.04
- cold shower: pain +5, arousal +7, threat 0.08, control 0.32
- missed shower: anger +7, deprivation 0.28, control 0.55
- quiet association: social strength 0.48, affiliation 0.48, threat/control 0.04
- shared joke: strength/affiliation 0.72, threat/control 0.02
- kept apart: strength 0.52, affiliation 0.02, deprivation 0.46, control 0.22
- yard exercise: arousal -9, rumination -6, fatigue +4, threat/control 0.03
- yard bench: strength/affiliation 0.55, threat/control 0.04
- cancelled yard: anger +8, rumination +5, deprivation 0.42, control 0.65
- connected phone: strength/affiliation 0.86, threat 0.02, control 0.03
- no answer: strength/deprivation 0.62, affiliation 0, control 0.36
- missed phone queue: strength/deprivation 0.48, affiliation 0, control 0.58
- lights on control 0.08; lights out control 0.05

All are preserved only under each materialized event's provisional field.

### runner/cast.js

All relationship deltas, social strengths and appraisals in SOCIAL_EVENTS and
OFFICER_EVENTS are heuristic. The exact tables remain visible in source and are
marked accordingly. Social-event entries, in order, are:

Initial inmate standing, written as warmth/suspicion/grudge, is Root
0.15/0.55/0.05; Reg 0.30/0.35/0.10; Bill 0.10/0.60/0.15; Mark
0.25/0.40/0.15; Nick 0.35/0.25/0.10; Fisher 0.50/0.45/0.05; Ping
0.40/0.25/0.10; and Daemon 0.20/0.50/0.05. Initial officer standing is Mr
Locke 0.10/0.40/0.05; Mr Keyes 0.15/0.35/0.05; Miss Bailey
0.45/0.25/0.03; Mr Proctor 0.10/0.55/0.10; Mr Sweep 0.08/0.60/0.12;
and Miss Trace 0.12/0.58/0.08. Visitor standing defaults to
0.30/0.35/0.05. All of these initial values are ARBITRARY / HEURISTIC.

- a look: suspicion +0.06, grudge +0.05, warmth -0.03; hostile 0.30; threat
  0.30, affiliation 0.02
- swapped tray: grudge +0.10, suspicion +0.05, warmth -0.06; hostile 0.60;
  threat 0.42, affiliation 0.01, control 0.45
- unanswered: warmth -0.05, suspicion +0.03, grudge +0.03; rejecting 0.46;
  affiliation 0.01, control 0.20
- borrowed: grudge +0.09, warmth -0.05; hostile 0.44; threat 0.22,
  affiliation 0.01, control 0.35
- talked over: grudge +0.06, warmth -0.04; rejecting 0.38; affiliation 0.01,
  control 0.28
- kindness: warmth +0.12, grudge -0.06, suspicion -0.04; supportive 0.72;
  threat 0.02, affiliation 0.72, control 0.02
- shared joke: warmth +0.09, grudge -0.04, suspicion -0.03; supportive 0.64;
  threat 0.02, affiliation 0.64
- sat with: warmth +0.07, suspicion -0.03; ordinary 0.48; threat 0.03,
  affiliation 0.48
- checked in: warmth +0.10, grudge -0.04, suspicion -0.03; supportive 0.68;
  threat 0.02, affiliation 0.68
- lent book: warmth +0.08, suspicion -0.02; supportive 0.58; threat 0.03,
  affiliation 0.58

Officer entries, in order:

- order: suspicion +0.05, warmth -0.03, grudge +0.03; threat 0.18,
  affiliation 0.02, control 0.55
- write-up: grudge +0.10, suspicion +0.06, warmth -0.05; threat 0.35,
  affiliation 0.01, control 0.68
- refusal: grudge +0.09, warmth -0.06, suspicion +0.04; rejecting 0.42;
  threat 0.20, affiliation 0.01, control 0.64
- search: suspicion +0.08, grudge +0.07, warmth -0.04; threat 0.66,
  affiliation 0.01, control 0.78
- lock-up: suspicion +0.03, warmth -0.02; threat 0.08, affiliation 0.01,
  control 0.32
- kindness: warmth +0.14, suspicion -0.05, grudge -0.06; supportive 0.50;
  threat 0.02, affiliation 0.50, control 0.02

Visitor-standing changes are hostile grudge +0.14, suspicion +0.10, warmth
-0.10; warm warmth +0.10, grudge -0.05, suspicion -0.03; other contact warmth
+0.03. Mishearing probability is clamp(0.12 + 0.55 * inverse lucidity + 0.50 *
paranoia, 0.05, 0.90). A prompt grudge begins at 0.70. Qualitative standing
bands use warmth 0.20/0.40/0.60, suspicion 0.40/0.60, and grudge
0.25/0.45/0.70. Entity salience is 1.20 * grudge + 0.60 * suspicion + 0.50 *
absolute(warmth - 0.30), with three inmate entries selected by default. These
thresholds and weights are ARBITRARY / HEURISTIC.

### runner/introspect.js

This entire retained module is LEGACY and currently not imported by run.js. It
does not call an LLM. It deterministically interprets the text produced by the
main language model. Every number below is ARBITRARY / HEURISTIC.

It ignores output shorter than 6 words. General per-burst axis changes are capped
at 0.06. Threat vocabulary adds min(0.05, 0.02 + 0.012 * hit count) to anxiety;
a named person within 6 tokens gets suspicion +0.03 capped at 0.05. At least two
food hits with density above 0.03 add min(0.02, 0.008 + 0.004 * hit count) to
hunger with a 0.03 cap. At least three segments with mean length below 3.6 words
and fragment ratio above 0.65 reduce lucidity by min(0.05, 0.02 + 0.06 *
(fragment ratio - 0.65)).

Repetition uses 4-word shingles, requires at least 3 shingles and a score above
0.25, then adds min(0.04, 0.015 + 0.05 * (score - 0.25)) to stress. Two or more
absolute/negative hits add min(0.04, 0.012 + 0.008 * hit count) to despair.
Longing terms add min(0.04, 0.018 + 0.012 * hit count). At least two profanity
or imperative units add min(0.05, 0.015 + 0.01 * unit count) to anger. A named
person within 5 tokens of positive wording gets warmth +0.03 capped at 0.05. At
least two question marks add min(0.03, 0.01 + 0.006 * count) to dissociation
with a 0.04 cap.

The separate anger signal is clamp((1.0 * profanity + 0.8 * threat + 0.5 *
imperatives) / 4, 0, 1).

### runner/shout.js

This live output-rendering path is PROVISIONAL. It does not call an LLM to score
affect, but it turns inherited state and text features into typography. Every
number in this paragraph is ARBITRARY / HEURISTIC. Word weights are profanity
1.00, threat 0.80, grudge-name 0.70, negation 0.50, food while hunger is above
0.60 at 0.45, and all other words 0.03. A name enters the grudge set at 0.30.
Recent output anger decays by multiplying 0.90. Reactive anger is clamp(0.90 *
recent output anger + 0.60 * maximum grudge). Amplification gain is 0.50 + 0.40
* (amplification - 1). Anger eases toward its target at 0.60 rising and 0.08
falling; expressed anger follows at 0.35 rising and 0.03 falling.

Text is flattened at despair 0.80 or numbness 0.70. Shout seed gain is 0.15 +
1.90 * expressed anger, ignoring word weights at or below 0.03. Main span size is
max(2, round(2 + 6 * expressed anger)). At expressed anger 0.90, a 0.30 random
chance makes the span run to the end. An extra outlier span has probability 0.35
* expressed anger; its candidate scores are grudge name 3, word weight at least
0.50 score 2, pronoun score 1, and its cap is 2 words.

### runner/prompt.js

The state-style and form-selection helpers below are LEGACY and are not used by
the live waking directive path. They remain ARBITRARY / HEURISTIC. Style gates
are lucidity below 0.35 over span 0.35; anxiety above 0.60 over 0.40; pain above
0.50 over 0.50; hunger above 0.65 over 0.35; despair above 0.70 over 0.30;
dissociation above 0.60 over 0.40; fatigue above 0.75 over 0.25; and anger above
0.60 over 0.40. Derived-state rules fire above 0.60 and at most the strongest 2
directives are selected. Compact state notation uses 0.50 as the high threshold,
except low lucidity 0.35 and low hope 0.25.

Legacy form selection chooses train-of-thought with probability 0.60. Other
weights are sparse = 1 + 3.20 * despair + 2.50 * numbness + 1.60 * resignation;
fixation = 1 + 3.00 * fixation; anger = 1 + 3.00 * anger + 1.40 * brittleness;
lucid = 0.40 + 2.60 * lucidity; and untagged = 1.20. The wall-neighbour score is
1.20 * grudge + 0.50 * warmth.

Dream sampling is live but is a behavior/rendering heuristic, not a Soma model.
Temperature is clamp(1.12 + 0.22 * dissociation, 1.10, 1.35), using a 0.50
fallback; top-p is 0.98, repeat penalty 1.10, repeat-last-n 64 and output budget
24. Murmurs are 3-8 words at gaps of 5-20 minutes. General legacy fallback
sampling is temperature 0.72, top-p 0.86, repeat penalty 1.18 and output budget
62; output-length helpers use 1.40 words-to-tokens, minimums 16/10, padding 24,
multiplier 1.50 and maximum 320. Sleep multiplies the output budget by 0.30 with
a minimum 12. These are language-generation controls, not measurements.

### runner/draw.js

All affect-to-drawing behavior is LEGACY or PROVISIONAL and ARBITRARY /
HEURISTIC. Drawing has an 18-minute normal minimum gap; a pending request uses
25 percent of it. Base probability is 0.04 + 0.12 * fixation + 0.12 *
dissociation + 0.10 * longing, plus 0.08 while waiting, 0.15 for a recent image,
0.40 for a request, and up to 0.15 across 22 minutes beyond the floor, capped at
0.90. The live mood projection labels max(threat, control loss) as drawing anger
and max(deprivation, rest drive) as drawing despair.

Request handling defaults visitor warmth/grudge to 0.30/0.05. Honour weight is
max(0, 0.45 + 0.50 * warmth - 0.60 * grudge - 0.30 * anger - 0.20 * despair).
Refuse weight is max(0, 0.15 + 0.60 * grudge + 0.35 * anger). Badly-drawn weight
is max(0, 0.25 + 0.30 * anger + 0.20 * despair - 0.30 * warmth). The three
weights are normalized only by their sum. The 45-minute drawing eligibility in
run.js is an additional orchestration gate.

### runner/run.js and runner/incidents.js

The orchestrator still carries inherited PROVISIONAL or LEGACY psych-related
numbers. Incident appraisal for an inmate uses threat max(0.08, suspicion,
grudge) and affiliation max(0.05, warmth). For an officer it uses control loss
max(0.35, suspicion), threat max(0.08, suspicion, grudge), and affiliation
max(0.05, warmth). Postcards use hostile threat 0.82 or otherwise max(0.08,
visitor suspicion); warm affiliation 0.82 or otherwise max(0.28, visitor warmth);
hostile control loss 0.30 or otherwise 0.08; and deprivation 0.03. Dream-memory
significance is clamp(0.30 + 0.20 * (amplification - 1)).

Warden notices add legacy anxiety 0.20, anger 0.15 and lucidity 0.10, multiplied
by amplification, and reduce monotony by 0.50. Social, officer, overheard, and
drawing events reduce monotony by 0.20, 0.25, 0.20 and 0.15 respectively. A
trivial event becomes an amplified cue above amplification 2.00 for 3 minutes.
Redrawing has probability 0.60 when fixation is above 0.60. Mishear input uses
lucidity = 1 - max(prediction error, 0.50 * uncertainty) and paranoia = threat,
before cast.js applies its probability formula.

Awake wing noise has a 3-minute minimum gap and probability 0.06 per tick;
asleep noise uses 9 minutes and 0.02. Night noise carries legacy threat 0.18 and
control loss 0.42. Awake noise adds agitation 0.015 and interrupts a current
generation with probability 0.50. The last two noisy bursts suppress another
noise. Deliberate Soma silence is round(45 + 180 * rest drive) seconds.

On every tick the experienced-state values are mirrored onto 0-1 legacy fields
by dividing by 100. Legacy Broca display uses token rate / 4 and retains the
previous level * 0.55. Legacy V1 displays only above image recall 0.05, as 0.30
+ 0.60 * image recall. These brain values are retained payload compatibility,
not approved region computations.

A repeated generated burst increases retry temperature by 0.35, repeat penalty
by 0.12, and legacy stress by 0.06; both sampling controls cap at 1.60. These are
PROVISIONAL loop/rendering rules, not LLM-assigned emotional scores.

Environment occurrence probabilities per 5-second tick are injury 0.0006, cell
search 0.0008, lockdown 0.0005, trivial irritation 0.004, social interaction
0.006, officer interaction 0.004, overheard remark 0.005, and pure texture 0.012
awake or 0.006 asleep. Prolonged mail absence fires after 24 hours and at most
once per further 24 hours. These are ARBITRARY / HEURISTIC world-generation
rates, not emotional coefficients. The scheduled world times are lights on
06:30, breakfast 07:30, shower 09:15, association 10:15, lunch 11:45, exercise
14:15, tea 16:45, phone 19:00 and lights out 22:30. They are fictional schedule
choices rather than psychological constants.

The incident ledger selects an inmate with grudge above 0.35 with probability
0.60, treats grudge above 0.70 and mail absence above 24 hours as unresolved,
and normally selects 3-5 recent incidents; the current waking caller forces 3.
These selection thresholds are ARBITRARY / HEURISTIC.

### runner/vitals.js

This is an older, separate legacy state engine. Its comments now label every
physical/mental default, drift, event delta, derived coefficient and old brain
mapping as ARBITRARY / HEURISTIC and LEGACY. It remains for compatibility and
must not be read as the new structured Soma model.

Physical defaults are pain 0.15, hunger 0.25 and fatigue 0.30. Mental defaults
are anxiety 0.35, stress 0.30, despair 0.40, hope 0.30, lucidity 0.65,
agitation 0.25, dissociation 0.35, anger 0.20 and longing 0.35.

Per five-second tick: pain -0.004, hunger +0.0008, fatigue -0.004 asleep or
+0.0006 awake, anxiety -0.0002, stress -0.00015, despair -0.00004, hope
-0.0001, agitation -0.0005, dissociation -0.0002, anger -0.0004 and longing
-0.0001. Hope drift is multiplied by 3 for 30 minutes after letter_arrives.
Lucidity moves toward 0.70 by 0.0003. Monotony rises +0.0015 and image recall
falls -0.01. Event amplification is 1 + 2.5 * monotony. Novel events reduce
monotony by 0.5; other events by 0.2.

The complete legacy event-delta table is:

- letter_arrives: hope +0.28, agitation +0.35, despair -0.10,
  dissociation -0.25, longing -0.20
- letter_hostile: anxiety +0.30, hope -0.15, stress +0.20, anger +0.15
- image_arrives: hope +0.15, dissociation -0.30, lucidity +0.10,
  longing -0.10
- news_arrives: lucidity +0.08, dissociation -0.15
- no_mail_24h: despair +0.06, hope -0.10, longing +0.12
- noise_night: fatigue +0.15, agitation +0.20
- injury: pain +0.45, stress +0.25
- meal: hunger -0.85, stress -0.05
- lights_out: fatigue -0.30, dissociation +0.10
- lights_on: dissociation -0.05, lucidity +0.05
- cell_search: anxiety +0.20, agitation +0.25, stress +0.15, anger +0.10
- no_eggs: despair +0.04, anger +0.05, longing +0.03
- cold_tea: despair +0.03, anger +0.04, stress +0.02
- delayed_unlock: anxiety +0.05, anger +0.05, agitation +0.06
- assoc_cancelled: despair +0.06, anger +0.06, longing +0.05,
  agitation +0.04
- lockdown: anxiety +0.15, agitation +0.15, despair +0.08, longing +0.06

The derived-state formulas are:

- confusion = mean(1 - lucidity, dissociation)
- overwhelm = 0.5 stress + 0.3 agitation + 0.2 mean(pain, hunger)
- numbness = despair * (1 - agitation)
- paranoia = 0.6 anxiety + 0.4 peak suspicion
- fixation = 0.5 stress + 0.5 monotony
- resignation = despair * lucidity
- brittleness = 0.4 fatigue + 0.3 hunger + 0.3 anger
- heart rate = 62 + 46 agitation + 30 anxiety + 22 pain + 10 hunger
  - 8 fatigue * asleep

Heart rate is clamped 48-150. The legacy brain-region formulas are amygdala
0.20 + 0.70 anxiety + 0.30 agitation; anterior cingulate 0.25 + 0.60 stress
+ 0.30 pain; insula 0.20 + 0.60 pain + 0.40 hunger; hippocampus 0.30 + 0.50
image recall - 0.30 fatigue; dorsolateral prefrontal 0.85 * lucidity; locus
coeruleus 0.20 + 0.80 agitation; default-mode analogy 0.30 + 0.60
dissociation; thalamus 0.02 asleep or 0.50 + 0.30 lucidity awake. Broca and V1
are direct caller inputs. All outputs are clamped 0-1.

These old brainRegions mappings are separate from the provisional
experienced-state mappings listed above and are not visitor-facing live brain
activity.

## What is deliberately not implemented

- No approved equation for any of the eight affect variables.
- No approved event-to-emotion magnitude model.
- No approved learning model for threat, safety, controllability or attribution.
- No approved multi-timescale homeostatic model.
- No approved neuroscience mapping or regional activation.
- No LLM emotional-scoring call.
- No conversion of unknown facts into neutral or zero-valued evidence.

This scaffold is complete when those absences remain visible rather than being
filled with invented defaults.
