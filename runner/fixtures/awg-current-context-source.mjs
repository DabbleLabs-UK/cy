// Exact reviewed AWG-only regions for older whole-source regression guards.
// Each replacement is hash-pinned; changes outside these regions still reach
// the historical byte comparisons, and edits inside them fail this fixture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const base = '8952baf86dc47e86c7536c84b5f390c762086884';
let baseline;
const spans = [
  ['  async function runAwgDuringIdle(', '  // Interruptible idle:',
    '2bc76c5a693c1c16cc993abf404abc195c1dc327f08a6e5590880bbf20d60ab9'],
  ['  function captureEnvironmentEvent(', '  function rememberEnvironmentRecord(',
    '1e952f4d7e1962fc420243567534c3096693a1901efaa6620b79729d1eb76343'],
  ['  function publishEpisodeEvent(', '  function queueExerciseEvent(',
    'c601ff5f82ae6e1272ed163ed79f150428fac6779a3473b88be8e6e425a22e88'],
];
export function beforeAwgCurrentContext(source) {
  if (!source.includes('    const admittedLocationFence = awgLocationFence(')) return source;
  baseline ||= execFileSync('git', ['show', `${base}:runner/run.js`],
    { encoding: 'utf8', maxBuffer: 2 ** 23 }).replace(/\r\n/g, '\n');
  for (const [first, last, digest] of spans) {
    const start = source.indexOf(first), end = source.indexOf(last, start);
    assert.ok(start >= 0 && end > start, 'exact approved AWG region');
    assert.equal(createHash('sha256').update(source.slice(start, end)).digest('hex'), digest,
      'exact approved AWG context-boundary delta');
    const oldStart = baseline.indexOf(first), oldEnd = baseline.indexOf(last, oldStart);
    source = source.slice(0, start) + baseline.slice(oldStart, oldEnd) + source.slice(end);
  }
  for (const line of ['  awgLocationFence,\n', '  AWG_RECENT_RUN_LIMIT,\n']) {
    assert.equal(source.split(line).length - 1, 1);
    source = source.replace(line, '');
  }
  return source;
}

export function beforeAwgLocationFence(source) {
  const added = '// Private, call-local identity for the eligibility already used by AWG. Keep\n'
    + '// completed restriction identities: a search/lockdown can start AND end without\n'
    + '// moving Cy. Do not include observation counters or canonical delivery links.\n'
    + 'export function awgLocationFence(state) {\n'
    + '  if (!awgLocationEligible(state) || !state.current.entered_at) return null;\n'
    + '  const episode = value => value ? [value.id, value.started_at, value.status] : null;\n'
    + '  return JSON.stringify([\n'
    + '    state.current.id, state.current.entered_at, state.lastTransitionAt,\n'
    + '    state.current.regime_activity,\n'
    + '    episode(state.activeRegimeEpisode), episode(state.activeExerciseEpisode),\n'
    + '    episode(state.activeRoutineEpisode), episode(state.searchEpisode),\n'
    + '    episode(state.lockdownEpisode),\n'
    + '  ]);\n}\n\n';
  assert.equal(source.split(added).length - 1, 1, 'exact AWG location identity helper');
  return source.replace(added, '');
}
