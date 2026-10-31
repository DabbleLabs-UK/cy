// Reverse only the reviewed dream-rendering delta for older byte-pinning tests.
// Any other prompt change remains visible to their original assertions.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const DREAM_CUE_BASE = '14315366ad7d21cc569889cfd834c4c91cfc48c1';
const first = '  // dream: a murmur (or a night-waking line)';
const last = '  // journal / sleep:';
function region(source) {
  const start = source.indexOf(first), end = source.indexOf(last, start);
  assert.ok(start >= 0 && end > start, 'dream rendering boundaries exist');
  return { start, end, text: source.slice(start, end) };
}
export function beforeDreamCueRemoval(source) {
  const current = region(source);
  assert.equal(createHash('sha256').update(current.text).digest('hex'),
    '0d931987827e8bf209018be6573d1fbfc62219f6230c9986863f338789686864',
    'only the reviewed dream-rendering delta may be reversed');
  const previous = execFileSync('git', ['show', `${DREAM_CUE_BASE}:runner/prompt.js`],
    { cwd: new URL('../..', import.meta.url), encoding: 'utf8' }).replace(/\r\n/g, '\n');
  return source.slice(0, current.start) + region(previous).text + source.slice(current.end);
}
