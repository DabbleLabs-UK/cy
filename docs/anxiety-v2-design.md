# Anxiety v2 scalar model - design study (RESEARCH / DESIGN ONLY)

Status: DESIGN. Not implemented in production. Not wired into live Cy. Not deployed.
Scope: evaluate whether a defensible continuous-time Anxiety scalar can replace the
current active-threat categorical switch seen in the Soma replay harness.

---

## Part A - Executive summary (read this first)

**1. Can we defensibly build an Anxiety scalar?**
Partly. We can defensibly build a continuous-time *latent threat-anticipation load* scalar whose
inputs are all grounded (learned posteriors, imminence, uncertainty, controllability, resolution)
and whose *shape* over time is literature-supported. We cannot defensibly call it "Anxiety" in the
sense of "how anxious Cy feels", and we cannot source its time constants, weights, baseline or
thresholds from the literature - those do not exist as transferable published numbers. So: a
grounded scalar YES; a *scientifically parameterised anxiety magnitude* NO.

**2. What should the scalar represent?**
A **threat-anticipation load index**: a bounded latent quantity that rises with the currently
grounded expected-and-imminent adverse-outcome pressure and relaxes toward a floor when that
pressure is absent or resolved. It is explicitly NOT a predicted state-anxiety rating, NOT a felt
emotion, NOT a physiological measure. It is the same honesty posture the codebase already uses for
"predicted KSS is a population prediction, not felt sleepiness".

**3. Best candidate model.**
A single-state **leaky integrator driven by a grounded threat-drive term**:
`dL/dt = k_up * drive(t) * (1 - L) - k_down * (1 - drive(t)) * L`, where `drive(t)` is composed
only from existing grounded signals (posterior mean, hazard rate over an announced window,
uncertainty from posterior variance and world ambiguity, discounted by objective controllability),
and carryover/sensitisation is expressed through the learner's own posteriors rather than a bespoke
memory term. Structural form borrows the Rutledge (2014) leaky-integrator affect model and the
Ingre-Akerstedt continuous-time integration pattern already used for sleepiness. See Part D.

**4. Biggest scientific weakness.**
Every rate and weight in the model (`k_up`, `k_down`, the drive weights, the floor) is category B/C
(needs calibration / would be arbitrary). The anxiety literature gives the *sign and the qualitative
dynamics* but no transferable magnitudes, because its dependent variables (shock-expectancy ratings,
skin conductance, startle) are measured over seconds-to-minutes in lab paradigms and do not transfer
to Cy's hours/days world-event substrate. Any single trajectory we show will look believable but its
numbers are not earned.

**5. What extra data / calibration is needed.**
There is no external dataset to calibrate against. Calibration would be *subjective face-validity
tuning against the golden days* - i.e. Jody deciding a curve "looks right". That must be labelled as
such (category B), never as a fitted parameter. The only genuinely parameter-free ingredients are the
posterior mean/variance and the hazard rate, all of which Cy already computes.

**6. Whether to prototype it in replay.**
Yes, but only as an isolated replay-only experiment, and only to compare *shapes*, not to bless
numbers. A prototype is worth it because the whole point of the scalar is its trajectory, and a
trajectory is the one thing prose cannot convey. Recommended prototype: the Part D leaky integrator
plus the "threat-load only" simpler variant (Part F option 2), run over the six golden days with all
non-published constants printed and flagged. Do not prototype the "full predicted-anxiety-rating"
variant - it cannot be made honest.

**Bottom line recommendation:** build the scalar, but name it **threat-anticipation load**, keep the
active-threat categorical seam as the ground truth it rides on (hybrid, not replacement), and treat
all dynamics constants as openly-labelled calibration values. Do not ship a scalar that claims to be
Cy's felt anxiety.

---

## Part B - Starting from the current code

### B.1 The two existing "anxiety" representations

