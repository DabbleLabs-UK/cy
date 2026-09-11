import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import {
  chooseSomaAction,
  groundedSomaDirective,
  observeSomaControllabilityRecord,
  observeSomaCurrentDefensiveContextRecord,
  observeSomaFeedingRecord,
  observeSomaOutput,
  observeSomaSocialContactRecord,
  observeSomaSomaticRecord,
  observeSomaThreatLearningRecord,
  reconcileSoma,
  somaSampling,
} from './soma.js';
import { buildDirectives } from './prompt.js';
import { implementationEntry } from './implementation-registry.js';
import { INSTRUMENTAL_ACTION_SELECTION } from './instrumental-agency.js';

const NOW = Date.parse('2026-09-11T16:00:00.000Z');
const at = (ms = NOW) => new Date(ms).toISOString();
const record = (archetypeId, id, world, timestamp = NOW) => createEnvironmentRecord(
  createEnvironmentEvent(archetypeId, { id, timestamp: at(timestamp), world }),
);

// A/F/G. Empty substrate state remains usable and preserves uncertainty.
const empty = reconcileSoma(null, { now: NOW });
const emptyProjection = groundedSomaDirective(empty, { now: NOW });
assert.equal(emptyProjection.context.schema, 'cy.grounded-prose-context');
assert.equal(emptyProjection.context.version, 1);
assert.match(emptyProjection.directive, /<GROUNDED_CURRENT_STATE>/);
assert.match(emptyProjection.directive, /\[MODEL ESTIMATE\].*process_s/);
assert.match(emptyProjection.directive, /\[SCHEDULE ESTIMATE\].*process_c/);
assert.match(emptyProjection.directive, /\[UNKNOWN\].*No definite intake has been recorded/);
assert.doesNotMatch(emptyProjection.directive, /Cy (?:is|feels) (?:anxious|afraid|hungry|lonely|tired)/i);

const state = reconcileSoma(null, { now: NOW });

observeSomaControllabilityRecord(state, record('officer_instruction', 'control-observation', {
  participants: { actor: 'proctor' },
  context: { location: 'cell' },
  defensive_context: {
    context_id: 'cell:proctor-current', temporal_status: 'RESOLVED',
    adverse_outcome_classes: ['COERCIVE_LOSS_OF_CONTROL'],
  },
  associative_learning: {
    linkage: 'self_contained_event',
    outcomes: [{ outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: 'occurred' }],
  },
  action_opportunity: {
    id: 'opportunity:control-observation',
    context_id: 'cell:proctor-current',
    context_type: 'officer_request',
    available_actions: ['action:refuse'],
    unavailable_actions: [],
    chosen_action: 'action:refuse',
    action_actually_executed: 'action:refuse',
    execution_status: 'EXECUTED',
    onset_at: at(NOW - 120000),
    resolved_at: at(NOW - 120000),
    resolution_status: 'RESOLVED',
    linked_event_ids: ['opened:control-observation'],
    outcome_resolution: [{ outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: 'occurred' }],
  },
}, NOW - 120000));

// B. Resolved observations establish an exact posterior before a current cue.
for (const [id, status] of [['resolved-adverse', 'occurred'], ['resolved-safe', 'did_not_occur']]) {
  observeSomaThreatLearningRecord(state, record('cell_search', id, {
    participants: { actor: 'proctor' },
    associative_learning: {
      linkage: 'self_contained_event',
      outcomes: [{ outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status }],
    },
  }));
}
const activeDefensive = record('cell_search', 'active-proctor', {
  participants: { actor: 'proctor' },
  situation: { control: 'none', resolution_status: 'unresolved' },
  associative_learning: {
    linkage: 'self_contained_event',
    outcomes: [{ outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: 'unknown' }],
  },
  defensive_context: {
    context_id: 'cell:proctor-current',
    temporal_status: 'IMMINENT',
    adverse_outcome_classes: ['COERCIVE_LOSS_OF_CONTROL'],
  },
  action_opportunity: {
    id: 'opportunity:active-proctor',
    context_id: 'cell:proctor-current',
    context_type: 'officer_request',
    available_actions: ['action:refuse'],
    unavailable_actions: [],
    chosen_action: 'UNKNOWN',
    action_actually_executed: 'UNKNOWN',
    execution_status: 'UNKNOWN',
    onset_at: at(NOW),
    resolved_at: null,
    resolution_status: 'UNRESOLVED',
    linked_event_ids: [],
    outcome_resolution: [{ outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: 'unknown' }],
  },
});
observeSomaCurrentDefensiveContextRecord(state, activeDefensive);

// C. Injury is factual and has no subjective severity.
observeSomaSomaticRecord(state, record('somatic_event', 'left-hand-injury', {
  somatic: {
    stimulus: {
      id: 'stimulus:left-hand', modality: 'MECHANICAL', status: 'POINT',
      noxious_stimulus: 'YES',
    },
    body: { site: 'left_hand', laterality: 'LEFT', certainty: 'CERTAIN' },
    tissue: {
      damage_status: 'CONFIRMED', injury_id: 'injury:left-hand',
      injury_type: 'ABRASION', injury_status: 'ACTIVE',
    },
    knowledge_status: 'PARTIAL',
  },
}));

// D. Intake timing remains a factual ledger value, not Hunger.
observeSomaFeedingRecord(state, record('meal', 'known-lunch', {
  physical: { food: {
    meal_type: 'lunch', scheduled: 'yes', offered: 'yes', available: 'yes',
    received: 'yes', consumed: 'full', intake_outcome: 'full_consumed',
    portion_category: 'full',
  } },
}, NOW - 4 * 60 * 60 * 1000));

