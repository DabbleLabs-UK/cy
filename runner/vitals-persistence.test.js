import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  initialVitals,
  loadVitals,
  saveVitals,
  validateVitalsState,
  vitalsPersistenceStatus,
} from './vitals.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const validState = (extra = {}) => ({ ...initialVitals(), ...extra });

async function withTemp(prefix, fn) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    await fn(dir, join(dir, 'vitals.json'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function seed(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2));
}

async function diskJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function assertNoTempFiles(dir) {
  const names = await readdir(dir);
  assert.equal(names.some((name) => name.endsWith('.tmp')), false, 'temporary files are cleaned up');
}

// A. A normal save replaces the authoritative file and retains one prior snapshot.
await withTemp('cy-vitals-a-', async (dir, path) => {
  const original = validState({ day: 7 });
  await seed(path, original);
  const vitals = await loadVitals(path);
  vitals.day = 8;
  await saveVitals(path, vitals);
  const current = await diskJson(path);
  const previous = await diskJson(join(dir, 'vitals.previous.json'));
  assert.equal(current.day, 8);
  assert.equal(current.persistenceFormatVersion, 1);
  assert.equal(previous.day, 7);
  assert.equal(vitalsPersistenceStatus(vitals).lastValidationResult, 'valid');
  await assertNoTempFiles(dir);
});

// B. A partial temporary write followed by an I/O failure never touches authority.
await withTemp('cy-vitals-b-', async (dir, path) => {
  const original = validState({ day: 9 });
  await seed(path, original);
  const vitals = await loadVitals(path, { persistence: {
    maxAttempts: 1,
    retryDelaysMs: [],
    hooks: {
      beforeWrite: ({ targetPath, text }) => targetPath === path ? { text: text.slice(0, 41) } : undefined,
      afterWrite: ({ targetPath }) => {
        if (targetPath === path) throw new Error('injected mid-write failure');
      },
    },
  } });
  vitals.day = 10;
  await assert.rejects(() => saveVitals(path, vitals), /injected mid-write failure/);
  assert.deepEqual(await diskJson(path), original);
  await assertNoTempFiles(dir);
});

// C. A closed but truncated candidate fails parse/validation before replacement.
await withTemp('cy-vitals-c-', async (dir, path) => {
  const original = validState({ day: 11 });
  await seed(path, original);
  const vitals = await loadVitals(path, { persistence: {
    maxAttempts: 1,
    retryDelaysMs: [],
    hooks: {
      beforeWrite: ({ targetPath, text }) => targetPath === path ? { text: text.slice(0, 73) } : undefined,
    },
  } });
  vitals.day = 12;
  await assert.rejects(() => saveVitals(path, vitals), SyntaxError);
  assert.deepEqual(await diskJson(path), original);
  await assertNoTempFiles(dir);
});

// C2. A failure immediately before replacement leaves authority intact.
await withTemp('cy-vitals-c2-', async (dir, path) => {
  const original = validState({ day: 12 });
  await seed(path, original);
  const vitals = await loadVitals(path, { persistence: {
    maxAttempts: 1,
    retryDelaysMs: [],
    hooks: {
      beforeRename: ({ targetPath }) => {
        if (targetPath === path) throw new Error('injected replacement failure');
      },
    },
  } });
  vitals.day = 13;
  await assert.rejects(() => saveVitals(path, vitals), /injected replacement failure/);
  assert.deepEqual(await diskJson(path), original);
  await assertNoTempFiles(dir);
});

// D. Invalid authority is preserved for forensics and recovered from validated previous state.
await withTemp('cy-vitals-d-', async (dir, path) => {
  const previous = validState({ day: 13, cognition: { memory: { episodes: [{ id: 'kept' }] } } });
  await writeFile(path, '{"physical":');
  await seed(join(dir, 'vitals.previous.json'), previous);
  const vitals = await loadVitals(path);
  assert.equal(vitals.day, 13);
  assert.deepEqual(vitals.cognition.memory.episodes, [{ id: 'kept' }]);
  assert.equal(vitalsPersistenceStatus(vitals).startupRecoveryUsed, true);
  assert.deepEqual(await diskJson(path), previous);
  assert.equal(await readFile(join(dir, 'vitals.corrupt.json'), 'utf8'), '{"physical":');
});

// E. Two invalid copies fail closed. The invalid authority is not replaced by defaults.
await withTemp('cy-vitals-e-', async (dir, path) => {
  await writeFile(path, '{bad authority');
  await writeFile(join(dir, 'vitals.previous.json'), '{bad previous');
  await assert.rejects(
    () => loadVitals(path),
    (error) => error && error.code === 'CY_STATE_RECOVERY_REQUIRED',
  );
  assert.equal(await readFile(path, 'utf8'), '{bad authority');
});

// F. An actually empty installation may initialise once and then carries a marker and recovery copy.
await withTemp('cy-vitals-f-', async (dir, path) => {
  const vitals = await loadVitals(path);
  assert.equal(vitalsPersistenceStatus(vitals).firstInstall, true);
  await saveVitals(path, vitals);
  validateVitalsState(await diskJson(path), { requireFormatVersion: true });
  validateVitalsState(await diskJson(join(dir, 'vitals.previous.json')), { requireFormatVersion: true });
  assert.equal((await diskJson(join(dir, 'vitals.initialized.json'))).persistenceFormatVersion, 1);
  const restarted = await loadVitals(path);
  assert.equal(vitalsPersistenceStatus(restarted).firstInstall, false);
});

