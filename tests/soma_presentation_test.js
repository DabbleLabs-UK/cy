import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  OPERATIONAL_ANXIETY_BANDS,
  buildCategoricalStepPath,
  operationalAnxietyDrivers,
  publicSomaLabel,
} from '../public/assets/brain.js';

const HOUR = 60 * 60 * 1000;
const end = Date.UTC(2026, 8, 14, 0, 15, 0);
const transitions = [
  { ts: end - 50 * 60 * 1000, state: 'QUIET' },
  { ts: end - 30 * 60 * 1000, state: 'ANTICIPATING' },
  { ts: end - 10 * 60 * 1000, state: 'UNKNOWN' },
  { ts: end - 5 * 60 * 1000, state: 'THREAT_ONGOING' },
];

for (const duration of [HOUR, 24 * HOUR, 7 * 24 * HOUR]) {
  const path = buildCategoricalStepPath(transitions, end - duration, end);
  assert.match(path, /^M/, `categorical history must render for ${duration}ms`);
  assert.match(path, /H280\.0$/, 'rolling history must extend to the exact window end');
}
assert.match(buildCategoricalStepPath(transitions, end - HOUR, end), /V72\.0/,
  'UNKNOWN must occupy its own display band rather than becoming a numeric value');
assert.deepEqual(OPERATIONAL_ANXIETY_BANDS,
  ['THREAT_ONGOING', 'THREAT_IMMINENT', 'ANTICIPATING', 'QUIET', 'UNKNOWN']);

const snapshot = {
  status: 'THREAT_ONGOING',
  sourceEnvironmentEventIds: ['private-event-id'],
  currentConcern: {
    outcomeClass: 'COERCIVE_LOSS_OF_CONTROL',
    activeCues: [{ label: 'lockdown signal' }],
    objectiveControllability: 'NONE',
    temporalStatus: 'ONGOING',
    learnedCueOutcomeEvidence: [{
      cue: { label: 'lockdown signal' },
      evidence: { posterior: { resolvedObservations: 5, outcomesOccurred: 5, outcomesDidNotOccur: 0 } },
    }],
  },
};
const drivers = operationalAnxietyDrivers(snapshot);
assert.deepEqual(drivers, [
  'Lockdown signal is present.',
  'Cy has no control over the current outcome.',
  'Lockdown signal has preceded 5 adverse and 0 safe resolutions.',
  'The current threat is happening now.',
]);
assert.ok(drivers.length >= 2 && drivers.length <= 4, 'driver selection must stay concise');
assert.doesNotMatch(JSON.stringify(drivers), /private-event-id/, 'driver text must not leak source IDs');
assert.deepEqual(operationalAnxietyDrivers({ status: 'QUIET', currentConcern: null }),
  ['No active structured defensive concern is present.']);
assert.equal(publicSomaLabel('event:lockdown_signal'), 'lockdown signal');
assert.equal(publicSomaLabel('eventenv-d1e2c9df-08c0-48ea-bba4-2c6d22ee811e'), 'structured cue',
  'opaque event identifiers must not enter the visitor-facing panel');

const brainSource = await readFile(new URL('../public/assets/brain.js', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../public/assets/style.css', import.meta.url), 'utf8');
assert.match(brainSource, /<summary>MODEL DETAILS<\/summary>/,
  'technical Anxiety detail must sit behind a secondary disclosure');
assert.match(brainSource, /WHAT IS DRIVING THIS/);
assert.match(brainSource, /Hover or focus a transition marker for its timestamp and categorical state/);
assert.doesNotMatch(brainSource, /class="operational-anxiety-axis"/,
  'the Anxiety history must not permanently print the categorical y-axis words');
assert.match(brainSource,
  /operational-anxiety-state-bar" data-state="UNKNOWN"[\s\S]*?<i><\/i><i><\/i><i><\/i><i><\/i>/,
  'the Anxiety summary must render exactly four discrete categorical positions');
assert.match(brainSource,
  /querySelector\('\.operational-anxiety-state-bar'\)\.dataset\.state = state/,
  'the categorical bar must follow the established Anxiety state directly');
assert.match(brainSource, /marker\.setAttribute\('aria-label', markerLabel\)/,
  'history transition markers must expose timestamp and categorical state');
assert.match(styleSource,
  /\.operational-anxiety-state-bar \{[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/,
  'the Anxiety indicator must use four discrete positions');
assert.match(styleSource,
  /data-state="QUIET"[\s\S]*data-state="ANTICIPATING"[\s\S]*data-state="THREAT_IMMINENT"[\s\S]*data-state="THREAT_ONGOING"/,
  'only the four established ordered categories may fill bar positions');
assert.match(styleSource,
  /data-state="UNKNOWN"[\s\S]*border-style: dashed/,
  'UNKNOWN must use an empty unknown treatment rather than an invented position');
assert.match(styleSource,
  /grid-template-columns: clamp\(340px, 27vw, 400px\) minmax\(360px, 1fr\) clamp\(300px, 25vw, 380px\)/,
  'large desktop layout must reserve 340-400px for Soma');
assert.match(styleSource, /@media \(max-width: 1180px\)[\s\S]*"timeline timeline"[\s\S]*"soma side"/,
  'narrow desktops must reflow instead of shrinking the Soma rail');
assert.match(styleSource, /\.soma-reading-description,[\s\S]*font-size: 13px/,
  'substantive Soma text must have a 13px minimum rule');
assert.match(styleSource, /\.soma-region-name \{[\s\S]*font-size: 12\.5px/,
  'brain-region names must be readable');
assert.match(styleSource,
  /\.soma-state-row \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto/,
  'collapsed Soma readings must use a two-column, two-line grid without text collisions');
assert.match(styleSource,
  /\.soma-state-trend \{[\s\S]*grid-column: 1;[\s\S]*grid-row: 2;/,
  'trend or model context must sit on the second line');
assert.match(styleSource,
  /\.soma-state-row > strong \{[\s\S]*grid-column: 2;[\s\S]*grid-row: 2;/,
  'the reading value must sit on the second line opposite its context');

console.log('soma_presentation_test.js: all checks passed');
