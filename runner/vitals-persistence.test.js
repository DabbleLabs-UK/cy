import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  initialVitals,
  loadVitals,
  saveVitals,
  scheduleVitalsSave,
  vitalsPersistenceStatus,
} from './vitals.js';
import { sectionedStorePaths } from './sectioned-state-store.js';

const validState = (extra = {}) => ({ ...initialVitals(), ...extra });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function allNames(dir, prefix = '') {
  const names = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) names.push(...await allNames(join(dir, entry.name), relative));
    else names.push(relative);
  }
  return names.sort();
}

async function assertNoTempFiles(dir) {
  assert.equal((await allNames(dir)).some((name) => name.endsWith('.tmp')), false);
}

const largeEpisodes = (count = 320) => Array.from({ length: count }, (_, index) => ({
  id: `memory-${index}`,
  text: `episode ${index} ${'x'.repeat(120)}`,
  activation: index / count,
}));

// A. A legacy monolith migrates without mutation and remains as a preserved fallback.
await withTemp('cy-vitals-a-', async (dir, path) => {
  const original = validState({
    day: 7,
    cognition: { memory: { episodes: largeEpisodes(80), nextId: 81 } },
  });
  await seed(path, original);
  const vitals = await loadVitals(path);
  await saveVitals(path, vitals);
  assert.deepEqual(await diskJson(path), original, 'legacy monolith remains untouched');
  const restarted = await loadVitals(path);
  assert.equal(restarted.day, 7);
  assert.deepEqual(restarted.cognition, original.cognition);
  const paths = sectionedStorePaths(path);
  assert.equal((await diskJson(paths.currentManifest)).storageFormatVersion, 2);
  assert.equal((await diskJson(paths.previousManifest)).storageFormatVersion, 2);
  assert.equal((await diskJson(join(dir, 'vitals.initialized.json'))).persistenceFormatVersion, 1);
  assert.equal(vitalsPersistenceStatus(restarted).storageFormatVersion, 2);
});

// A2. The first routine save after a legacy startup migrates immediately.
await withTemp('cy-vitals-a2-', async (dir, path) => {
  const original = validState({ day: 8 });
  await seed(path, original);
  const vitals = await loadVitals(path);
  await scheduleVitalsSave(path, vitals);
  const paths = sectionedStorePaths(path);
  assert.equal((await diskJson(paths.currentManifest)).storageFormatVersion, 2);
  assert.equal((await diskJson(paths.previousManifest)).storageFormatVersion, 2);
  assert.deepEqual(await diskJson(path), original, 'legacy monolith remains untouched');
});

// B. Failure before the first manifest replacement leaves the legacy authority intact.
await withTemp('cy-vitals-b-', async (dir, path) => {
  const original = validState({ day: 9 });
  await seed(path, original);
  const currentManifest = sectionedStorePaths(path).currentManifest;
  const vitals = await loadVitals(path, { persistence: {
    maxAttempts: 1,
    retryDelaysMs: [],
    hooks: {
      beforeWrite: ({ targetPath, text }) => targetPath === currentManifest
        ? { text: text.slice(0, 41) }
        : undefined,
      afterWrite: ({ targetPath }) => {
        if (targetPath === currentManifest) throw new Error('injected manifest write failure');
      },
    },
  } });
  vitals.day = 10;
  await assert.rejects(() => saveVitals(path, vitals), /injected manifest write failure/);
  assert.deepEqual(await diskJson(path), original);
  assert.equal((await loadVitals(path)).day, 9);
  await assertNoTempFiles(dir);
});

// C. Invalid legacy authority is preserved and recovered from legacy previous state.
await withTemp('cy-vitals-c-', async (dir, path) => {
  const previous = validState({ day: 13, cognition: { memory: { episodes: [{ id: 'kept' }] } } });
  await writeFile(path, '{"physical":');
  await seed(join(dir, 'vitals.previous.json'), previous);
  const vitals = await loadVitals(path);
  assert.equal(vitals.day, 13);
  assert.deepEqual(vitals.cognition.memory.episodes, [{ id: 'kept' }]);
  assert.equal(vitalsPersistenceStatus(vitals).startupRecoveryUsed, true);
  assert.equal(await readFile(join(dir, 'vitals.corrupt.json'), 'utf8'), '{"physical":');
});