// E. Social context remains the observed episode and elapsed factual time.
observeSomaSocialContactRecord(state, record('social_episode', 'supportive-contact', {
  social: {
    episode_id: 'contact:supportive', episode_type: 'CONTACT', start_at: at(NOW - 60000),
    end_at: at(NOW - 30000), actor_label: 'Daemon', target_label: 'Cy',
    channel: 'IN_PERSON', contact_form: 'DIRECT_INTERACTION', direction: 'MUTUAL',
    reciprocity: 'RECIPROCAL', character: 'SUPPORTIVE', resolution: 'COMPLETED',
  },
}, NOW - 60000));

const projection = groundedSomaDirective(state, { now: NOW });
assert.match(projection.directive, /active_external_context/);
assert.match(projection.directive, /"cueId":"actor:proctor"/);
assert.match(projection.directive, /"resolvedObservations":2/);
assert.match(projection.directive, /"objectiveControllability":"NONE"/);
assert.match(projection.directive, /"resolutionStatus":"UNRESOLVED"/);
assert.match(projection.directive, /matching_context_action_outcome_evidence/);
assert.match(projection.directive, /"actionPerformed":1/);
assert.doesNotMatch(projection.directive, /\b(?:anxious|afraid|frightened)\b/i);
assert.match(projection.directive, /active_injury.*left_hand/);
assert.match(projection.directive, /subjective_pain = NOT_MODELLED/);
assert.doesNotMatch(projection.directive, /pain (?:severity|score|level)/i);
assert.match(projection.directive, /last_known_intake.*14400000/);
assert.doesNotMatch(projection.directive, /\b(?:hungry|starving)\b/i);
assert.match(projection.directive, /last_supportive_contact/);
assert.doesNotMatch(projection.directive, /\blonely\b/i);

// H. Provisional visitor metrics cannot change the grounded projection.
const beforeMetrics = groundedSomaDirective(state, { now: NOW }).directive;
const samplingBeforeMetrics = somaSampling(state);
for (const metric of Object.values(state.experienced.metrics)) metric.value = 100;
state.drives.food = 1;
state.drives.rest = 1;
state.appraisal.threat = 1;
assert.equal(groundedSomaDirective(state, { now: NOW }).directive, beforeMetrics);
assert.deepEqual(somaSampling(state), samplingBeforeMetrics,
  'provisional metrics and drives do not alter waking sampling or target length');
const runSource = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
assert.doesNotMatch(runSource, /\bshout\s*\(/,
  'provisional state no longer changes capitalization in the live runner path');

// I. Generated claims cannot update any grounded subsystem.
const groundedBeforeOutput = JSON.stringify({
  sleep: state.sleepHomeostasis,
  circadian: state.circadianProcessC,
  threat: state.threatLearning,
  defensive: state.currentDefensiveContext,
  feeding: state.feeding,
  control: state.learnedControllability,
  somatic: state.somaticNociceptive,
  social: state.socialContact,
});
observeSomaOutput(state, "my hand's killing me. proctor will batter me. i have not eaten. nobody talks to me.", { now: NOW });
assert.equal(JSON.stringify({
  sleep: state.sleepHomeostasis,
  circadian: state.circadianProcessC,
  threat: state.threatLearning,
  defensive: state.currentDefensiveContext,
  feeding: state.feeding,
  control: state.learnedControllability,
  somatic: state.somaticNociceptive,
  social: state.socialContact,
}), groundedBeforeOutput);

// J. Prompt and owner inspection preserve the grounded/provisional boundary.
const provisional = 'PROVISIONAL COGNITIVE CONTEXT SENT TO MODEL';
const zoneC = buildDirectives({ cognition: state }, 'journal', {
  groundedSoma: projection.directive,
  provisionalCognition: provisional,
});
assert.match(zoneC, /<GROUNDED_CURRENT_STATE>/);
assert.match(zoneC, /PROVISIONAL COGNITIVE CONTEXT SENT TO MODEL/);
assert.ok(zoneC.indexOf('<GROUNDED_CURRENT_STATE>') < zoneC.indexOf(provisional));
const rawSource = readFileSync(new URL('../public/assets/raw.js', import.meta.url), 'utf8');
assert.match(rawSource, /GROUNDED SOMA CONTEXT SENT TO MODEL/);
assert.match(rawSource, /GROUNDED SOMA INFORMATION OMITTED/);
assert.match(rawSource, /PROVISIONAL COGNITIVE CONTEXT SENT TO MODEL/);

// K/L. The legacy selector remains inspectable but is no longer called by the
// live runner. Scientific/grounded action selection remains not implemented.
const actionProbeBefore = JSON.parse(JSON.stringify(state));
const actionProbeAfter = JSON.parse(JSON.stringify(state));
groundedSomaDirective(actionProbeAfter, { now: NOW });
assert.deepEqual(
  chooseSomaAction(actionProbeAfter, { canDraw: false, now: NOW }),
  chooseSomaAction(actionProbeBefore, { canDraw: false, now: NOW }),
  'grounded prompt projection does not change provisional action selection',
);
assert.equal(implementationEntry('soma_subsystems', 'grounded_soma_action_selection').implementation_status,
  'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'model_mediated_expressive_choice').implementation_status,
  'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'heuristic_drive_expressive_selector').lifecycle_status,
  'DISABLED_LEGACY');
assert.doesNotMatch(runSource, /soma\.chooseAction\(/);
assert.equal(INSTRUMENTAL_ACTION_SELECTION, 'ENGINEERING_ROUND_ROBIN_NOT_PSYCHOLOGICAL');

console.log('grounded-prose-context.test.js: all checks passed');
