import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  EXPERIENCED_METRICS,
  BRAIN_REGIONS,
  IMPLEMENTATION_STATUS,
  canRenderDynamicActivity,
  buildCountStepPath,
  elapsedFeedingLabel,
} from '../public/assets/brain.js';
import { reconcileSoma, somaSnapshot, tickSoma } from './soma.js';
import { implementationRegistry, implementationEntry } from './implementation-registry.js';

const here = dirname(fileURLToPath(import.meta.url));
const soma = reconcileSoma(null, { now: 1 });
tickSoma(soma, { physical: { hunger: 0.7 }, monotony: 0.2, now: 5001 });
const snapshot = somaSnapshot(soma);
assert.equal(snapshot.sleepHomeostasis.publicLabel, 'LIVE');
assert.equal(implementationEntry('soma_variables', 'sleepiness').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'circadian_process_c').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'circadian_entrainment').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'probabilistic_threat_learning').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'current_defensive_context').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'feeding_event_model').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'ingestion_ledger').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'computational_nociceptive_input_analogue').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'subjective_pain').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'energy_homeostatic_state').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'objective_controllability').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'perceived_controllability').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'learned_controllability').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'causal_controllability').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('brain_regions', 'scnCircadian').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('brain_regions', 'hypothalamic').implementation_status, 'NOT_IMPLEMENTED');

assert.deepEqual(EXPERIENCED_METRICS.map((metric) => metric.key),
  ['anxiety', 'arousal', 'somaticHarm', 'satiety', 'sleepiness', 'loneliness', 'anger', 'rumination']);
assert.deepEqual(
  [...BRAIN_REGIONS.map((region) => region.key).filter((key) => key !== 'scnCircadian')].sort(),
  [...Object.keys(snapshot.experienced.brain)].sort(),
  'every provisional public functional analogy is derived by the experienced-state snapshot',
);
for (const region of BRAIN_REGIONS) {
  assert.match(region.path, /^M\d/);
  assert.ok(region.label);
  if (region.key === 'scnCircadian') assert.ok(snapshot.circadianProcessC.scnAnalogy.statement);
  else assert.ok(snapshot.experienced.brain[region.key].explanation);
}

const source = await readFile(join(here, '..', 'public', 'assets', 'brain.js'), 'utf8');
assert.match(source, /PLANNED STATS/);
assert.match(source, /SOMA DIAGNOSTICS/);
assert.match(source, /Some displayed values come from an older heuristic model/);
assert.doesNotMatch(source, /Brain regions are functional analogies, not measured physiology/);
assert.match(source, /class="soma-scaffold"/);
assert.match(source, /SOMA MODEL STATUS/);
assert.match(source, /LEGACY SOMA DIAGNOSTICS - PROVISIONAL/);
assert.equal(canRenderDynamicActivity(IMPLEMENTATION_STATUS.PROVISIONAL), false);
assert.equal(canRenderDynamicActivity(IMPLEMENTATION_STATUS.NOT_IMPLEMENTED), false);
assert.equal(canRenderDynamicActivity(IMPLEMENTATION_STATUS.IMPLEMENTED), true);
assert.match(
  source,
  /definition\.status\.status === IMPLEMENTATION_STATUS\.NOT_IMPLEMENTED[\s\S]*?querySelector\('\.soma-state-value'\)\.textContent = '--'/,
  'a NOT_IMPLEMENTED Soma row must render no numeric value',
);
assert.match(source, /data-range="1h"/);
assert.match(source, /data-range="24h"/);
assert.match(source, /data-range="7d"/);
assert.equal(
  implementationEntry('soma_subsystems', 'sleep_homeostasis').display_name,
  'HOMEOSTATIC SLEEP PRESSURE',
  'the public subsystem heading is supplied by the authoritative implementation registry',
);
assert.match(source, /SLEEP PRESSURE INDEX/);
assert.match(source, /CALIBRATING FROM OBSERVED SLEEP HISTORY/);
assert.equal(
  implementationEntry('soma_subsystems', 'circadian_process_c').display_name,
  'CIRCADIAN PROCESS C',
  'the public Process C heading is supplied by the authoritative implementation registry',
);
assert.match(source, /buildHistoryUrl\(this\.historyUrl, 'sleep', 'sleepPressure', range\)/);
assert.match(source, /buildHistoryUrl\(this\.historyUrl, 'circadian', 'processC', range\)/);
assert.match(source, /sleepHomeostasisStatus\.status === IMPLEMENTATION_STATUS\.IMPLEMENTED/);
assert.match(source, /circadianStatus\.status === IMPLEMENTATION_STATUS\.IMPLEMENTED/);
assert.match(source, /PHASE SCHEDULE-ESTIMATED/);
assert.match(source, /direct biological phase is not observed/);
assert.match(source, /This is not SCN activation/);
assert.match(source, /class="circadian-history-band"/);
assert.match(source, /setAttribute\('class', 'scn-phase-hand'\)/);
assert.match(source, /class="soma-region-list"/);
assert.match(source, /probabilistic_threat_learning/);
assert.match(source, /predicts outcomes; it is not an anxiety or fear-intensity score/);
assert.match(source, /threat-learning-inspector/);
assert.match(source, /CURRENT DEFENSIVE CONTEXT/);
assert.match(source, /It is not an anxiety or threat score/);
assert.match(source, /Learned uncertainty remains the separate posterior variance/);
assert.match(source, /defensive-context-inspector/);
assert.match(source, /ACTUAL CONTROL/);
assert.equal(
  implementationEntry('soma_subsystems', 'learned_controllability').display_name,
  'LEARNED ACTION-OUTCOME CONTINGENCY',
);
assert.match(source, /learnedControllabilityStatus/);
assert.match(source, /observational evidence, not a control percentage or causal proof/);
assert.match(source, /controllability-inspector/);
assert.match(source, /Causal control: not established\. Perceived control: not modelled\./);
assert.doesNotMatch(source, /Cy has 73% control/);
assert.equal(
  implementationEntry('soma_subsystems', 'feeding_event_model').display_name,
  'FEEDING / INTAKE EVENTS',
);
assert.doesNotMatch(source, /SUBJECTIVE HUNGER/);
assert.match(source, /feeding-input-inspector/);
assert.match(source, /PHYSIOLOGICAL SATIETY/);
assert.match(source, /<span>10<\/span><strong>MODELLED PHYSIOLOGICAL SATIETY<\/strong><span>1<\/span>/);
assert.match(source, /PHYSIOLOGICAL MODEL ESTIMATE/);
assert.doesNotMatch(source, /NOT A REPORTED FEELING/);
assert.match(source, /scope === 'satiety'/);
assert.match(source, /class="satiety-history-band"/);
assert.doesNotMatch(source, /HUNGER HISTORY/,
  'the superseded heuristic Hunger graph must not return');