There are two, and they sit at opposite ends of the honesty spectrum. The replay harness exposes the
first; Jody wants to move toward something as principled as the second.

**(1) `runner/experienced-state.js` - the visitor-facing scalar Soma.**
This already *is* a scalar anxiety with continuous decay. `METRICS.anxiety` has `baseline: 18`,
`HALF_LIFE.anxiety = 55 min`, and the event impulse is `34*threat + 18*control` (lines 18, 29,
377). It decays via `Math.pow(0.5, age/halfLife)` and saturates through a soft-exponential clamp.
**This is exactly the "+0.27 anxiety" style model Jody rejects** - and the file says so itself at the
top: *"MODEL STATUS: PROVISIONAL. Every numerical psychological coefficient, threshold, baseline,
decay rate, clamp and brain-region weight in this file is ARBITRARY / HEURISTIC. None has an approved
scientific or computational model citation."* So a scalar with a half-life already exists; the
problem is purely that its numbers are invented and its inputs (a scalar `appraisal.threat` in
`[0,1]`) are themselves ungrounded.

**(2) `runner/current-defensive-context.js` - the grounded categorical seam.**
This is the LIVE/REPLAY grounded transition seam the brief refers to. It deliberately refuses to be
a scalar. Its `notModelled` list (line 328) names *'anxiety', 'fear intensity', 'salience ranking',
'perceived controllability'*. Its spec (`config/model-specs/current-defensive-context.json`) is even
more explicit: `not_modelled` includes *"weighted threat score", "salience score", "time decay",
"imminence score", "control score", "uncertainty score"*, and `state_lifecycle` states *"Changes only
when a structured environment record opens, updates or resolves a context. No time decay or
interpolation occurs between events."*

The replay labels in the brief map onto this seam's `temporalStatus`:

| Replay label      | `temporalStatus` (defensive context) |
|-------------------|--------------------------------------|
| QUIET             | RESOLVED / UNKNOWN / no active context |
| THREAT_IMMINENT   | IMMINENT / POTENTIAL with imminence facts |
| THREAT_ONGOING    | ONGOING                              |

The "immediate switch" behaviour the replay shows (lockdown -> THREAT_ONGOING instantly, resolution
-> QUIET instantly) is not a bug: it is the seam behaving exactly as specified. It has no dynamics
*by design*. That is the gap an Anxiety v2 scalar would fill - carefully.

Note: the labels QUIET / THREAT_ONGOING / THREAT_IMMINENT are **not** present anywhere in the runner
source. They are the replay harness's relabelling of `temporalStatus`. I could not find the six
golden-day fixtures or the replay harness itself as committed files in this repo (searched
repo-wide); this design therefore targets the documented input contract - environment records ->
`observeCurrentDefensiveContextRecord` - which is the real seam regardless of how the harness wraps
it. **Assumption flagged for Jody: confirm where the replay fixtures live so a prototype can consume
them directly.**

### B.2 Exact grounded inputs already available

Every input below already exists and is grounded. A candidate model should draw ONLY from these
unless a gap is unavoidable.

From `probabilistic-threat-learning.js` (Tzovara Beta-Bernoulli, `free_parameters: []`):
- `posteriorMean(alpha,beta)` - learned P(adverse outcome | cue), per cue x outcome class.
- `posteriorVariance(alpha,beta)` - **estimation uncertainty** about that probability (parameter-free).
- `resolvedObservations` - how much evidence backs the estimate.
- `outcomeSurprisal = -ln(p_before)` - information-theoretic surprise, already computed per trial.
- History of updates per cue/outcome (gives carryover / sensitisation *for free* - see B.3).

