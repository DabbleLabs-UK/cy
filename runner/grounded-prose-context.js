// grounded-prose-context.js - factual projection of LIVE grounded Soma state.
//
// This module does not calculate emotion, subjective bodily experience,
// salience, action preference or prose style. It selects already-established
// categorical facts and model outputs for a compact language-model prompt.

import { sleepHomeostasisSnapshot } from './sleep-homeostasis.js';
import { circadianProcessCSnapshot } from './circadian-process-c.js';
import { threeProcessSleepinessSnapshot } from './three-process-sleepiness.js';
import { currentDefensiveContextInspection } from './current-defensive-context.js';
import { feedingSnapshot } from './feeding-homeostasis.js';
import { somaticSnapshot } from './somatic-nociceptive-substrate.js';
import { socialContactSnapshot } from './social-contact-substrate.js';
import { THREAT_LEARNING_PRIOR } from './probabilistic-threat-learning.js';

export const GROUNDED_PROSE_CONTEXT_SCHEMA = 'cy.grounded-prose-context';
export const GROUNDED_PROSE_CONTEXT_VERSION = 1;
export const GROUNDED_PROSE_CONTEXT_CLASSIFICATION =
  'ENGINEERING_PROMPT_PROJECTION_OF_LIVE_GROUNDED_STATE';

export const EPISTEMIC_STATUS = Object.freeze({
  OBSERVED_FACT: 'OBSERVED FACT',
  MODEL_ESTIMATE: 'MODEL ESTIMATE',
  LEARNED_EXPECTATION: 'LEARNED STATISTICAL EXPECTATION',
  SCHEDULE_ESTIMATE: 'SCHEDULE ESTIMATE',
  UNKNOWN: 'UNKNOWN',
  NOT_MODELLED: 'NOT MODELLED',
});

function entry(epistemicStatus, source, fact, value) {
  return { epistemicStatus, source, fact, value };
}

function section(id, title, entries) {
  return { id, title, implementationStatus: 'LIVE', entries };
}

function sleepSection(state, now) {
  const processS = sleepHomeostasisSnapshot(state.sleepHomeostasis);
  const processC = circadianProcessCSnapshot(state.circadianProcessC);
  const predictedSleepiness = threeProcessSleepinessSnapshot(state.predictedSleepiness, now);
  if (!processS && !processC && !predictedSleepiness) return null;
  const entries = [];
  if (processS) {
    entries.push(entry(
      EPISTEMIC_STATUS.MODEL_ESTIMATE,
      'sleep_homeostasis',
      'process_s',
      {
        estimate: processS.sleepPressure,
        interval: [processS.sMin, processS.sMax],
        uncertaintyWidth: processS.uncertaintyWidth,
        calibrating: processS.calibrating,
        currentObservedSleepState: processS.currentSleepState,
      },
    ));
  }
  if (processC) {
    entries.push(entry(
      EPISTEMIC_STATUS.SCHEDULE_ESTIMATE,
      'circadian_process_c',
      'process_c',
      {
        estimate: processC.processCEstimate,
        interval: [processC.processCMin, processC.processCMax],
        clockHours: processC.clockHours,
        phasePositionHours: processC.circadianPhasePositionHours,
        phaseBasis: processC.phaseBasis,
        directBiologicalPhaseObserved: processC.directBiologicalPhaseObserved,
      },
    ));
  }
  if (predictedSleepiness && predictedSleepiness.publicLabel === 'LIVE'
    && Number.isFinite(predictedSleepiness.predictedKss)) {
    entries.push(entry(
      EPISTEMIC_STATUS.MODEL_ESTIMATE,
      'predicted_sleepiness_tpm',
      'predicted_kss',
      {
        estimate: predictedSleepiness.predictedKss,
        scale: 'Karolinska Sleepiness Scale 1-9',
        nearestPublishedAnchor: predictedSleepiness.kssAnchor,
        model: predictedSleepiness.modelId,
        phaseBasis: predictedSleepiness.phaseBasis,
        residualSdKss: predictedSleepiness.residualSdKss,
        betweenSubjectInterceptSdKss: predictedSleepiness.betweenSubjectInterceptSdKss,
        caution: 'This is a published population-model estimate, not an observation of what Cy feels.',
      },
    ));
  } else {
    entries.push(entry(
      EPISTEMIC_STATUS.UNKNOWN,
      'predicted_sleepiness_tpm',
      'predicted_kss',
      'CALIBRATING: two complete observed sleep episodes are required before a KSS estimate is supplied.',
    ));
  }
  entries.push(entry(
    EPISTEMIC_STATUS.NOT_MODELLED,
    'predicted_sleepiness_tpm',
    'general_fatigue',
    'General fatigue and sleep inertia are not modelled.',
  ));
  return section('sleep', 'SLEEP', entries);
}