assert.equal(elapsedFeedingLabel(0), '0m');
assert.equal(elapsedFeedingLabel((2 * 60 + 17) * 60000), '2h 17m');
assert.equal(elapsedFeedingLabel((25 * 60 + 3) * 60000), '1d 1h 3m');
assert.equal(elapsedFeedingLabel(null), 'UNKNOWN');
assert.match(source, /Somatic Harm tracks noxious events and injuries/);
assert.doesNotMatch(source, /It does not claim how painful Cy experiences them/);
assert.doesNotMatch(source, /subjective Pain is not modelled/);
assert.match(source, /SOMATIC \/ NOXIOUS INPUT TRACE/);
assert.match(source, /subjectivePainStatus/);
assert.match(source, /somatic_harm_headline/);
assert.match(source, /LIVE - structured bodily state/);
assert.match(source, /ACTIVE INJURIES/);
assert.match(source, /NO SOMATIC EVENTS IN THIS PERIOD/);
assert.doesNotMatch(source, /data-metric="pain"/,
  'the legacy Pain scalar must not be a primary visitor row');
assert.match(source, /<summary>EVENT HISTORY<\/summary>/);
assert.match(source, /<summary>MODEL \/ LIMITATIONS<\/summary>/);
assert.equal(
  buildCountStepPath([{ ts: 1000, value: 1 }, { ts: 2000, value: 2 }], 0, 3000),
  'M93.3 32.0 H186.7 V0.0 H280.0',
  'active-injury history uses a factual integer step line rather than a 0-100 Pain curve',
);
assert.match(source, /CONTACT HISTORY AND MODEL LIMITS/,
  'the long social history and unmodelled dependency list stay behind a secondary disclosure');
assert.match(source, /filter\(\(entry\) => entry\.ui_exposed !== false\)/,
  'unimplemented region placeholders without artwork must remain hidden');
assert.doesNotMatch(source, /Learned outcome probability/);
assert.match(source, /className = `soma-region-entry/);
assert.match(source, /className = `soma-state-entry soma-reading-entry/);
assert.doesNotMatch(source, /class="soma-detail"/, 'the old shared bottom-mounted inspector must not return');
assert.match(source, /<summary class="soma-state-row"[\s\S]*?<div class="soma-reading-detail">/, 'a Soma detail is nested immediately after its own summary');
assert.match(source, /<summary><span class="soma-region-name"[\s\S]*?<div class="soma-reading-detail">/, 'a brain-region detail is nested immediately after its own summary');
assert.match(source, /definition\.key === 'somaticHarm' \? 'somatic'/,
  'Somatic Harm history uses the factual somatic-event endpoint rather than metric history');
assert.match(source, /PREDICTED KSS \(1-9\)/);
assert.match(source, /buildScaledHistoryPath\(data\.points, 1, 9\)/);
assert.match(source, /this\._wireReading\(entry, 'brain', definition\.key\)/);
assert.match(source, /this\._wireCircadian\(entry\)/);
assert.match(source, /closeOtherReadings\([\s\S]*?details\.soma-state-entry, details\.soma-region-entry/,
  'Soma metrics and brain regions participate in one single-open accordion');
assert.match(source, /buildHistoryUrl\(this\.historyUrl, scope, key, range\)/);
assert.match(source, /THREAT AND CONTROL DETAILS[\s\S]*?\$\{threatLearning\}\$\{defensiveContext\}\$\{learnedControllability\}/,
  'the three detailed Anxiety subsystems remain available behind one secondary disclosure');
assert.doesNotMatch(
  source,
  /fetch\(buildHistoryUrl\([^\n]+\), \{ cache: 'no-store' \}\)/,
  'history graphs should allow the endpoint short-lived browser cache to make immediate reopens instant',
);
assert.match(source, /setRegionAssociation\(definition\.key, true\)/);
assert.match(source, /region\.classList\.toggle\('is-associated', associated\)/);
assert.match(source, /entry\.classList\.toggle\('is-associated', associated\)/);
assert.doesNotMatch(source, /createElementNS\([^\n]+ellipse/);

console.log('brain.test.js: all checks passed');