// D. Two invalid legacy copies still fail closed.
await withTemp('cy-vitals-d-', async (dir, path) => {
  await writeFile(path, '{bad authority');
  await writeFile(join(dir, 'vitals.previous.json'), '{bad previous');
  await assert.rejects(() => loadVitals(path), (error) => error && error.code === 'CY_STATE_RECOVERY_REQUIRED');
  assert.equal(await readFile(path, 'utf8'), '{bad authority');
});

// E. A fresh installation creates coherent current and previous V2 generations.
await withTemp('cy-vitals-e-', async (_dir, path) => {
  const vitals = await loadVitals(path);
  assert.equal(vitalsPersistenceStatus(vitals).firstInstall, true);
  await saveVitals(path, vitals);
  const restarted = await loadVitals(path);
  assert.equal(restarted.day, 1);
  assert.equal(vitalsPersistenceStatus(restarted).firstInstall, false);
  const paths = sectionedStorePaths(path);
  assert.deepEqual(await diskJson(paths.currentManifest), await diskJson(paths.previousManifest));
});

// F. Existing continuity evidence without any valid state is never treated as a fresh install.
await withTemp('cy-vitals-f-', async (dir, path) => {
  await writeFile(join(dir, 'context.jsonl'), '{"s":"existing continuity"}\n');
  await assert.rejects(() => loadVitals(path), (error) => error && error.code === 'CY_STATE_RECOVERY_REQUIRED');
});

// G. Overlapping urgent saves coalesce and leave the newest coherent generation.
await withTemp('cy-vitals-g-', async (_dir, path) => {
  const vitals = await loadVitals(path);
  await saveVitals(path, vitals);
  vitals.day = 21;
  const one = saveVitals(path, vitals);
  vitals.day = 22;
  const two = saveVitals(path, vitals);
  vitals.day = 23;
  const three = saveVitals(path, vitals);
  await Promise.all([one, two, three]);
  assert.equal((await loadVitals(path)).day, 23);
  assert.ok(vitalsPersistenceStatus(vitals).coalescedSaveCount >= 1);
});

// H. A state above 13 MiB round-trips without placing the whole state in a manifest.
await withTemp('cy-vitals-h-', async (_dir, path) => {
  const vitals = await loadVitals(path);
  const payload = 'x'.repeat(13 * 1024 * 1024 + 257);
  vitals.cognition = { memory: { largePayload: payload } };
  await saveVitals(path, vitals);
  const manifestBytes = Buffer.byteLength(await readFile(sectionedStorePaths(path).currentManifest, 'utf8'));
  assert.ok(manifestBytes < 100 * 1024);
  assert.equal((await loadVitals(path)).cognition.memory.largePayload.length, payload.length);
});

// I. Every durable state category survives a logical round trip.
await withTemp('cy-vitals-i-', async (_dir, path) => {
  const vitals = await loadVitals(path);
  vitals.day = 31;
  vitals.physical.pain = 0.123456789;
  vitals.mental.anxiety = 0.987654321;
  vitals.cognition = {
    memory: { episodes: [{ id: 'memory-1', text: 'eight by four', privateSenderKey: 'sender-7' }] },
    threatLearning: { pairs: { search: { alpha: 3, beta: 2 } }, history: [{ id: 'threat-1' }] },
    learnedControllability: { pairs: { search: { controllable: 0.4 } }, history: [{ id: 'control-1' }] },
    feeding: { records: [{ eventId: 'meal-1', intake: 'full' }] },
    sleepHomeostasis: { processS: 0.4421, observations: [{ asleep: true, at: 1234 }] },
    somaticNociceptive: { injuries: [{ id: 'injury-1', active: true }] },
    socialContact: { episodes: [{ id: 'social-1', kind: 'contact' }] },
    attention: { target: 'door', salience: 0.7 },
  };
  vitals.dreamPool = [{ id: 'dream-1', fragments: ['door', 'number'] }];
  vitals.worldSimulation = { version: 4, opportunities: [{ id: 'association-1', status: 'OPEN' }] };
  vitals.locationRegime = { location: 'cell', regime: 'night' };
  vitals.instrumentalAgency = { open: [{ id: 'choice-1', actions: ['engage', 'withdraw'] }] };
  vitals.recentOpeners = ['one', 'two'];
  const expected = JSON.parse(JSON.stringify({
    day: vitals.day,
    physical: vitals.physical,
    mental: vitals.mental,
    cognition: vitals.cognition,
    dreamPool: vitals.dreamPool,
    worldSimulation: vitals.worldSimulation,
    locationRegime: vitals.locationRegime,
    instrumentalAgency: vitals.instrumentalAgency,
    recentOpeners: vitals.recentOpeners,
  }));
  await saveVitals(path, vitals);
  const restarted = await loadVitals(path);
  assert.deepEqual(JSON.parse(JSON.stringify({
    day: restarted.day,
    physical: restarted.physical,
    mental: restarted.mental,
    cognition: restarted.cognition,
    dreamPool: restarted.dreamPool,
    worldSimulation: restarted.worldSimulation,
    locationRegime: restarted.locationRegime,
    instrumentalAgency: restarted.instrumentalAgency,
    recentOpeners: restarted.recentOpeners,
  })), expected);
});

