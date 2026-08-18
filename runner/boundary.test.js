// boundary.test.js - the burst emit path can never let two bursts touch.
//
// Asserts the single normalisation primitive (applyBurstSeparator) that every
// emitted chunk in run.js routes through, plus the within-burst repeat guard.
// Self-checking: throws (non-zero exit) on any failure.
//
//   node runner/boundary.test.js

import assert from 'node:assert/strict';
import { burstSeparator, applyBurstSeparator } from './prompt.js';
import { repeatsWithinBurst } from './warden.js';

let n = 0;
const ok = (msg) => { n++; console.log('  ok - ' + msg); };

// ---- 1. applyBurstSeparator: returns the CHUNK, with one leading separator iff
// it would otherwise glue onto prev (so prev + result never word-glues) ----
assert.equal(applyBurstSeparator('canteen rn', 'swept'), ' swept');  // the live bug: sep spliced
assert.equal(applyBurstSeparator('canteen rn', ' swept'), ' swept'); // chunk already leads with ws
assert.equal(applyBurstSeparator('canteen rn ', 'swept'), 'swept');  // prev ends with ws
assert.equal(applyBurstSeparator('', 'swept'), 'swept');             // first ever emit
assert.equal(applyBurstSeparator('a.\n', 'b'), 'b');                 // newline counts as ws
assert.equal('canteen rn' + applyBurstSeparator('canteen rn', 'swept'), 'canteen rn swept');
ok('applyBurstSeparator splices exactly one separator, never doubling');

// ---- 2. property: the seam is never a word-glue, for any inputs ----
// After joining, if the char before the seam and the char at the seam are both
// non-whitespace they must be the ORIGINAL adjacency inside one side, never a new
// glue introduced at the burst boundary. Equivalent, testable statement: whenever
// prev ends non-ws AND chunk starts non-ws AND prev is non-empty, a space is added.
const prevs = ['', ' ', 'rn', 'rn ', 'word.', 'word.\n', 'x', '...'];
// note: empty/blank chunks are dropped by onChunk before this primitive is ever
// reached (if (!chunk.trim()) return), so every input here is a real emitted chunk
const chunks = ['swept', ' swept', '\nswept', '.', '  spaced'];
for (const p of prevs) {
  for (const c of chunks) {
    const out = applyBurstSeparator(p, c);
    const glued = p && /\S$/.test(p) && /^\S/.test(c);
    if (glued) {
      assert.equal(out, ' ' + c, `expected a separator for join(${JSON.stringify(p)}, ${JSON.stringify(c)})`);
    } else {
      assert.equal(out, c, `expected no separator for join(${JSON.stringify(p)}, ${JSON.stringify(c)})`);
    }
    // the seam itself is never two non-space chars newly stuck together
    const joined = p + out;
    const seam = p.length;
    if (seam > 0 && seam < joined.length) {
      const before = joined[seam - 1];
      const at = joined[seam];
      const newlyGlued = /\S/.test(before) && /\S/.test(at) && glued;
      assert.equal(newlyGlued, false, 'no code path may glue two bursts');
    }
  }
}
ok('for all inputs, two bursts can never touch with no whitespace between');

// ---- 3. simulate the run.js emit path across a burst boundary ----
// Replicates onChunk's contextBuf accumulation: every chunk is normalised against
// the whole emitted-so-far context before landing, so the fed-back context and the
// emitted stream are byte-identical and a boundary is impossible to bypass.
function simulateEmit(bursts) {
  let contextBuf = '';
  const emitted = [];
  for (const burst of bursts) {
    for (const raw of burst) {
      const chunk = applyBurstSeparator(contextBuf, raw);
      emitted.push(chunk);
      contextBuf += chunk;
    }
  }
  return { stream: emitted.join(''), context: contextBuf };
}
const sim = simulateEmit([['cruel echoes in here', ' must be hunger'], ['swept with eyes closed'], ['cos blacked out']]);
assert.ok(!/\brnswept\b/.test(sim.stream));
assert.ok(sim.stream.includes('hunger swept with eyes closed'), 'boundary space present: ' + sim.stream);
assert.equal(sim.stream, sim.context, 'emitted stream and fed-back context are identical');
// the classic failure: previous burst ends 'canteen rn', next starts 'swept'
const sim2 = simulateEmit([['tray cold again. canteen rn'], ['swept with eyes closed']]);
assert.ok(sim2.stream.includes('canteen rn swept'), sim2.stream);
assert.ok(!sim2.stream.includes('rnswept'));
ok('simulated emit path keeps bursts apart and stream==context');

// ---- 4. within-burst repeat guard catches a burst restating itself ----
// The live salad said "im finished the thought of" twice in one passage.
const first = 'cruel echoes in here must be hunger, im finished the thought of 4 wks ago. ';
const dupe = 'im finished the thought of fish sticks. ';
assert.equal(repeatsWithinBurst(dupe, first), true, 'verbatim ~5-word restate must be caught');
// a genuinely fresh continuation is NOT flagged
assert.equal(repeatsWithinBurst('grey slabs same every day not. ', first), false);
// nothing to compare against yet -> never a repeat
assert.equal(repeatsWithinBurst(first, ''), false);
ok('within-burst repeat guard flags verbatim restatement, not fresh prose');

console.log(`\nboundary.test.js: all ${n} checks passed`);