function defensiveSection(state) {
  const inspection = currentDefensiveContextInspection(state.currentDefensiveContext);
  const active = inspection.activeContexts || [];
  if (!active.length) return null;
  const entries = [];
  const byContext = new Map();
  for (const context of active) {
    if (!byContext.has(context.contextId)) {
      byContext.set(context.contextId, { contexts: [], cues: new Map() });
    }
    const group = byContext.get(context.contextId);
    group.contexts.push(context);
    for (const cue of context.activeCues || []) group.cues.set(cue.cueId, cue);
  }
  for (const [contextId, group] of byContext) {
    entries.push(entry(
      EPISTEMIC_STATUS.OBSERVED_FACT,
      'current_defensive_context',
      'active_external_context',
      {
        contextId,
        cues: [...group.cues.values()],
        outcomeContexts: group.contexts.map((context) => ({
          outcomeClass: context.outcomeClass,
          temporalStatus: context.temporalStatus,
          worldAmbiguity: context.worldAmbiguity,
          objectiveControllability: context.objectiveControllability,
          outcomeStatus: context.outcomeStatus,
          resolutionStatus: context.resolutionStatus,
        })),
      },
    ));
    const seenAssociations = new Set();
    const seenContingencies = new Set();
    for (const context of group.contexts) {
      for (const association of context.learnedAssociations || []) {
        const posterior = association.posterior || {};
        if (!(posterior.resolvedObservations > 0)) continue;
        const key = `${association.cueId}|${association.outcomeClass}`;
        if (seenAssociations.has(key)) continue;
        seenAssociations.add(key);
        entries.push(entry(
          EPISTEMIC_STATUS.LEARNED_EXPECTATION,
          'probabilistic_threat_learning',
          'cue_outcome_posterior',
          {
            contextId,
            cueId: association.cueId,
            outcomeClass: association.outcomeClass,
            resolvedObservations: posterior.resolvedObservations,
            outcomesOccurred: posterior.alpha - THREAT_LEARNING_PRIOR.alpha,
            outcomesDidNotOccur: posterior.beta - THREAT_LEARNING_PRIOR.beta,
            betaPosterior: {
              alpha: posterior.alpha,
              beta: posterior.beta,
              mean: posterior.mean,
              variance: posterior.variance,
            },
          },
        ));
      }
      for (const contingency of context.learnedActionOutcomeContingency || []) {
        const counts = contingency.observationCounts || {};
        if (!((counts.actionPerformed || 0) + (counts.actionWithheld || 0) > 0)) continue;
        const key = `${contingency.contextId}|${contingency.actionId}|${contingency.outcomeClass}`;
        if (seenContingencies.has(key)) continue;
        seenContingencies.add(key);
        entries.push(entry(
          EPISTEMIC_STATUS.LEARNED_EXPECTATION,
          'learned_controllability',
          'matching_context_action_outcome_evidence',
          {
            contextId: contingency.contextId,
            actionId: contingency.actionId,
            outcomeClass: contingency.outcomeClass,
            actionPosterior: contingency.actionPosterior,
            noActionPosterior: contingency.noActionPosterior,
            observationCounts: contingency.observationCounts,
            evidenceDescription: contingency.evidenceDescription,
            causalStatus: contingency.causalStatus,
            perceivedControl: contingency.perceivedControl,
          },
        ));
      }
    }
    entries.push(entry(
      EPISTEMIC_STATUS.NOT_MODELLED,
      'current_defensive_context',
      'subjective_defensive_state',
      {
        anxiety: 'NOT_MODELLED',
        fearIntensity: 'NOT_MODELLED',
        perceivedControllability: 'NOT_MODELLED',
        causalActionOutcomeControl: 'NOT_MODELLED',
      },
    ));
  }
  return section('defensive', 'CURRENT DEFENSIVE CONTEXT', entries);
}

