import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { somaticHistoryPresentation, somaticPublicFacts } from '../public/assets/brain.js';

const clear = {
  status: 'implemented',
  headline: { category: 'CLEAR', display: 'NO ACTIVE INJURY', activeNoxiousStimulusCount: 0 },
  activeInjuryCount: 0,
  tissueDamageStatus: 'NONE',
  totalSomaticEvents: 1,
};
const routine = {
  eventType: 'cell_search_aftermath_observed',
  stimulus: { id: null, modality: 'UNKNOWN', status: 'UNKNOWN', noxiousStimulus: 'UNKNOWN' },
  body: { site: 'UNKNOWN' },
  tissue: { damageStatus: 'NONE', injuryId: null, injuryStatus: 'UNKNOWN' },
};

// CLEAR with no relevant event must not turn an absent fact into UNKNOWN.
const empty = somaticPublicFacts({ ...clear, latestSomaticEvent: null }, true);
assert.equal(empty.showClearNote, true);
assert.equal(empty.hasEventFacts, false);
assert.equal(empty.facts.injuries, '0');
assert.equal(empty.facts.damage, 'NONE');
assert.equal(empty.facts.latest, '');
assert.equal(empty.facts['stimulus-status'], '');
assert.equal(empty.facts['injury-status'], '');

// A later routine event asserting no injury is not an unknown harm observation.
const unrelated = somaticPublicFacts({ ...clear, latestSomaticEvent: routine }, true);
assert.equal(unrelated.showClearNote, true);
assert.equal(unrelated.hasEventFacts, false);

// An active injury remains visible even when the latest event is unrelated.
const injury = somaticPublicFacts({
  ...clear,
  headline: { category: 'ACTIVE_INJURY', display: '1 ACTIVE INJURY', activeNoxiousStimulusCount: 0 },
  activeInjuryCount: 1,
  tissueDamageStatus: 'CONFIRMED',
  latestSomaticEvent: routine,
}, true);
assert.equal(injury.showClearNote, false);
assert.equal(injury.facts.injuries, '1');
assert.equal(injury.facts.damage, 'CONFIRMED');

const noxious = somaticPublicFacts({
  ...clear,
  headline: { category: 'ACTIVE_NOXIOUS_STIMULUS', display: 'ACTIVE NOXIOUS STIMULUS', activeNoxiousStimulusCount: 1 },
  latestSomaticEvent: {
    ...routine,
    stimulus: { id: 'stimulus-1', modality: 'MECHANICAL', status: 'ACTIVE', noxiousStimulus: 'YES' },
  },
}, true);
assert.equal(noxious.showClearNote, false);
assert.equal(noxious.hasEventFacts, true);
assert.equal(noxious.facts['stimulus-status'], 'ACTIVE');

const resolved = somaticPublicFacts({
  ...clear,
  latestSomaticEvent: {
    ...routine,
    tissue: { damageStatus: 'NONE', injuryId: 'injury-1', injuryStatus: 'RESOLVED' },
  },
}, true);
assert.equal(resolved.showClearNote, false);
assert.equal(resolved.facts['injury-status'], 'RESOLVED');

// UNKNOWN remains visible when a real identified event lacks that detail.
const uncertain = somaticPublicFacts({
  ...clear,
  tissueDamageStatus: 'UNKNOWN',
  latestSomaticEvent: {
    ...routine,
    stimulus: { id: 'stimulus-2', modality: 'UNKNOWN', status: 'UNKNOWN', noxiousStimulus: 'UNKNOWN' },
  },
}, true);
assert.equal(uncertain.hasEventFacts, true);
assert.equal(uncertain.facts.damage, 'UNKNOWN');
assert.equal(uncertain.facts['stimulus-status'], 'UNKNOWN');

assert.deepEqual(somaticHistoryPresentation([]), {
  showPlot: false, note: 'No bodily harm in this period.',
});
assert.equal(somaticHistoryPresentation([{}]).showPlot, true);

const source = await readFile(fileURLToPath(new URL('../public/assets/brain.js', import.meta.url)), 'utf8');
assert.match(source, /Injuries Cy is carrying, and whether they're still with him\./);
assert.doesNotMatch(source, /still healing|how it's healing/i);
assert.match(source, /chart\.hidden = !history\.showPlot/);
assert.match(source, /markers\.hidden = !history\.showPlot/);