From `current-defensive-context.js` (per active context):
- `temporalStatus` in {POTENTIAL, IMMINENT, ONGOING, RESOLVED, UNKNOWN} - imminence / ongoing / resolved.
- `objectiveControllability` in {NONE, LIMITED, SUBSTANTIAL, UNKNOWN} - structured world fact.
- `worldAmbiguity` in {CLEAR, PARTIAL, AMBIGUOUS, UNKNOWN} - from observation certainty.
- `resolutionStatus` in {UNRESOLVED, RESOLVED_ADVERSE, RESOLVED_SAFE, UNKNOWN}.
- `outcomeStatus` in {occurred, did_not_occur, unknown}.
- `activeCues`, `learnedAssociations` (the attached posteriors), `active` flag, `openedAt`/`updatedAt`/`resolvedAt`.

From `action-outcome-contingency.js` (Beta-Bernoulli over action-conditioned outcomes):
- `delta_control = P(O | not-action) - P(O | action)` in `[-1,1]` - **learned action-outcome contingency**,
  with its own posterior variance. Observational, causal-limit flagged.

From `instrumental-agency.js`:
- `action_opportunity.available_actions` - what agentive options genuinely exist right now.

Event timing: every environment record carries `timestamp`; contexts carry `openedAt`/`updatedAt`/
`resolvedAt`. This is the clock a continuous-time model integrates over.

Observation gaps / UNKNOWN: represented explicitly as the `UNKNOWN` enum members above and, for the
sleep model, as intervals that "remain unknown and do not integrate". This convention must be honoured:
an unknown interval is not evidence of safety.

**Gap that would force a new input:** a *hazard rate* needs an announced or expected event *window*
(e.g. "search will happen this afternoon"). The current defensive context marks IMMINENT/POTENTIAL
but does not carry a numeric expected-time-of-arrival or window. Producing a build-up-before-threat
curve therefore requires the environment producer to emit an expected window (see Part G). Without it,
"anticipatory build-up" cannot be grounded and must not be faked.

### B.3 Carryover / sensitisation is already grounded

A key finding: repeated-threat carryover does NOT need a bespoke "sensitisation memory" term. When a
threat recurs and resolves adversely, the Tzovara learner's posterior mean for that cue rises and its
variance falls. So the *next* time the cue appears, the same drive function yields a higher, more
confident drive - producing a higher baseline/carryover as an emergent consequence of grounded
learning, not an invented decay parameter. This is the single most important reason a defensible
scalar is possible at all. Sensitisation should be expressed through the learner, not bolted on.

---

## Part C - Scientific search: literature findings

For each source: population / task / dependent variable / timescale / equation / parameters /
transferability / what Cy has or lacks.

### C.1 Tzovara, Korn & Bach (2018), PLOS Comp Biol - ALREADY IN CY
- Population/task: human Pavlovian fear conditioning.
- DV: skin conductance responses modelled as Bernoulli outcomes.
- Timescale: trial-by-trial.
- Model: Beta-Bernoulli; `alpha_t = alpha + u`, `beta_t = beta + (1-u)`; mean `a/(a+b)`;
  variance `ab/((a+b)^2 (a+b+1))`. `free_parameters: []`.
- Transferable: YES - already the backbone learner. Supplies grounded posterior mean, variance,
  surprisal with no free parameters.
- Cy has: this, fully. Cy lacks: nothing here.

### C.2 Abend (2023), Neurosci Biobehav Rev - threat imminence continuum - ALREADY CITED
- Conceptual review: anxiety symptoms as aberrant defensive responding along the *threat imminence
  continuum* (potential -> distal -> imminent threat -> circa-strike).
- DV / timescale: n/a (review).
- Equation/parameters: NONE. Explicitly qualitative.
- Transferable: the *ordering* of imminence stages (already encoded as `temporalStatus`). NOT a
  numeric scale. Cy's spec already states it "does not provide these software categories as a numeric
  biological scale".
- Cy has: the categorical ontology. Cy lacks: (correctly) any number attached to it.

