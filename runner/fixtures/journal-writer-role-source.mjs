// Reverse only the hash-pinned writer-role detector addition for older byte guards.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function beforeWriterRoleBoundary(source) {
  const start = source.indexOf('// Role imitation needs');
  const end = source.indexOf('  // Existing direct-artifact rule', start);
  assert.ok(start >= 0 && end > start, 'writer-role addition boundaries exist');
  assert.equal(createHash('sha256').update(source.slice(start, end)).digest('hex'),
    '8e2776a57017f4f4a1e7de15a958394aecbf8ac387c034824269921fcb6e0160',
    'only the exact reviewed detector addition may be reversed');
  return source.slice(0, start) + 'const TASK_CONTINUATION = [\n' + source.slice(end);
}
