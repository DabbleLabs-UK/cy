<?php
declare(strict_types=1);

require __DIR__ . '/../lib/implementation_registry.php';

// Public documentation surface for the four promoted Soma subsystems. Pulls
// live implementation-status labels from the same registry the main page
// uses, so a status can never drift out of sync between the two surfaces.
// Everything else on this page is static prose, checked against the model
// specs in config/model-specs/ - nothing here is fabricated.
$registry = captive_implementation_registry();

function cy_docs_status(array $registry, string $scope, string $id): string
{
    $entry = captive_implementation_registry_entry($registry, $scope, $id);
    $status = is_array($entry) ? (string)($entry['implementation_status'] ?? 'NOT_IMPLEMENTED') : 'NOT_IMPLEMENTED';
    return captive_implementation_public_label($registry, $status);
}

function cy_asset(string $rel): string
{
    $full = __DIR__ . '/' . $rel;
    $v = @filemtime($full) ?: 0;
    return $rel . '?v=' . $v;
}

$anxietyStatus = cy_docs_status($registry, 'soma_subsystems', 'probabilistic_threat_learning');
$sleepStatus = cy_docs_status($registry, 'soma_subsystems', 'sleep_homeostasis');
$satietyStatus = cy_docs_status($registry, 'soma_subsystems', 'ingestion_ledger');
$harmStatus = cy_docs_status($registry, 'soma_subsystems', 'computational_nociceptive_input_analogue');
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>How Cy works &middot; CY</title>
<meta name="description" content="How Cy's four promoted Soma subsystems are computed: methodology, citations, uncertainty and what is explicitly not modelled.">
<link rel="icon" type="image/png" sizes="32x32" href="<?= htmlspecialchars(cy_asset('assets/favicon-32.png'), ENT_QUOTES) ?>">
<link rel="stylesheet" href="<?= htmlspecialchars(cy_asset('assets/style.css'), ENT_QUOTES) ?>">
<link rel="stylesheet" href="<?= htmlspecialchars(cy_asset('assets/how-cy-works.css'), ENT_QUOTES) ?>">
</head>
<body class="docs-body">
<div class="docs-page">

<header class="docs-header">
  <a class="docs-back" href="index.php">&lt;- BACK TO CY</a>
  <h1>How Cy works</h1>
  <p class="docs-standfirst">Cy's public page shows four promoted Soma subsystems: Anxiety, Homeostatic Sleep Pressure, Physiological Satiety, and Harm / Nociceptive Impact. Each is a real, published computational model wired to Cy's structured world state - not a synthetic mood dial. This page explains what each one actually computes, where its equations come from, and what it deliberately does not claim.</p>
</header>

<nav class="docs-toc" aria-label="Contents">
  <a href="#basics">The basics</a>
  <a href="#anxiety">Anxiety</a>
  <a href="#sleep">Sleep pressure</a>
  <a href="#sleepiness">Predicted sleepiness</a>
  <a href="#satiety">Satiety</a>
  <a href="#harm">Harm</a>
  <a href="#not-modelled">What isn't modelled</a>
</nav>

<section id="basics" class="docs-section">
  <h2>The basics</h2>
  <p>Cy is a simulation: a language model that writes as an inmate, driven by a persistent internal state called Soma. Soma doesn't tell Cy how he feels and then have him write it - it tracks separate, independently computed facts about his situation (how long he's been awake, whether a threat cue is currently active, whether he's recently eaten, whether he's carrying an injury), and those facts are given to the model as context alongside everything else happening in his world.</p>
  <p>Every promoted subsystem below is built from a specific published model or a specific published equation set, cited by author and year. Where a subsystem would need information Cy's world doesn't actually generate, it is explicitly marked as not modelled rather than approximated or faked. A status of <strong>LIVE</strong> means the computation is wired, persistent and running against real data; <strong>PROVISIONAL</strong> means older plumbing exists but isn't an approved model; <strong>NOT MODELLED</strong> means no model exists for that part.</p>
  <p class="docs-note">Throughout this page, "computed state" and "felt experience" are kept deliberately separate. A model can output a number or a category; none of these models claim to measure what Cy subjectively feels. That gap is intentional, not an oversight.</p>
</section>