// J. Unchanged state produces no section or manifest rewrites.
await withTemp('cy-vitals-j-', async (_dir, path) => {
  let writes = 0;
  const vitals = await loadVitals(path, { persistence: {
    hooks: { beforeWrite: () => { writes++; } },
  } });
  await saveVitals(path, vitals);
  const afterFirst = writes;
  await saveVitals(path, vitals);
  await saveVitals(path, vitals);
  assert.equal(writes, afterFirst);
  assert.equal(vitalsPersistenceStatus(vitals).skippedUnchangedSaveCount, 2);
});

// K. Changing one tiny inline field rewrites only the layout index and manifests.
await withTemp('cy-vitals-k-', async (_dir, path) => {
  const vitals = await loadVitals(path);
  vitals.cognition = { memory: { episodes: largeEpisodes() } };
  await saveVitals(path, vitals);
  const before = vitalsPersistenceStatus(vitals).sectionWriteCount;
  vitals.day = 2;
  await saveVitals(path, vitals);
  const status = vitalsPersistenceStatus(vitals);
  assert.equal(status.sectionWriteCount, before + 1);
  assert.equal(status.lastChangedSectionCount, 1);
  assert.ok(status.lastChangedSectionBytes < 100 * 1024);
  assert.ok(status.lastManifestSizeBytes < 2 * 1024);
  assert.equal((await loadVitals(path)).cognition.memory.episodes.length, 320);
});

// L. Editing one item in a large array rewrites only its local bounded chunks.
await withTemp('cy-vitals-l-', async (_dir, path) => {
  const vitals = await loadVitals(path);
  vitals.cognition = { memory: { episodes: largeEpisodes() } };
  await saveVitals(path, vitals);
  vitals.cognition.memory.episodes[17].text = 'changed';
  await saveVitals(path, vitals);
  const status = vitalsPersistenceStatus(vitals);
  assert.ok(status.lastChangedSectionCount <= 3);
  assert.ok(status.lastChangedSectionBytes < 96 * 1024);
  assert.equal((await loadVitals(path)).cognition.memory.episodes[17].text, 'changed');
});

// L2. Sliding a bounded history rewrites its edge chunks, not every stable item.
await withTemp('cy-vitals-l2-', async (_dir, path) => {
  const vitals = await loadVitals(path);
  vitals.cognition = { experienced: { history: largeEpisodes(2_000) } };
  await saveVitals(path, vitals);
  vitals.cognition.experienced.history.shift();
  vitals.cognition.experienced.history.push({
    id: 'memory-new',
    text: `new episode ${'z'.repeat(120)}`,
    activation: 1,
  });
  await saveVitals(path, vitals);
  const status = vitalsPersistenceStatus(vitals);
  assert.ok(status.lastChangedSectionCount <= 6, `changed ${status.lastChangedSectionCount} chunks`);
  assert.ok(status.lastChangedSectionBytes < 160 * 1024);
  const restarted = await loadVitals(path);
  assert.equal(restarted.cognition.experienced.history.length, 2_000);
  assert.equal(restarted.cognition.experienced.history.at(-1).id, 'memory-new');
});

