// One-time, hash-guarded removal of derived Zone B prose. Public events,
// autobiographical memory and world checkpoints are deliberately not inputs.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function resetJournalContinuation({
  contextPath, backupPath, expectedSha256, now = new Date(), afterBackup = null,
}) {
  if (basename(contextPath) !== 'context.jsonl' || resolve(contextPath) === resolve(backupPath)) {
    throw new Error('only a separate context.jsonl backup may be reset');
  }
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 || '')) throw new Error('expected SHA-256 is required');
  const original = await readFile(contextPath);
  if (sha256(original) !== expectedSha256) throw new Error('context changed since approval; refusing reset');
  const lines = original.toString('utf8').split('\n').filter((line) => line.trim());
  if (lines.length !== 1) throw new Error('unexpected continuation record format');
  const record = JSON.parse(lines[0]);
  if (typeof record.s !== 'string' || !record.s.includes('47') || !/til(?:e|ing)/i.test(record.s)) {
    throw new Error('expected derived fixation is absent; refusing reset');
  }

  await mkdir(dirname(backupPath), { recursive: true });
  await writeFile(backupPath, original, { flag: 'wx' });
  if (afterBackup) await afterBackup();
  if (sha256(await readFile(contextPath)) !== expectedSha256) {
    throw new Error('context changed during backup; refusing reset');
  }

  const temporary = `${contextPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ ts: now.toISOString(), s: '' }) + '\n', { flag: 'wx' });
    if (sha256(await readFile(contextPath)) !== expectedSha256) {
      throw new Error('context changed before reset; refusing reset');
    }
    await rename(temporary, contextPath);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  return { beforeBytes: original.length, backupPath, backupSha256: expectedSha256 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const expectedSha256 = process.argv[2];
  const backupPath = process.argv[3];
  if (!expectedSha256 || !backupPath) {
    console.error('usage: node reset-journal-continuation.mjs EXPECTED_SHA256 BACKUP_PATH');
    process.exitCode = 2;
  } else {
    const contextPath = resolve(dirname(fileURLToPath(import.meta.url)), 'state', 'context.jsonl');
    resetJournalContinuation({ contextPath, backupPath, expectedSha256 })
      .then((result) => console.log(`derived continuation reset; ${result.beforeBytes} bytes backed up`))
      .catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}