<section id="anxiety" class="docs-section">
  <h2>Anxiety <span class="docs-status"><?= htmlspecialchars($anxietyStatus, ENT_QUOTES) ?></span></h2>
  <p>Anxiety on the main page is a <strong>categorical operational state</strong> - one of QUIET, ANTICIPATING, THREAT IMMINENT, THREAT ONGOING or UNKNOWN - drawn from Cy's current structured defensive context, not a 0-100 emotion score. It answers "is something currently being treated as an active threat", not "how anxious does Cy feel".</p>
  <p>Three separate pieces feed the state:</p>
  <ul>
    <li><strong>Current defensive context</strong> - an event-driven record of present external cues, categorical timing (is the threat ongoing, imminent, or just anticipated), world ambiguity, and Cy's actual (objective) control over the outcome. This is inspectable without ever collapsing to a single threat score.</li>
    <li><strong>Probabilistic threat learning</strong> - a parameter-free Beta-Bernoulli learner. Each structured cue/adverse-outcome pair starts from a flat Beta(1,1) prior; every resolved trial updates it (alpha increases on an adverse outcome, beta increases on a safe one), giving a learned probability that a cue predicts a specific outcome class. Method: Tzovara, Korn &amp; Bach (2018), "Human Pavlovian fear conditioning conforms to probabilistic learning", <em>PLOS Computational Biology</em>. <a href="https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1006243" target="_blank" rel="noopener">doi:10.1371/journal.pcbi.1006243</a>.</li>
    <li><strong>Action-outcome contingency</strong> - observational evidence comparing adverse-outcome rates when an available action was taken versus deliberately withheld in the same context. This is evidence, not a causal-control percentage or a proof of agency.</li>
  </ul>
  <p>Conceptual grounding for treating anxiety as anticipation of a possible future threat, rather than a felt-emotion score, follows Schmitz &amp; Grillon (2012), "Assessing fear and anxiety in humans using the threat of predictable and unpredictable aversive events (the NPU-threat test)", <em>Nature Protocols</em>.</p>
  <p class="docs-limits"><strong>Deliberately not modelled:</strong> subjective anxiety magnitude, perceived (as opposed to actual) controllability, temporal hazard rate, amygdala or BNST neural activation, fear intensity, or a behavioural policy. Threat learning itself does not model volatility, forgetting, recency weighting, cue generalisation, or context switching - each resolved cue/outcome pair is learned independently under a stationary model.</p>
</section>

<section id="sleep" class="docs-section">
  <h2>Homeostatic sleep pressure <span class="docs-status"><?= htmlspecialchars($sleepStatus, ENT_QUOTES) ?></span></h2>
  <p>This is Process S from Borbely's classic Two-Process Model of sleep regulation: a homeostatic drive that rises smoothly while awake and dissipates smoothly while asleep, built entirely from Cy's own schedule-derived sleep and wake intervals.</p>
  <p>Two exponential equations, normalized to a 0-1 index:</p>
  <ul>
    <li>Waking: <code>S(t+dt) = 1 - (1 - S(t)) * exp(-dt / tau_w)</code>, with a published rise time constant of 18.18 hours.</li>
    <li>Sleeping: <code>S(t+dt) = S(t) * exp(-dt / tau_s)</code>, with a published dissipation time constant of 4.2 hours.</li>
  </ul>
  <p>Method: Borbely (1982), "A two process model of sleep regulation", <em>Human Neurobiology</em>; Daan, Beersma &amp; Borbely (1984), "Timing of human sleep: recovery process gated by a circadian pacemaker", <em>American Journal of Physiology</em>; Borbely &amp; Achermann (1999), "Sleep homeostasis and models of sleep regulation", <em>Journal of Biological Rhythms</em>.</p>
  <p class="docs-limits"><strong>Deliberately not modelled:</strong> subjective fatigue, mood, stress, depression or motivation. This is the homeostatic component only - the separate circadian component (Process C) is described below, under predicted sleepiness, and the two are not added together on this display.</p>
</section>

<section id="sleepiness" class="docs-section">
  <h2>Predicted sleepiness</h2>
  <p>Sleep pressure's companion reading (shown as a supporting, non-promoted metric) predicts a Karolinska Sleepiness Scale (KSS, 1-9) rating using the validated <strong>S_B + C + U Three-Process Model</strong>, combining a homeostatic component (S_B), a circadian component (C) and an ultradian component (U) into a single alertness value, then mapping that to KSS with <code>KSS = 9.68 - 0.46 * (S_B + C + U)</code>.</p>
  <p>Method: Ingre, van Leeuwen, Klemets, Ullvetter, Hough, Kecklund, Karlsson &amp; Akerstedt (2014), "Validating and Extending the Three Process Model of Alertness in Airline Operations", <em>PLOS ONE</em>, validated against 5,744 KSS observations from 136 aircrew participants; with earlier grounding in Akerstedt &amp; Folkard (1995, 1997). The circadian phase used is the published population default (16.8h), since Cy's individual biological phase can't be observed - it is estimated from his habitual sleep schedule, not measured.</p>
  <p class="docs-limits"><strong>Deliberately not modelled:</strong> general fatigue, sleep inertia (so the first hour after waking carries extra known bias), and brain activation. This stays CALIBRATING until two complete schedule-derived sleep episodes exist - no value is fabricated before then.</p>