// M. Continuous routine changes still coalesce at the hard checkpoint deadline.
await withTemp('cy-vitals-m-', async (_dir, path) => {
  // Keep a generous gap between the mutation timers and hard deadline so a
  // loaded CI host cannot let the deadline overtake the test's setup timers.
  const vitals = await loadVitals(path, { persistence: { quietFlushMs: 1_000, maxCheckpointMs: 500 } });
  await saveVitals(path, vitals);
  const before = vitalsPersistenceStatus(vitals).stateWriteCount;
  vitals.day = 7;
  const saves = [scheduleVitalsSave(path, vitals)];
  await delay(20);
  vitals.day = 8;
  saves.push(scheduleVitalsSave(path, vitals));
  await delay(20);
  vitals.day = 9;
  saves.push(scheduleVitalsSave(path, vitals));
  await Promise.all(saves);
  assert.equal(vitalsPersistenceStatus(vitals).stateWriteCount, before + 1);
  assert.equal((await loadVitals(path)).day, 9);
});

// N. An urgent save absorbs pending routine state and commits it immediately.
await withTemp('cy-vitals-n-', async (_dir, path) => {
  const vitals = await loadVitals(path, { persistence: { quietFlushMs: 5_000, maxCheckpointMs: 10_000 } });
  await saveVitals(path, vitals);
  vitals.day = 10;
  const deferred = scheduleVitalsSave(path, vitals);
  vitals.day = 11;
  const urgent = saveVitals(path, vitals);
  await Promise.all([deferred, urgent]);
  assert.equal((await loadVitals(path)).day, 11);
  assert.equal(vitalsPersistenceStatus(vitals).nextCheckpointDue, null);
});

// O. A crash before write-behind fires returns the latest guaranteed checkpoint.
await withTemp('cy-vitals-o-', async (_dir, path) => {
  const vitals = await loadVitals(path, { persistence: { quietFlushMs: 5_000, maxCheckpointMs: 10_000 } });
  vitals.day = 12;
  await saveVitals(path, vitals);
  vitals.day = 13;
  const deferred = scheduleVitalsSave(path, vitals);
  assert.equal((await loadVitals(path)).day, 12);
  await saveVitals(path, vitals);
  await deferred;
  assert.equal((await loadVitals(path)).day, 13);
});

// P. Corrupt current manifest recovers one coherent previous generation.
await withTemp('cy-vitals-p-', async (_dir, path) => {
  const vitals = await loadVitals(path);
  vitals.day = 14;
  await saveVitals(path, vitals);
  vitals.day = 15;
  await saveVitals(path, vitals);
  await writeFile(sectionedStorePaths(path).currentManifest, '{broken');
  const recovered = await loadVitals(path);
  assert.equal(recovered.day, 14);
  assert.equal(vitalsPersistenceStatus(recovered).startupRecoveryUsed, true);
});

// Q. Fault before any changed section leaves the prior generation authoritative.
await withTemp('cy-vitals-q-', async (_dir, path) => {
  const first = await loadVitals(path);
  first.day = 16;
  await saveVitals(path, first);
  const vitals = await loadVitals(path, { persistence: {
    maxAttempts: 1,
    hooks: { beforeSectionWrite: () => { throw new Error('before first section'); } },
  } });
  vitals.cognition = { memory: { largePayload: 'a'.repeat(10_000) } };
  await assert.rejects(() => saveVitals(path, vitals), /before first section/);
  assert.equal((await loadVitals(path)).day, 16);
});

// R. Fault midway through changed sections cannot create a mixed generation.
await withTemp('cy-vitals-r-', async (_dir, path) => {
  const first = await loadVitals(path);
  first.day = 17;
  await saveVitals(path, first);
  const vitals = await loadVitals(path, { persistence: {
    maxAttempts: 1,
    hooks: { beforeSectionWrite: ({ index }) => { if (index === 1) throw new Error('mid sections'); } },
  } });
  vitals.cognition = {
    memory: { largePayload: 'a'.repeat(10_000) },
    threatLearning: { largePayload: 'b'.repeat(10_000) },
  };
  await assert.rejects(() => saveVitals(path, vitals), /mid sections/);
  assert.equal((await loadVitals(path)).day, 17);
});