function somaticSection(state) {
  const snapshot = somaticSnapshot(state.somaticNociceptive);
  if (!snapshot) return null;
  const stimuli = snapshot.activeNoxiousStimuli || [];
  const injuries = snapshot.activeInjuries || [];
  if (!stimuli.length && !injuries.length) return null;
  const entries = [];
  for (const stimulus of stimuli) {
    entries.push(entry(
      EPISTEMIC_STATUS.OBSERVED_FACT,
      'somatic_nociceptive_substrate',
      'active_noxious_stimulus',
      {
        id: stimulus.id,
        modality: stimulus.modality,
        status: stimulus.status,
        noxiousStimulus: stimulus.noxiousStimulus,
        bodySite: stimulus.bodySite,
        laterality: stimulus.laterality,
        onsetAt: stimulus.onsetAt,
        offsetAt: stimulus.offsetAt,
      },
    ));
  }
  for (const injury of injuries) {
    entries.push(entry(
      EPISTEMIC_STATUS.OBSERVED_FACT,
      'somatic_nociceptive_substrate',
      'active_injury',
      {
        id: injury.id,
        status: injury.status,
        bodySite: injury.bodySite,
        laterality: injury.laterality,
        siteCertainty: injury.siteCertainty,
        injuryType: injury.injuryType,
        mechanism: injury.mechanism,
        firstObservedAt: injury.firstObservedAt,
        lastObservedAt: injury.lastObservedAt,
      },
    ));
  }
  entries.push(entry(
    EPISTEMIC_STATUS.NOT_MODELLED,
    'somatic_nociceptive_substrate',
    'subjective_pain',
    snapshot.subjectivePain,
  ));
  return section('somatic', 'SOMATIC', entries);
}

function feedingSection(state, now) {
  const snapshot = feedingSnapshot(state.feeding, now);
  if (!snapshot) return null;
  const entries = [];
  if (snapshot.lastKnownIntakeAt) {
    entries.push(entry(
      EPISTEMIC_STATUS.OBSERVED_FACT,
      'feeding_intake_ledger',
      'last_known_intake',
      {
        timestamp: snapshot.lastKnownIntakeAt,
        elapsedMs: snapshot.elapsedSinceKnownIntakeMs,
      },
    ));
  } else {
    entries.push(entry(
      EPISTEMIC_STATUS.UNKNOWN,
      'feeding_intake_ledger',
      'last_known_intake',
      'No definite intake has been recorded.',
    ));
  }
  if (snapshot.latestResolvedMeal) {
    entries.push(entry(
      EPISTEMIC_STATUS.OBSERVED_FACT,
      'feeding_intake_ledger',
      'latest_resolved_meal',
      compactMeal(snapshot.latestResolvedMeal),
    ));
  }
  if (snapshot.latestScheduledMeal
    && !sameMeal(snapshot.latestScheduledMeal, snapshot.latestResolvedMeal)) {
    entries.push(entry(
      EPISTEMIC_STATUS.OBSERVED_FACT,
      'feeding_intake_ledger',
      'latest_scheduled_meal',
      compactMeal(snapshot.latestScheduledMeal),
    ));
  }
  entries.push(entry(
    EPISTEMIC_STATUS.OBSERVED_FACT,
    'feeding_intake_ledger',
    'record_status',
    {
      missedScheduledMeals: snapshot.missedScheduledMeals,
      intakeKnowledgeStatus: snapshot.intakeKnowledgeStatus,
      observationGapCount: (snapshot.unknownIntervals || []).length,
    },
  ));
  entries.push(entry(
    EPISTEMIC_STATUS.NOT_MODELLED,
    'feeding_intake_ledger',
    'subjective_or_internal_state',
    {
      subjectiveHunger: 'NOT_MODELLED',
      homeostaticEnergyState: snapshot.homeostaticEnergyState,
      gutSatiety: snapshot.gutSatiety,
    },
  ));
  return section('feeding', 'FEEDING', entries);
}