### C.3 Bach lab - "Temporal Dynamics of Uncertainty Cause Anxiety and Avoidance" (Comp Psychiatry 2024, cpsy.105)
- Population/task: N=42; 30-second trials with uncertain-timing electric shocks (early- vs late-threat).
- DV: avoidance/escape decisions and self-reported fear/anxiety.
- Timescale: seconds (0-30 s within-trial).
- Model content: defines **hazard rate** = outcome probability given it has not yet occurred. Worked
  example: uncertain-threat discrete P = [.25,.25,.25,.25] -> hazard = [.25,.33,.5,1], cumulative
  hazard 2.08 vs 1.0 for certain threat. Finding: higher hazard rate is associated with higher
  self-reported fear/anxiety.
- Equation for anxiety itself: NONE. No fitted coefficients, no decay function.
- Transferable: the **hazard-rate formula is transferable and parameter-free** given an event window.
  The hazard-rate -> anxiety mapping is NOT transferable (no coefficient; lab seconds not life hours).
- Cy has: nothing yet (no event window). Cy lacks: an expected-window input (Part G).

### C.4 Grupe & Nitschke (2013), Nature Rev Neurosci - anticipatory anxiety / uncertainty
- Conceptual framework: intolerance of uncertainty, inflated threat estimation, hypervigilance,
  deficient safety learning drive anticipatory anxiety.
- Equation/parameters: NONE.
- Transferable: supports *uncertainty raises anticipatory anxiety* (sign only). Motivates including a
  posterior-variance / world-ambiguity uncertainty term. No magnitude.
- Cy has: posterior variance + `worldAmbiguity`. Cy lacks: a justified weight for them.

### C.5 Yamamori & Robinson (2023), Neurosci Biobehav Rev - ALREADY CITED
- Computational review of human fear and anxiety.
- Transferable: supports keeping prediction, uncertainty, approach-avoidance *computationally
  distinct* - i.e. an argument AGAINST collapsing everything into one scalar. Reinforces the hybrid
  recommendation.

### C.6 Maier & Seligman (2016) / Maier & Watkins (2010) / Huys & Dayan (2009) / Dorfman & Gershman (2019) - ALREADY CITED
- Controllability literature already underpinning `action-outcome-contingency.js`.
- Transferable: *controllability reduces the anxiety/defensive response* (sign and direction). Huys &
  Dayan give a Bayesian control formulation; Cy deliberately implements only the simpler
  action-conditioned evidence substrate. No coefficient for "how much control reduces anxiety".
- Cy has: `delta_control`, `objectiveControllability`. Cy lacks: a justified discount weight.

### C.7 Rutledge et al. (2014), PNAS - momentary subjective well-being (leaky integrator)
- Population/task: probabilistic reward task; N in the core study, replicated in **18,420**
  participants; fMRI striatal correlate.
- DV: momentary happiness self-report.
- Timescale: trial-by-trial (tens of seconds).
- Model (verbatim structure): Happiness_t = w0 + w1 * sum_j gamma^(t-j) CR_j
  + w2 * sum_j gamma^(t-j) EV_j + w3 * sum_j gamma^(t-j) RPE_j, with forgetting factor gamma in [0,1].
- Parameters: w0..w3 and gamma **fitted to happiness in a reward task**.
- Transferable: the **functional form is transferable** (exponentially-discounted weighted sum of
  grounded event terms = a leaky integrator). The **coefficients are NOT** transferable (positive
  valence, reward domain, seconds timescale). This is the single best structural precedent for an
  affect scalar built from grounded terms - and a clean illustration of "borrow the shape, not the
  numbers".

### C.8 Ingre, van Leeuwen ... Akerstedt (2014), PLOS ONE - Three-Process Model (IN CY as sleepiness)
- Not anxiety, but the in-house precedent for a defensible continuous-time scalar: predicted KSS from
  observed sleep-wake timing, every constant PUBLISHED/DERIVED/VALIDATION-classified, construct scope
  explicitly "a population prediction, not felt sleepiness".