// S. Fault after sections but before manifest commit leaves the prior generation authoritative.
await withTemp('cy-vitals-s-', async (_dir, path) => {
  const first = await loadVitals(path);
  first.day = 18;
  await saveVitals(path, first);
  const vitals = await loadVitals(path, { persistence: {
    maxAttempts: 1,
    hooks: { beforeManifestCommit: () => { throw new Error('before manifest'); } },
  } });
  vitals.day = 19;
  vitals.cognition = { memory: { largePayload: 'c'.repeat(10_000) } };
  await assert.rejects(() => saveVitals(path, vitals), /before manifest/);
  assert.equal((await loadVitals(path)).day, 18);
});

// T. Fault after manifest commit still recovers the new coherent generation.
await withTemp('cy-vitals-t-', async (_dir, path) => {
  const first = await loadVitals(path);
  first.day = 20;
  await saveVitals(path, first);
  const vitals = await loadVitals(path, { persistence: {
    maxAttempts: 1,
    hooks: { afterManifestCommit: () => { throw new Error('after manifest'); } },
  } });
  vitals.day = 21;
  await assert.rejects(() => saveVitals(path, vitals), /after manifest/);
  assert.equal((await loadVitals(path)).day, 21);
});

// U. Fault during cleanup cannot invalidate the newly committed generation.
await withTemp('cy-vitals-u-', async (_dir, path) => {
  const first = await loadVitals(path);
  first.cognition = { memory: { largePayload: 'first'.repeat(3_000) } };
  await saveVitals(path, first);
  first.cognition.memory.largePayload = 'second'.repeat(3_000);
  await saveVitals(path, first);
  const vitals = await loadVitals(path, { persistence: {
    maxAttempts: 1,
    hooks: { beforeCleanupDelete: () => { throw new Error('cleanup interrupted'); } },
  } });
  vitals.day = 22;
  vitals.cognition.memory.largePayload = 'third'.repeat(3_000);
  await assert.rejects(() => saveVitals(path, vitals), /cleanup interrupted/);
  const restarted = await loadVitals(path);
  assert.equal(restarted.day, 22);
  assert.equal(restarted.cognition.memory.largePayload, 'third'.repeat(3_000));
});

// V. Repeated successful operation retains only current and previous section data.
await withTemp('cy-vitals-v-', async (dir, path) => {
  const vitals = await loadVitals(path);
  vitals.cognition = { memory: { largePayload: 'seed'.repeat(3_000) } };
  await saveVitals(path, vitals);
  for (let i = 0; i < 20; i++) {
    vitals.day = 30 + i;
    vitals.cognition.memory.largePayload = `${i}`.repeat(12_000);
    await saveVitals(path, vitals);
  }
  const names = await readdir(sectionedStorePaths(path).sections);
  assert.ok(names.length <= 4, `expected bounded section files, found ${names.length}`);
  assert.equal((await loadVitals(path)).day, 49);
  await assertNoTempFiles(dir);
});

// W. A stale process cannot overwrite a newer externally committed checkpoint.
await withTemp('cy-vitals-w-', async (_dir, path) => {
  const runner = await loadVitals(path, { persistence: { maxAttempts: 1 } });
  runner.day = 50;
  await saveVitals(path, runner);

  const reconciler = await loadVitals(path, { persistence: { maxAttempts: 1 } });
  reconciler.worldSimulation = {
    objects: [{
      id: 'message-retired', type: 'message', status: 'RETIRED',
      message: { lifecycleState: 'RETIRED' },
    }],
    threads: [{ id: 'thread-resolved', state: 'RESOLVED' }],
  };
  await saveVitals(path, reconciler);

  runner.day = 51;
  runner.worldSimulation = {
    objects: [{ id: 'message-retired', type: 'message', status: 'DELIVERED' }],
    threads: [{ id: 'thread-resolved', state: 'OPEN' }],
  };
  await assert.rejects(
    () => saveVitals(path, runner),
    (error) => error && error.code === 'CY_STATE_CHECKPOINT_CONFLICT',
  );

  const restarted = await loadVitals(path);
  assert.equal(restarted.day, 50);
  assert.equal(restarted.worldSimulation.objects[0].status, 'RETIRED');
  assert.equal(restarted.worldSimulation.threads[0].state, 'RESOLVED');
});

console.log('vitals-persistence.test.js: all checks passed');
