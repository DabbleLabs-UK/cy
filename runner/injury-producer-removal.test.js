// injury-producer-removal.test.js - the generic per-tick "injury" producer
// (Math.random() < 0.0006 -> fireEvent('injury') -> the bare 'minor_injury'
// archetype) asserted tissue.damage_status=CONFIRMED / injury_status=ACTIVE
// with zero grounding (no cause, mechanism, body site, injury type, duration
// or recovery evidence) - a fresh, never-resolved "confirmed active injury"
// roughly ten times a day, forever. The somatic substrate itself is correct:
// a confirmed ACTIVE injury properly stays active until same-ID RESOLVED
// evidence exists. The defect was the producer making an unsupportable claim.
//
// Fix: remove the producer entirely (Option A - it establishes no real
// physical occurrence to represent even as a transient stimulus). The
// 'minor_injury' archetype itself is untouched: it remains available to any
// FUTURE producer that actually has real grounding to supply, and is exercised
// directly here to prove that path still works correctly.
//
// captureEnvironmentEvent/fireEvent/structuredEventForName are closure-scoped
// inside run.js's main() and not exported, so - consistent with
// foreground-timeout.test.js's established approach for this exact class of
// wiring - the producer's removal is proven by source inspection, and the
// substrate/archetype behavior is proven by exercising the real, exported
// modules directly.
//
// Self-checking: throws (non-zero exit) on any failure.
//
//   node runner/injury-producer-removal.test.js

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import {
  createSomaticState,
  observeSomaticRecord,
  physicalHarmOutcomeFromSomaticFacts,
} from './somatic-nociceptive-substrate.js';

let n = 0;
const ok = (msg) => { n++; console.log('  ok - ' + msg); };

const source = readFileSync(new URL('./run.js', import.meta.url), 'utf8');

// ---- 1/2/3: the random per-tick producer is gone, not merely disabled ----
assert.doesNotMatch(source, /fireEvent\('injury'\)/,
  'the generic per-tick injury trigger no longer exists');
assert.doesNotMatch(source, /Math\.random\(\)\s*<\s*0\.0006/,
  'the specific 0.0006-per-tick roll that drove it is gone, not just its call site');
assert.doesNotMatch(source, /if \(name === 'injury'\)/,
  'the dead structuredEventForName mapping for it is removed, not left unreachable');
ok('the random generic-injury producer cannot fire, so it cannot create an active confirmed injury, increase activeInjuryCount, or assert confirmed tissue damage (1/2/3)');

// ---- structural: the shared-lease/cyObserved boundary this producer used is untouched ----
assert.match(source,
  /if \(cyObserved\) \{\s*\n\s*Object\.assign\(record, observeEnvironmentRecord\(soma, record\)\);/,
  'the WORLD_ONLY / grounded-seam boundary (cyObserved gates entry to Soma) is still intact and untouched');
ok('the observation boundary this producer relied on for correctness is unchanged (8)');

// ---- 4: a genuinely grounded use of the SAME archetype still creates a proper injury ----
// (the archetype itself was never the problem - only the ungrounded random trigger was)
{
  const state = createSomaticState(Date.parse('2026-09-27T09:00:00.000Z'));
  const grounded = createEnvironmentRecord(createEnvironmentEvent('minor_injury', {
    id: 'grounded-injury-1',
    timestamp: '2026-09-27T09:00:00.000Z',
    world: {
      somatic: {
        stimulus: { id: 'stimulus:grounded-injury-1', modality: 'MECHANICAL', status: 'POINT', noxious_stimulus: 'YES' },
        body: { site: 'right_hand', laterality: 'RIGHT', certainty: 'CERTAIN' },
        tissue: { damage_status: 'CONFIRMED', injury_type: 'LACERATION', injury_status: 'ACTIVE' },
        knowledge_status: 'PARTIAL',
        field_provenance: { tissue_damage: 'STRUCTURED_WORLD_FACT', injury_type: 'STRUCTURED_WORLD_FACT', body_site: 'STRUCTURED_WORLD_FACT' },
      },
    },
  }));
  const result = observeSomaticRecord(state, grounded);
  assert.equal(result.injuryUpdate.reason, 'injury_created');
  const injuryId = grounded.world_event.world.somatic.tissue.injury_id;
  assert.equal(state.injuries[injuryId].status, 'ACTIVE');
  assert.equal(state.injuries[injuryId].bodySite, 'right_hand');
  assert.equal(physicalHarmOutcomeFromSomaticFacts(grounded.world_event.world.somatic), 'occurred');
  ok('a properly grounded somatic event (real body site, mechanism, injury type) still creates a confirmed active injury via the untouched archetype and substrate (4)');
}

console.log(`\ninjury-producer-removal.test.js: all ${n} checks passed`);