function compactMeal(meal) {
  return {
    timestamp: meal.timestamp,
    mealType: meal.mealType,
    scheduledStatus: meal.scheduledStatus,
    offeredStatus: meal.offeredStatus,
    availabilityStatus: meal.availabilityStatus,
    receivedStatus: meal.receivedStatus,
    consumptionStatus: meal.consumptionStatus,
    intakeOutcome: meal.intakeOutcome,
    portionCategory: meal.portionCategory,
    portionFraction: meal.portionFraction,
    portionBasis: meal.portionBasis,
  };
}

function sameMeal(left, right) {
  return !!left && !!right
    && left.timestamp === right.timestamp
    && left.mealType === right.mealType
    && left.intakeOutcome === right.intakeOutcome;
}

function contactEntry(snapshot, fact, timestampKey, elapsedKey) {
  if (!snapshot[timestampKey]) return null;
  return entry(
    EPISTEMIC_STATUS.OBSERVED_FACT,
    'social_contact_ledger',
    fact,
    { timestamp: snapshot[timestampKey], elapsedMs: snapshot[elapsedKey] },
  );
}

function socialSection(state, now) {
  const snapshot = socialContactSnapshot(state.socialContact, now);
  if (!snapshot) return null;
  const hasRecords = snapshot.totalEpisodes > 0;
  const hasCurrent = snapshot.currentContext
    && snapshot.currentContext.currentEpisodeType !== 'NONE_OBSERVED';
  if (!hasRecords && !hasCurrent) return null;
  const entries = [];
  if (hasCurrent) {
    entries.push(entry(
      EPISTEMIC_STATUS.OBSERVED_FACT,
      'social_contact_ledger',
      'current_social_context',
      snapshot.currentContext,
    ));
  }
  if (snapshot.latestEpisode) {
    entries.push(entry(
      EPISTEMIC_STATUS.OBSERVED_FACT,
      'social_contact_ledger',
      'latest_social_episode',
      {
        episodeType: snapshot.latestEpisode.episodeType,
        startTimestamp: snapshot.latestEpisode.startTimestamp,
        endTimestamp: snapshot.latestEpisode.endTimestamp,
        participants: snapshot.latestEpisode.participants,
        channel: snapshot.latestEpisode.channel,
        contactForm: snapshot.latestEpisode.contactForm,
        direction: snapshot.latestEpisode.direction,
        reciprocity: snapshot.latestEpisode.reciprocity,
        socialCharacter: snapshot.latestEpisode.socialCharacter,
        resolution: snapshot.latestEpisode.resolution,
      },
    ));
  }
  for (const item of [
    contactEntry(snapshot, 'last_direct_contact', 'lastDirectContactAt', 'elapsedSinceDirectContactMs'),
    contactEntry(snapshot, 'last_reciprocal_contact', 'lastReciprocalContactAt', 'elapsedSinceReciprocalContactMs'),
    contactEntry(snapshot, 'last_supportive_contact', 'lastSupportiveContactAt', 'elapsedSinceSupportiveContactMs'),
    contactEntry(snapshot, 'last_hostile_contact', 'lastHostileContactAt', 'elapsedSinceHostileContactMs'),
  ]) {
    if (item) entries.push(item);
  }
  for (const opportunity of snapshot.unresolvedOpportunities || []) {
    entries.push(entry(
      EPISTEMIC_STATUS.OBSERVED_FACT,
      'social_contact_ledger',
      'current_social_opportunity',
      opportunity,
    ));
  }
  entries.push(entry(
    EPISTEMIC_STATUS.OBSERVED_FACT,
    'social_contact_ledger',
    'observation_continuity',
    {
      continuity: snapshot.observationContinuity,
      observationGapCount: (snapshot.observationGaps || []).length,
    },
  ));
  entries.push(entry(
    EPISTEMIC_STATUS.NOT_MODELLED,
    'social_contact_ledger',
    'subjective_loneliness',
    snapshot.subjectiveLoneliness,
  ));
  return section('social', 'SOCIAL', entries);
}

