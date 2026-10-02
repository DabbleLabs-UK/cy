import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetJournalContinuation } from './reset-journal-continuation.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const dir = await mkdtemp(join(tmpdir(), 'cy-journal-reset-'));
const contextPath = join(dir, 'context.jsonl');
const backupPath = join(dir, 'backups', 'context.jsonl');
const worldPath = join(dir, 'world-state.json');
const memoryPath = join(dir, 'autobiographical-memory.json');
const original = Buffer.from(JSON.stringify({
  ts: '2026-10-02 16:58:13.249',
  s: 'thos 47 tiles again. lockey knows somethn. ',
}) + '\n');
await writeFile(contextPath, original);
await writeFile(worldPath, '{"cell":"CELL"}');
await writeFile(memoryPath, '{"memories":["real event remains"]}');

const result = await resetJournalContinuation({
  contextPath, backupPath, expectedSha256: hash(original), now: new Date('2026-10-02T17:00:00Z'),
});
assert.equal(result.beforeBytes, original.length);
assert.deepEqual(await readFile(backupPath), original);
assert.equal(JSON.parse(await readFile(contextPath, 'utf8')).s, '');
assert.equal(await readFile(worldPath, 'utf8'), '{"cell":"CELL"}');
assert.equal(await readFile(memoryPath, 'utf8'), '{"memories":["real event remains"]}');
console.log('  ok - stale derived continuation is backed up and cleared; world/memory remain intact');

await writeFile(contextPath, original);
await assert.rejects(resetJournalContinuation({
  contextPath, backupPath: join(dir, 'backups', 'stale.jsonl'), expectedSha256: hash(Buffer.from('old')),
}), /context changed since approval/);
assert.deepEqual(await readFile(contextPath), original);
console.log('  ok - stale approval hash cannot clear a changed context');

await assert.rejects(resetJournalContinuation({
  contextPath, backupPath: join(dir, 'backups', 'raced.jsonl'), expectedSha256: hash(original),
  afterBackup: () => writeFile(contextPath, '{"ts":"later","s":"new thought"}\n'),
}), /context changed during backup/);
assert.equal(JSON.parse(await readFile(contextPath, 'utf8')).s, 'new thought');
console.log('  ok - concurrent continuation update is not erased');

await writeFile(contextPath, '{"ts":"later","s":"Bill went to his cell."}\n');
await assert.rejects(resetJournalContinuation({
  contextPath, backupPath: join(dir, 'backups', 'unrelated.jsonl'),
  expectedSha256: hash(await readFile(contextPath)),
}), /expected derived fixation is absent/);
console.log('  ok - unrelated continuation cannot be cleared by this one-time operation');
