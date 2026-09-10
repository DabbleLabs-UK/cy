import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  EXPERIENCED_METRICS,
  BRAIN_REGIONS,
  IMPLEMENTATION_STATUS,
  canRenderDynamicActivity,
} from '../public/assets/brain.js';
import { reconcileSoma, somaSnapshot, tickSoma } from './soma.js';
import { implementationRegistry, implementationEntry } from './implementation-registry.js';

const here = dirname(fileURLToPath(import.meta.url));
const soma = reconcileSoma(null, { now: 1 });
tickSoma(soma, { physical: { hunger: 0.7 }, monotony: 0.2, now: 5001 });
const snapshot = somaSnapshot(soma);
assert.equal(snapshot.sleepHomeostasis.publicLabel, 'LIVE');
assert.equal(implementationEntry('soma_variables', 'fatigue').implementation_status, 'PROVISIONAL');
assert.equal(implementationEntry('soma_subsystems', 'circadian_process_c').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'circadian_entrainment').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('brain_regions', 'scnCircadian').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('brain_regions', 'hypothalamic').implementation_status, 'NOT_IMPLEMENTED');

assert.deepEqual(EXPERIENCED_METRICS.map((metric) => metric.key),
  ['anxiety', 'arousal', 'pain', 'hunger', 'fatigue', 'loneliness', 'anger', 'rumination']);
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
assert.match(source, /Brain regions are functional analogies, not measured physiology/);
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
assert.match(source, /className = `soma-region-entry/);
assert.match(source, /className = `soma-state-entry soma-reading-entry/);
assert.doesNotMatch(source, /class="soma-detail"/, 'the old shared bottom-mounted inspector must not return');
assert.match(source, /<summary class="soma-state-row"[\s\S]*?<div class="soma-reading-detail">/, 'a Soma detail is nested immediately after its own summary');
assert.match(source, /<summary><span class="soma-region-name"[\s\S]*?<div class="soma-reading-detail">/, 'a brain-region detail is nested immediately after its own summary');
assert.match(source, /this\._wireReading\(entry, 'metric', definition\.key\)/);
assert.match(source, /this\._wireReading\(entry, 'brain', definition\.key\)/);
assert.match(source, /this\._wireCircadian\(entry\)/);
assert.match(source, /buildHistoryUrl\(this\.historyUrl, scope, key, range\)/);
assert.match(source, /setRegionAssociation\(definition\.key, true\)/);
assert.match(source, /region\.classList\.toggle\('is-associated', associated\)/);
assert.match(source, /entry\.classList\.toggle\('is-associated', associated\)/);
assert.doesNotMatch(source, /createElementNS\([^\n]+ellipse/);

console.log('brain.test.js: all checks passed');