// F2. Missing state in a directory with continuity evidence is not a first install.
await withTemp('cy-vitals-f2-', async (dir, path) => {
  await writeFile(join(dir, 'context.jsonl'), '{"s":"existing continuity"}\n');
  await assert.rejects(
    () => loadVitals(path),
    (error) => error && error.code === 'CY_STATE_RECOVERY_REQUIRED',
  );
});

// G. Overlapping requests serialize and coalesce, leaving the newest requested state on disk.
await withTemp('cy-vitals-g-', async (_dir, path) => {
  await seed(path, validState({ day: 20 }));
  let releaseFirst;
  let firstReachedRename;
  const firstAtRename = new Promise((resolve) => { firstReachedRename = resolve; });
  const release = new Promise((resolve) => { releaseFirst = resolve; });
  let renameVisits = 0;
  const vitals = await loadVitals(path, { persistence: {
    recoveryRefreshMs: 60_000,
    hooks: {
      beforeRename: async ({ targetPath }) => {
        if (targetPath !== path || renameVisits++ !== 0) return;
        firstReachedRename();
        await release;
      },
    },
  } });
  vitals.day = 21;
  const firstSave = saveVitals(path, vitals);
  await firstAtRename;
  vitals.day = 22;
  const secondSave = saveVitals(path, vitals);
  vitals.day = 23;
  const thirdSave = saveVitals(path, vitals);
  releaseFirst();
  await Promise.all([firstSave, secondSave, thirdSave]);
  assert.equal((await diskJson(path)).day, 23);
  assert.ok(vitalsPersistenceStatus(vitals).coalescedSaveCount >= 1);
});

// H. A write-open failure is bounded and retains the last good authority.
await withTemp('cy-vitals-h-', async (dir, path) => {
  const original = validState({ day: 23 });
  await seed(path, original);
  const vitals = await loadVitals(path, { persistence: {
    maxAttempts: 2,
    retryDelaysMs: [0],
    hooks: {
      beforeWrite: ({ targetPath }) => {
        if (targetPath === path) throw new Error('injected disk write error');
      },
    },
  } });
  vitals.day = 24;
  await assert.rejects(() => saveVitals(path, vitals), /injected disk write error/);
  assert.deepEqual(await diskJson(path), original);
  assert.equal(vitalsPersistenceStatus(vitals).failedSaveCount, 1);
  await assertNoTempFiles(dir);
});

// I. The real failure scale is covered: a state just over 13 MiB round-trips intact.
await withTemp('cy-vitals-i-', async (_dir, path) => {
  const vitals = await loadVitals(path);
  const payload = 'x'.repeat(13 * 1024 * 1024 + 257);
  vitals.cognition = { memory: { largePayload: payload } };
  await saveVitals(path, vitals);
  const bytes = Buffer.byteLength(await readFile(path, 'utf8'), 'utf8');
  assert.ok(bytes > 13 * 1024 * 1024);
  const restarted = await loadVitals(path);
  assert.equal(restarted.cognition.memory.largePayload.length, payload.length);
});

// J. Numeric and nested Soma state survives an exact JSON round trip.
await withTemp('cy-vitals-j-', async (_dir, path) => {
  const vitals = await loadVitals(path);
  vitals.day = 31;
  vitals.physical.pain = 0.123456789;
  vitals.mental.anxiety = 0.987654321;
  vitals.cognition = {
    prediction: { error: 0.625, history: [0, 0.25, 1] },
    experienced: { metrics: { anxiety: { value: 63.25, contributions: [{ source: 'event-1', delta: 4.5 }] } } },
  };
  const expected = clone({
    day: vitals.day,
    physical: vitals.physical,
    mental: vitals.mental,
    cognition: vitals.cognition,
  });
  await saveVitals(path, vitals);
  const restarted = await loadVitals(path);
  assert.deepEqual(clone({
    day: restarted.day,
    physical: restarted.physical,
    mental: restarted.mental,
    cognition: restarted.cognition,
  }), expected);
});

// K. Memory, dream, world and Soma collections are opaque payloads and are not reset or pruned.
await withTemp('cy-vitals-k-', async (_dir, path) => {
  const vitals = await loadVitals(path);
  vitals.cognition = {
    memory: { episodes: [{ id: 'memory-1', text: 'eight by four', privateSenderKey: 'sender-7' }] },
    feeding: { records: [{ eventId: 'meal-1', intake: 'full' }] },
    sleepHomeostasis: { processS: 0.4421, observations: [{ asleep: true, at: 1234 }] },
    somaticNociceptive: { injuries: [{ id: 'injury-1', active: true }] },
  };
  vitals.dreamPool = [{ id: 'dream-1', fragments: ['door', 'number'] }];
  vitals.worldSimulation = { version: 4, opportunities: [{ id: 'association-1', status: 'OPEN' }] };
  vitals.instrumentalAgency = { open: [{ id: 'choice-1', actions: ['engage', 'withdraw'] }] };
  const expected = clone({
    cognition: vitals.cognition,
    dreamPool: vitals.dreamPool,
    worldSimulation: vitals.worldSimulation,
    instrumentalAgency: vitals.instrumentalAgency,
  });
  await saveVitals(path, vitals);
  const restarted = await loadVitals(path);
  assert.deepEqual(clone({
    cognition: restarted.cognition,
    dreamPool: restarted.dreamPool,
    worldSimulation: restarted.worldSimulation,
    instrumentalAgency: restarted.instrumentalAgency,
  }), expected);
});

console.log('vitals-persistence.test.js: all checks passed');