export function buildGroundedProseContext(state, { now = Date.now() } = {}) {
  if (!state) {
    return {
      schema: GROUNDED_PROSE_CONTEXT_SCHEMA,
      version: GROUNDED_PROSE_CONTEXT_VERSION,
      classification: GROUNDED_PROSE_CONTEXT_CLASSIFICATION,
      generatedAtMs: now,
      sections: [],
      omitted: [{ subsystem: 'grounded_soma', reason: 'STATE_UNAVAILABLE' }],
    };
  }
  const candidates = [
    ['sleep', sleepSection(state, now)],
    ['defensive', defensiveSection(state)],
    ['somatic', somaticSection(state)],
    ['feeding', feedingSection(state, now)],
    ['social', socialSection(state, now)],
  ];
  return {
    schema: GROUNDED_PROSE_CONTEXT_SCHEMA,
    version: GROUNDED_PROSE_CONTEXT_VERSION,
    classification: GROUNDED_PROSE_CONTEXT_CLASSIFICATION,
    generatedAtMs: now,
    sections: candidates.map(([, value]) => value).filter(Boolean),
    omitted: candidates.filter(([, value]) => !value).map(([subsystem]) => ({
      subsystem,
      reason: subsystem === 'defensive' ? 'NO_ACTIVE_EXTERNAL_DEFENSIVE_CONTEXT'
        : subsystem === 'somatic' ? 'NO_ACTIVE_NOXIOUS_STIMULUS_OR_INJURY'
          : subsystem === 'social' ? 'NO_SOCIAL_EPISODE_OR_CURRENT_CONTEXT_RECORDED'
            : 'STATE_UNAVAILABLE',
    })),
  };
}

function finite(value, digits = 3) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : 'unknown';
}

function words(value) {
  if (Array.isArray(value)) return value.map(words).join(', ');
  if (value && typeof value === 'object') return Object.values(value).map(words).filter(Boolean).join(', ');
  return String(value == null ? 'unknown' : value)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
}