- Transferable: the *methodology* - continuous-time integration with fully-provenanced constants and a
  humble construct label. This is the bar Anxiety v2 must clear and, on current evidence, cannot fully
  clear for its rate constants (they'd be calibration, not published).

### Literature verdict
The literature robustly supports the **qualitative dynamics** Jody wants (build-up with hazard rate;
higher during imminent/ongoing threat; uncertainty raises it; controllability lowers it; carryover via
learning) and gives two **transferable functional forms** (Beta-Bernoulli posteriors + variance;
leaky-integrator affect model). It supplies **no transferable magnitudes** for an anxiety scalar - no
half-life, no baseline, no weights, no thresholds. That asymmetry is the whole design constraint.

---

## Part D - Candidate model (recommended shape)

The smallest defensible model: **one scalar state `L`, a leaky integrator driven by a grounded
threat-drive term.** Continuous-time, evaluable event-to-event in closed form, deterministic.

### D.1 The scalar
`L in [0,1]` = **threat-anticipation load**. `L=0` means no grounded expected-and-imminent adverse
pressure; `L->1` means strong, confident, imminent, uncontrollable adverse expectation. Units:
dimensionless index (like Process C's normalised output), NOT a KSS-style rating and NOT a percentage
of felt anxiety.

### D.2 The grounded drive term
`drive(t) in [0,1]`, composed only from existing grounded signals, evaluated per active defensive
context and aggregated by taking the max over active contexts (a present severe threat should not be
diluted by averaging with quiet ones):

```
drive_c(t) = severity_c * imminence_c(t) * (1 - controlDiscount_c) * uncertaintyGain_c
severity_c        = posteriorMean(cue,outcome)            # learned P(adverse) - grounded, param-free
imminence_c(t)    = hazard-based ramp over announced window, else stage weight for temporalStatus
controlDiscount_c = f(objectiveControllability, delta_control)   # in [0, cmax]  (CALIBRATION)
uncertaintyGain_c = 1 + u_w * normalisedUncertainty              # posterior variance + worldAmbiguity (CALIBRATION weight)
```

- `severity_c` is fully grounded and parameter-free (Tzovara posterior mean).
- `imminence_c(t)`: if the environment supplies an expected window, this is the **hazard rate** (Bach)
  normalised to [0,1] - grounded and parameter-free *in shape*. If only the categorical
  `temporalStatus` is available, it falls back to fixed stage weights (POTENTIAL < IMMINENT; ONGOING
  treated as sustained) - those weights are CALIBRATION (category B).
- `controlDiscount_c`: direction is literature-backed (Maier/Seligman); the amount is CALIBRATION.
- `uncertaintyGain_c`: direction literature-backed (Grupe & Nitschke); `u_w` is CALIBRATION. The
  uncertainty *value* (posterior variance, ambiguity enum) is grounded.

### D.3 The dynamics
```
dL/dt = k_up * drive(t) * (1 - L)  -  k_down * (1 - drive(t)) * L
```
Closed-form between events (drive constant on an interval of length dt):
```
tau     = 1 / (k_up*drive + k_down*(1-drive))
L_inf   = (k_up*drive) / (k_up*drive + k_down*(1-drive))
L(t+dt) = L_inf + (L(t) - L_inf) * exp(-dt / tau)
```
So it is **analytically evaluable event-to-event** (no numerical integration needed), which suits
deterministic replay. `k_up` (rise rate) and `k_down` (recovery rate) are the two dynamics constants;
both are CALIBRATION (category B) - the literature does not supply them. Persistence-after-resolution
falls out naturally: when a context resolves, `drive->~0`, `L` relaxes toward the floor with time
constant `~1/k_down` rather than snapping to QUIET.

### D.4 Floor / baseline
A resting floor `L_floor` (small, e.g. reflecting chronic prison background). Category B/C - there is
no published baseline. Recommend `L_floor = 0` for the prototype and only introduce a nonzero floor if
a specific grounded chronic stressor is modelled; a nonzero constant floor with no source would be
category C (do not use).

### D.5 What is grounded vs calibrated (the honesty ledger)
- GROUNDED, parameter-free: `severity_c` (posterior mean), uncertainty *values* (posterior variance,
  ambiguity), hazard rate *shape* given a window, controllability *values*, event timing, UNKNOWN
  handling, carryover (via the learner).
- CALIBRATION (category B - defensible but must be labelled, tuned to face validity, never called
  "fitted"): `k_up`, `k_down`, `u_w`, `controlDiscount` mapping, categorical stage weights when no
  window is available.
- ARBITRARY (category C - do NOT use): any nonzero constant floor without a source; any per-event
  additive "+X anxiety" delta; any severity score not derived from a posterior; any half-life quoted
  as if published.

This model contains **zero category-C constants** as specified. That is the test it must keep passing.

---

## Part E - What the scalar means (operational definition)

**Claims:** `L` is a bounded latent index of *grounded threat-anticipation load* - the integrated,
time-evolving pressure implied by Cy's own learned adverse-outcome expectations, their imminence, their
uncertainty and their (un)controllability, as evidenced by structured world events.

**Does NOT claim:** that this equals how anxious Cy feels; that it is a predicted human state-anxiety
rating; that it is calibrated to any physiological or self-report measure; that its magnitude is
meaningful beyond ordinal/shape comparison; that it reproduces the Predatory Imminence Continuum as a
biological scale.

Recommended construct label, mirroring the sleepiness model's humility: *"Threat-anticipation load: a
latent index derived from grounded threat learning and defensive context. It is not felt anxiety, a
clinical anxiety rating, or a biological measurement."* If Jody wants the visitor-facing word
"Anxiety", that is a presentation choice layered on top - but the model spec and provenance must carry
the honest construct name.

---

## Part F - Model options compared (max 3)

### Option 1 - Leaky integrator on a grounded drive (Part D). RECOMMENDED.
- Basis: Rutledge (2014) form + Tzovara posteriors + Bach hazard rate + controllability literature.
- Inputs: posterior mean/variance, temporalStatus/hazard window, controllability, ambiguity, timing.
- State eq: `dL/dt = k_up*drive*(1-L) - k_down*(1-drive)*L` (closed-form per interval).
- Strengths: one state; analytic; produces every desired shape; carryover emergent via learner; zero
  category-C constants; matches house methodology; hybrid-friendly (rides on the categorical seam).
- Weaknesses: `k_up`, `k_down`, drive weights are calibration; anticipatory build-up needs an event
  window input that doesn't exist yet.
- Calibration burden: 2 rate constants + ~2 weights, all face-validity tuned.
- Replay suitability: excellent (deterministic, analytic).
- Implementation risk: low-moderate (needs the window input for full build-up).

### Option 2 - Instantaneous grounded "threat-load index" (no dynamics). Simpler fallback.
- Basis: same drive term, but `L(t) = drive(t)` directly, no integrator.
- Strengths: **fewest calibration constants** (only the drive weights); arguably the *most*
  defensible because it adds no un-sourced dynamics; still richer than the categorical switch (it is a
  graded scalar reflecting severity x imminence x uncertainty x control).
- Weaknesses: no persistence after resolution, no anticipatory momentum, no carryover-as-inertia - it
  would still "drop to floor immediately" on resolution (though from a graded height, not a hard
  switch). Fails the "gradual recovery / persistence" requirement.
- Calibration burden: minimal.
- Replay suitability: excellent. Implementation risk: very low.
- Use if: Jody decides the dynamics constants are too arbitrary to accept. This is the honest minimum.

### Option 3 - Full predicted state-anxiety rating (fitted magnitude). NOT RECOMMENDED.
- Basis: would attempt to output a number comparable to a human anxiety scale.
- Why rejected: there is no transferable dataset/coefficients to fit against; it would require
  category-C invention dressed as science - exactly the "impressive-looking but fabricated equation"
  Jody forbids. Also duplicates the discredited `experienced-state.js` anxiety metric.

**Recommendation:** prototype **Option 1** as the primary candidate and **Option 2** as the honest
floor for comparison. Reject Option 3.

---

## Part G - Golden-day expected shapes and fixture needs

Shapes only; no target amplitudes (amplitudes are not scientifically earned). "Load" = `L`.

1. **Quiet routine day** - `L` sits at floor throughout; tiny, transient bumps only if a genuine
   low-posterior cue appears and resolves safe. Baseline shape: flat-low.
2. **Prolonged uncertain lockdown** - on onset `L` rises (ONGOING drive) but, crucially, if the
   *duration/outcome is uncertain* (`worldAmbiguity` PARTIAL/AMBIGUOUS, high posterior variance),
   `uncertaintyGain` keeps drive elevated so `L` climbs toward a sustained plateau rather than
   settling. Slow partial decay only if partial reassurance arrives. Shape: rise -> high plateau ->
   slow decay after resolution.
3. **Hostile search / confiscation** - if a window is announced ("search this afternoon"), `L` shows
   **anticipatory build-up** tracking the rising hazard rate, **peak at/just before the imminent
   event**, then - because the outcome resolves adverse and the cue's posterior rises - a **slower
   decay from a higher post-event level** than a first-ever event would show. Shape: ramp -> peak ->
   slow elevated decay + raised carryover.
4. **Supportive social contact** - grounded controllability/affiliation raises `controlDiscount` and,
   if it constitutes safe evidence, feeds the learner toward safe outcomes; `L` decays faster toward
   floor than an uncontacted equivalent. Shape: accelerated relaxation.
5. **Mixed chaotic day** - multiple overlapping contexts; because drive aggregates by max, `L` tracks
   the worst concurrent threat and shows a jagged high trajectory with incomplete recovery between
   hits (each unresolved cue holds drive up). Shape: sawtooth-high, incomplete recovery.
6. **Recovery after stress** - inherited elevated `L` from prior adverse days; on a genuinely quiet,
   resolved day drive falls to ~0 and `L` relaxes toward floor over `~1/k_down`, i.e. **gradual, not
   instant** - the qualitative fix to the current "clears immediately" behaviour. Repeated prior
   threats leave a higher starting `L` and (via raised posteriors) a higher re-trigger sensitivity.
   Shape: slow exponential decay from an elevated start.

### Fixture events needed (minimal additions)
The current golden days are described as producing instant switches, which means they lack the
temporal texture to exercise dynamics. Minimal additions (do not novelise):
- **Announced-window event** for the search day: an environment record marking an expected event with
  an approximate window (start/expected time). Without this, anticipatory build-up (shape 3) cannot be
  grounded - it is the single most important missing fixture ingredient.
- **A warning/update during the lockdown** (shape 2): one intermediate record that keeps the context
  ONGOING with unchanged/again-uncertain ambiguity, to test sustained plateau vs premature decay.
- **A partial reassurance** during lockdown or after the search (shapes 2/4): one record with
  `RESOLVED_SAFE` on a sub-context or supportive social contact, to test partial vs full recovery.
- **An explicit resolution** record at end of the search/lockdown day (shapes 3/6): needed anyway;
  confirms decay-from-elevated rather than snap-to-floor.
- **A repeated related cue** across days for the recovery fixture (shape 6): the same cue that
  previously resolved adverse reappearing, to test learner-driven carryover/sensitisation.

All of these are *structured world facts already expressible in the environment schema* (temporal
status, ambiguity, resolution, cue identity). The only genuinely new schema element is the
**expected-window field** for anticipatory hazard.

---

## Part H - Practicality / pushback (challenging the plan)

- **A fully-defensible *anxiety* scalar does not exist from available evidence.** The literature gives
  direction, not magnitude. If "defensible" means "every constant published like the sleepiness
  model", the answer is no. Be honest that the dynamics constants are calibration.
- **The required calibration is subjective.** There is no dataset. Calibration = Jody judging curves
  against the golden days. That is legitimate *if labelled as face-validity tuning*, illegitimate if
  presented as fitting. This is the main risk to the project's credibility.
- **A simpler "threat-load" index (Option 2) is more defensible than calling it Anxiety.** It adds no
  un-sourced dynamics and is still a genuine improvement over the categorical switch. Strongly
  consider whether the persistence/recovery dynamics are worth the two calibration constants they
  cost. My view: yes, but only because "clears immediately" is the specific behaviour Jody wants
  fixed, and only Option 1 fixes it.
- **Uncertainty and control CAN be mapped honestly as *values* but not as *weights*.** We can read
  posterior variance, ambiguity, controllability directly; we cannot source how much each should move
  the scalar. Keep their weights explicit and few.
- **Prefer a hybrid, not a replacement.** Yamamori & Robinson argue for keeping constructs distinct.
  Keep the categorical defensive-context seam as ground truth; let `L` be a derived *reading* on top of
  it, not a substitute. This also means the scalar can never contradict the grounded facts - it is
  bounded and driven by them.
- **Do not resurrect `experienced-state.js`'s anxiety.** Whatever is built must not reintroduce
  additive per-event deltas or invented half-lives. The new scalar's only legitimacy is that its drive
  is 100% grounded and its dynamics constants are openly flagged.

---

## Part I - Recommendation

1. Build **Option 1** (grounded leaky integrator) as an **isolated replay-only prototype**, with
   **Option 2** (instantaneous index) run alongside for comparison. Reject Option 3.
2. Name the construct **threat-anticipation load**, not Anxiety, in the model and spec. A visitor-facing
   "Anxiety" label may sit on top but the honesty is in the construct name.
3. Keep it **hybrid**: the categorical defensive-context seam stays authoritative; `L` is a derived
   scalar reading, bounded and driven by it.
4. Author a `config/model-specs/anxiety-anticipation-load.json` in the house style with each constant
   classified GROUNDED / CALIBRATION / (never ARBITRARY). If any constant can only be category C,
   drop it.
5. Add the **expected-window** fixture field and the five minimal fixture events (Part G) so the six
   golden days can actually exercise dynamics; without the window, ship Option 2 only.
6. Evaluate the prototype on **shape**, not numbers. Success = the six qualitative shapes in Part G
   reproduce; failure of any shape rejects the candidate cheaply before touching production.
7. Nothing goes near live Cy until Jody signs off on the shapes and explicitly approves promotion.

---

## Appendix - provenance quick table

| Ingredient                    | Source                          | Class        |
|-------------------------------|---------------------------------|--------------|
| posterior mean (severity)     | Tzovara 2018 (in Cy)            | GROUNDED     |
| posterior variance (uncert.)  | Tzovara 2018 (in Cy)            | GROUNDED     |
| hazard rate shape             | Bach lab 2024 (cpsy.105)        | GROUNDED*    |
| imminence ordering            | Abend 2023 (in Cy spec)         | GROUNDED (categorical) |
| uncertainty raises load       | Grupe & Nitschke 2013           | direction only |
| control lowers load           | Maier/Seligman 2016 (in Cy)     | direction only |
| leaky-integrator form         | Rutledge 2014 (PNAS)            | form only    |
| continuous-time method        | Ingre-Akerstedt 2014 (in Cy)    | method only  |
| k_up, k_down, u_w, discount   | none                            | CALIBRATION (B) |
| any constant floor > 0        | none                            | ARBITRARY (C) - excluded |

*grounded in shape only, given an expected-window input that must be added to the environment schema.