</section>

<section id="satiety" class="docs-section">
  <h2>Physiological satiety <span class="docs-status"><?= htmlspecialchars($satietyStatus, ENT_QUOTES) ?></span></h2>
  <p>This is a physiological model of the gut and hormonal response to eating - gastric emptying, intestinal transit, and four appetite-signalling hormones (CCK, GLP-1, PYY and ghrelin) - combined into a single published satiety score. It is a model estimate of post-meal physiological state, not a report of whether Cy feels hungry or full.</p>
  <p>Method: Martinez, Dibbs et al. (2025), "Computationally Modeling the Physiologic Impact of the Ratio of Fats to Carbohydrates in the Diet on Intake Among Metabolically Healthy Adults", <em>Current Developments in Nutrition</em>. <a href="https://doi.org/10.1016/j.cdnut.2025.107487" target="_blank" rel="noopener">doi:10.1016/j.cdnut.2025.107487</a>. The publication validated physiologic plausibility and food-intake behaviour in metabolically healthy adults aged 25-40 - it is not a validated measure of subjective hunger, and Cy's implementation does not treat it as one.</p>
  <p>When Cy's exact meal composition isn't known, the model doesn't guess a single number: it runs the published input-distribution ranges as separate low/typical/high scenarios and the main page shows the resulting spread rather than a false-precision point estimate.</p>
  <p class="docs-limits"><strong>Deliberately not modelled:</strong> subjective hunger, broader energy homeostasis, hedonic appetite, learned meal anticipation, feeding-related action selection, and hypothalamic neural activity.</p>
</section>

<section id="harm" class="docs-section">
  <h2>Harm / nociceptive impact <span class="docs-status"><?= htmlspecialchars($harmStatus, ENT_QUOTES) ?></span></h2>
  <p>This is a factual, structured ledger of noxious stimuli and injuries drawn from events in Cy's world - active injuries, the latest recorded event, tissue-damage status - not a Pain score. Cy has no biological nociceptors; this is a computational analogue that tracks the same category of information a nociceptive system would report (what happened, where, and whether it's still active), without claiming to be nociception or to measure subjective pain.</p>
  <p>Conceptual grounding for separating structured noxious input from subjective pain follows the IASP pain terminology, Garland (2012) "Pain Processing in the Human Nervous System", <em>Primary Care</em>, Woller, Eddinger, Corr &amp; Yaksh (2017) "An Overview of Pathways Encoding Nociception", <em>Clinical and Experimental Rheumatology</em>, and Chen &amp; Wang (2023) "Pain, from perception to action: A computational perspective", <em>iScience</em>.</p>
  <p class="docs-limits"><strong>Deliberately not modelled:</strong> subjective pain intensity, injury severity scoring, healing dynamics, predictive pain inference, peripheral or central sensitisation, and brain activation.</p>
</section>

<section id="not-modelled" class="docs-section">
  <h2>What isn't modelled, and why this matters</h2>
  <p>Every subsystem above lists what it deliberately excludes. That list isn't a to-do list - it's a boundary. Cy's page could easily show a single 0-100 "mood" number, a synthetic heart-rate readout, or a brain-activation heatmap, and for a while an earlier version of this project did exactly that. Those displays were retired because they implied a precision and a biological grounding that didn't exist: a made-up number dressed as a measurement.</p>
  <p>What remains are models that are honest about their own limits: real published equations, run against real structured events, reporting a category or a bounded estimate rather than a false-precision score, and explicitly refusing to claim they measure subjective experience they cannot observe. Older, retired scalars (legacy anxiety, arousal, pain, hunger, and similar heuristics) still exist in Cy's diagnostics for continuity, but they are not part of his current promoted state and are not used anywhere in his behaviour, prompting, or public headline.</p>
</section>

<footer class="docs-footer">
  <a href="index.php">&lt;- Back to Cy</a>
</footer>

</div>
</body>
</html>
