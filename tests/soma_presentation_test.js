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

// SOMA RESET PHASE 2: exactly two promoted subsystems - Anxiety, then
// Homeostatic Sleep Pressure (Process S) - render above one collapsed
// quarantine section, in that DOM order. Everything else (Process C, the
// predicted-KSS diagnostic, other readings, the brain-region map, circuit
// diagnostics, legacy stats) stays inside the quarantine.
const anxietyPromotedIndex = brainSource.indexOf('class="soma-anxiety-promoted"');
const sleepPressurePromotedIndex = brainSource.indexOf('class="soma-sleep-pressure-promoted"');
const quarantineIndex = brainSource.indexOf('class="soma-legacy-quarantine"');
assert.ok(anxietyPromotedIndex >= 0, 'a promoted Anxiety block must exist');
assert.ok(sleepPressurePromotedIndex >= 0, 'a promoted Homeostatic Sleep Pressure block must exist');
assert.ok(quarantineIndex >= 0, 'a quarantine wrapper for the old Soma presentation must exist');
assert.ok(anxietyPromotedIndex < sleepPressurePromotedIndex,
  'Anxiety must remain promoted subsystem #1, rendering before Homeostatic Sleep Pressure');
assert.ok(sleepPressurePromotedIndex < quarantineIndex,
  'the promoted Homeostatic Sleep Pressure block must render before the quarantined diagnostics');

const promotedBlock = brainSource.slice(anxietyPromotedIndex, quarantineIndex);
assert.match(promotedBlock, /not a measurement of felt anxiety/,
  'the promoted block must carry a plain-English disclaimer distinguishing computed state from felt anxiety');
assert.doesNotMatch(promotedBlock, /soma-public-readout|brain-figure|soma-region-list|CIRCUITS|legacy-box/,
  'the promoted blocks must not contain any of the quarantined legacy markup');

const sleepPressurePromotedBlock = brainSource.slice(sleepPressurePromotedIndex, quarantineIndex);
assert.match(sleepPressurePromotedBlock, /HOMEOSTATIC SLEEP PRESSURE/,
  'the promoted block must carry the registry-authoritative subsystem name');
assert.match(sleepPressurePromotedBlock,
  /Sleep pressure is a modelled homeostatic drive that rises during scheduled wake and falls during scheduled sleep\. It is not a measurement of how tired Cy feels\./,
  'the promoted block must carry the exact plain-English Process S disclaimer');
assert.match(sleepPressurePromotedBlock, /\$\{processSMarkup\(this\.sleepHomeostasisStatus, this\.admin\)\}/,
  'the promoted block must render Process S via its own dedicated markup builder');
assert.match(sleepPressurePromotedBlock, /soma-sleep-pressure-overall-status/,
  'the promoted block must carry a LIVE/CALIBRATING status readout');
assert.doesNotMatch(sleepPressurePromotedBlock, /processCMarkup|predictedSleepinessMarkup/,
  'Process C and the predicted-KSS diagnostic must stay subordinate, not promoted alongside Process S');

const processSMarkupBody = brainSource.slice(
  brainSource.indexOf('function processSMarkup('),
  brainSource.indexOf('function processCMarkup('),
);
assert.ok(processSMarkupBody.length > 0, 'a dedicated processSMarkup builder must exist');
assert.match(processSMarkupBody, /class="sleep-pressure-value"/,
  'processSMarkup must show the current Process S estimate');
assert.match(processSMarkupBody, /class="sleep-homeostasis-range"/,
  'processSMarkup must show the existing S uncertainty/range');
assert.match(processSMarkupBody, /class="soma-history sleep-homeostasis-history"/,
  'processSMarkup must show a real persisted Process S history graph, not a placeholder');

const quarantineBlock = brainSource.slice(quarantineIndex);
assert.match(quarantineBlock,
  /class="soma-legacy-quarantine">\s*<summary>PREVIOUS MODELS \/ DIAGNOSTICS<\/summary>/,
  'the quarantine section must be a collapsed <details> with a plain "previous models" label');
assert.doesNotMatch(quarantineBlock.slice(0, quarantineBlock.indexOf('PREVIOUS MODELS') + 40), /\bopen\b/,
  'the quarantine <details> must not carry an open attribute (collapsed by default)');
for (const marker of ['soma-public-readout', 'brain-figure', 'soma-region-list', 'soma-diagnostics', 'legacy-box']) {
  assert.ok(quarantineBlock.includes(marker), `quarantine section must still preserve ${marker}`);
}
assert.match(quarantineBlock, /circadian-process-card/,
  'Process C must remain inside the quarantine, explicitly schedule-estimated');
assert.match(quarantineBlock, /PHASE SCHEDULE-ESTIMATED/,
  'Process C must stay labelled as schedule-estimated rather than observed');
assert.match(quarantineBlock, /predicted-sleepiness-card/,
  'the predicted-KSS diagnostic must remain inside the quarantine, not promoted');
assert.match(quarantineBlock, /predictedSleepinessMarkup\(this\.predictedSleepinessStatus, this\.admin\)/,
  'the predicted-KSS diagnostic must be rendered inside the quarantine loop, not the promoted block');
assert.match(brainSource, /PREDICTED KSS \(1-9\)/,
  'the predicted-KSS reading must stay caveated as a diagnostic, not a promoted subjective state');

// The Anxiety entry itself must render into the promoted readout, not the
// legacy one, regardless of DOM/registry state - this is a code-path check,
// not just a static-markup check.
assert.match(brainSource,
  /\(definition\.key === 'anxiety' \? anxietyReadout : readout\)\.appendChild\(entry\)/,
  'the anxiety reading must be routed to the promoted readout container at build time');

console.log('soma_presentation_test.js: all checks passed');