function elapsedMinutes(value) {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value) / 60000)} minutes` : 'unknown';
}

function compactFields(value, keys) {
  if (!value || typeof value !== 'object') return words(value);
  return keys
    .filter((key) => value[key] != null)
    .map((key) => `${words(key)} ${words(value[key])}`)
    .join(', ');
}

// The structured `context` above remains the exact, inspectable record. This is
// deliberately a much smaller model-facing projection: the local 8B model was
// being handed several kilobytes of JSON and responded by analysing that report
// instead of writing as Cy. Keep only the facts that can affect the next thought,
// in ordinary language, while retaining their epistemic labels.
function modelFacingLine(item) {
  const value = item.value;
  switch (item.fact) {
    case 'process_s':
      return `[${item.epistemicStatus}] Recorded ${words(value.currentObservedSleepState)}; sleep-pressure estimate ${finite(value.estimate)} (interval ${finite(value.interval?.[0])}-${finite(value.interval?.[1])}, ${value.calibrating ? 'still calibrating' : 'calibrated'}).`;
    case 'process_c':
      return `[${item.epistemicStatus}] Circadian schedule estimate ${finite(value.estimate)} (interval ${finite(value.interval?.[0])}-${finite(value.interval?.[1])}; biological phase not directly observed).`;
    case 'predicted_kss':
      if (!value || typeof value !== 'object') return null;
      return `[${item.epistemicStatus}] Predicted KSS ${finite(value.estimate, 2)} on the 1-9 scale (nearest anchor: ${words(value.nearestPublishedAnchor?.description)}; population-default phase; model residual SD ${finite(value.residualSdKss, 2)}). This is a model estimate, not an observed feeling.`;
    case 'active_external_context': {
      const cues = (value.cues || []).map((cue) => words(String(cue.cueId || '').split(':').pop())).filter(Boolean);
      const outcomes = (value.outcomeContexts || []).map((outcome) => compactFields(outcome, [
        'outcomeClass', 'temporalStatus', 'worldAmbiguity', 'objectiveControllability',
        'outcomeStatus', 'resolutionStatus',
      ])).filter(Boolean);
      return `[${item.epistemicStatus}] Present external cues: ${cues.join(', ') || 'unspecified'}; ${outcomes.join('; ') || 'outcome unresolved'}.`;
    }
    case 'cue_outcome_posterior':
      return `[${item.epistemicStatus}] The ${words(String(value.cueId || '').split(':').pop())} cue has ${value.outcomesOccurred} adverse and ${value.outcomesDidNotOccur} non-adverse outcomes across ${value.resolvedObservations} resolved observations (estimate ${finite(value.betaPosterior?.mean)}).`;
    case 'matching_context_action_outcome_evidence':
      return `[${item.epistemicStatus}] Matching action evidence for ${words(String(value.actionId || '').split(':').pop())}: ${compactFields(value.observationCounts, ['actionPerformed', 'actionWithheld'])}; perceived control is not modelled.`;
    case 'active_noxious_stimulus':
      return `[${item.epistemicStatus}] Active ${words(value.modality)} noxious stimulus at ${words(value.bodySite)} (${words(value.status)}).`;
    case 'active_injury':
      return `[${item.epistemicStatus}] Active ${words(value.injuryType)} at ${words(value.bodySite)}; mechanism ${words(value.mechanism)}; site certainty ${words(value.siteCertainty)}.`;
    case 'last_known_intake':
      if (typeof value === 'string') return `[${item.epistemicStatus}] ${value}`;
      return `[${item.epistemicStatus}] Definite food intake was recorded ${elapsedMinutes(value.elapsedMs)} ago.`;
    case 'latest_resolved_meal':
    case 'latest_scheduled_meal':
      return `[${item.epistemicStatus}] ${item.fact === 'latest_resolved_meal' ? 'Latest resolved meal' : 'Latest scheduled meal'}: ${compactFields(value, ['mealType', 'offeredStatus', 'receivedStatus', 'consumptionStatus', 'intakeOutcome', 'portionCategory'])}.`;
    case 'record_status':
      return `[${item.epistemicStatus}] Feeding record: ${value.missedScheduledMeals || 0} missed scheduled meals; intake knowledge ${words(value.intakeKnowledgeStatus)}; ${value.observationGapCount || 0} observation gaps.`;
    case 'current_social_context':
      return `[${item.epistemicStatus}] Social context: ${value.currentlyInteracting ? `interacting with ${words(value.currentlyWith)}` : value.currentlyAlone ? 'confirmed alone' : 'no current interaction observed'}; character ${words(value.currentSocialCharacter)}.`;
    case 'latest_social_episode':
      return `[${item.epistemicStatus}] Latest social episode: ${compactFields(value, ['episodeType', 'participants', 'contactForm', 'reciprocity', 'socialCharacter', 'resolution'])}.`;
    case 'last_direct_contact':
    case 'last_reciprocal_contact':
    case 'last_supportive_contact':
    case 'last_hostile_contact':
      return `[${item.epistemicStatus}] ${words(item.fact)} was ${elapsedMinutes(value.elapsedMs)} ago.`;
    case 'current_social_opportunity':
      return `[${item.epistemicStatus}] Current social opportunity: ${compactFields(value, ['episodeType', 'actorLabel', 'contactForm', 'direction', 'reciprocity', 'resolution'])}.`;
    case 'observation_continuity':
      return value.observationGapCount
        ? `[${item.epistemicStatus}] Social observation has ${value.observationGapCount} recorded gap(s).`
        : null;
    default:
      // Subjective values marked NOT MODELLED are represented once by the fixed
      // boundary below, not repeated as a list of diagnostic vocabulary.
      return item.epistemicStatus === EPISTEMIC_STATUS.NOT_MODELLED ? null : null;
  }
}

export function formatGroundedProseContext(context) {
  const lines = [
    '<PRIVATE_CURRENT_FACTS>',
    'Private evidence for Cy only. Do not explain, analyse, summarise, quote, or name this block.',
    'Do not mention records, ledgers, substrates, model names, IDs, estimates, or what is not modelled.',
    'Use a relevant fact only as something Cy notices or reacts to in his own voice.',
    '[NOT MODELLED] No subjective emotion or bodily magnitude is supplied by these facts.',
  ];
  for (const block of context.sections || []) {
    for (const item of block.entries || []) {
      const line = modelFacingLine(item);
      if (line) lines.push(`- ${line}`);
    }
  }
  if (!(context.sections || []).length) lines.push('- [UNKNOWN] No current grounded facts are available.');
  lines.push('</PRIVATE_CURRENT_FACTS>');
  return lines.join('\n');
}

export function groundedProseDirective(state, options) {
  const context = buildGroundedProseContext(state, options);
  return {
    context,
    directive: formatGroundedProseContext(context),
  };
}
