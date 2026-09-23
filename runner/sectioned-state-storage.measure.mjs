// Read-only benchmark for sectioned Cy state persistence.
//
// Usage:
//   node runner/sectioned-state-storage.measure.mjs path/to/vitals.json
//
// The source file is copied into temporary directories. No source or runtime
// state is changed, and the report contains sizes/timing only, never contents.

import { readFile, rm, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { createSomaRuntime } from './soma-runtime.js';
import { sectionedStorePaths } from './sectioned-state-store.js';
import {
  ampOf,
  computeDerived,
  loadVitals,
  saveVitals,
  tick,
  vitalsPersistenceStatus,
} from './vitals.js';

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error('expected a monolithic vitals.json path');

const checkpointIntervalMs = 10 * 60_000;
const tickMs = 5_000;
const intervals = 6;
const sourceBytes = await readFile(sourcePath);

const sum = (values) => values.reduce((total, value) => total + value, 0);
const mean = (values) => values.length ? sum(values) / values.length : 0;
const mib = (bytes) => bytes / (1024 * 1024);

function descriptorRefs(descriptor, refs = new Map()) {
  if (!descriptor || typeof descriptor !== 'object') return refs;
  if (descriptor.kind === 'blob') refs.set(descriptor.ref.hash, descriptor.ref.bytes);
  if (descriptor.kind === 'fields') {
    for (const child of Object.values(descriptor.fields || {})) descriptorRefs(child, refs);
  }
  if (descriptor.kind === 'array') {
    for (const ref of descriptor.chunks || []) refs.set(ref.hash, ref.bytes);
  }
  if (descriptor.kind === 'object') {
    refs.set(descriptor.order.hash, descriptor.order.bytes);
    for (const ref of descriptor.buckets || []) if (ref) refs.set(ref.hash, ref.bytes);
  }
  return refs;
}

async function committedShape(path) {
  const paths = sectionedStorePaths(path);
  const manifestText = await readFile(paths.currentManifest, 'utf8');
  const manifest = JSON.parse(manifestText);
  const layoutText = await readFile(join(paths.sections, `${manifest.layoutRef.hash}.json`), 'utf8');
  return {
    manifestBytes: Buffer.byteLength(manifestText, 'utf8'),
    layoutBytes: Buffer.byteLength(layoutText, 'utf8'),
    layout: JSON.parse(layoutText),
  };
}

function namedDescriptors(layout) {
  const named = new Map();
  const root = layout.state && layout.state.fields || {};
  for (const [key, descriptor] of Object.entries(root)) {
    if (key === 'cognition' && descriptor && descriptor.kind === 'fields') {
      for (const [module, moduleDescriptor] of Object.entries(descriptor.fields || {})) {
        named.set(`cognition.${module}`, moduleDescriptor);
      }
    } else {
      named.set(`state.${key}`, descriptor);
    }
  }
  named.set('bookkeeping', layout.bookkeeping);
  return named;
}

function changedDescriptors(beforeLayout, afterLayout) {
  const before = namedDescriptors(beforeLayout);
  const after = namedDescriptors(afterLayout);
  const changes = [];
  for (const [name, descriptor] of after) {
    const prior = before.get(name);
    if (JSON.stringify(prior) === JSON.stringify(descriptor)) continue;
    const priorRefs = descriptorRefs(prior);
    const nextRefs = descriptorRefs(descriptor);
    let newBlobBytes = 0;
    let newBlobCount = 0;
    for (const [hash, bytes] of nextRefs) {
      if (!priorRefs.has(hash)) {
        newBlobBytes += bytes;
        newBlobCount++;
      }
    }
    changes.push({ name, newBlobBytes, newBlobCount });
  }
  return changes;
}

async function runScenario(name, { active }) {
  const dir = await mkdtemp(join(tmpdir(), `cy-v2-${name}-`));
  const path = join(dir, 'vitals.json');
  const physicalWrites = [];
  try {
    await writeFile(path, sourceBytes);
    const raw = JSON.parse(sourceBytes.toString('utf8'));
    let now = Math.max(
      Number(raw.cognition && raw.cognition.lastTickMs) || 0,
      Date.parse('2026-09-13T12:00:00.000Z'),
    );
    const vitals = await loadVitals(path, {
      persistence: {
        hooks: {
          beforeWrite: ({ targetPath, text }) => {
            physicalWrites.push({ file: basename(targetPath), bytes: Buffer.byteLength(text, 'utf8') });
          },
        },
      },
    });
    const soma = createSomaRuntime(vitals.cognition, {
      now,
      onState: (state) => { vitals.cognition = state; },
      logger: { error() {} },
    });
    if (!soma.available) throw new Error(`fixture Soma state did not reconcile: ${soma.failure && soma.failure.reason}`);

    await saveVitals(path, vitals);
    const migrationStatus = vitalsPersistenceStatus(vitals);
    const measurementWriteStart = physicalWrites.length;
    const statusStart = { ...migrationStatus };
    const saveDurationsMs = [];
    const saveCpuMs = [];
    const changedSections = [];
    const changedSectionBytes = [];
    const mutationSummary = new Map();
    const manifestSizes = [];
    const layoutSizes = [];
    let priorShape = await committedShape(path);

    const advanceTicks = (count) => {
      for (let index = 0; index < count; index++) {
        now += tickMs;
        tick(vitals, { asleep: false, now });
        soma.tick({
          physical: vitals.physical,
          monotony: vitals.monotony,
          asleep: false,
          sleepHomeostasisAsleep: false,
          lastMailMs: vitals.lastMailMs,
          now,
        });
        const experienced = soma.state && soma.state.experienced && soma.state.experienced.metrics;
        if (experienced) {
          vitals.physical.hunger = experienced.hunger.value / 100;
          vitals.mental.stress = experienced.arousal.value / 100;
          vitals.mental.agitation = experienced.arousal.value / 100;
          vitals.mental.anger = experienced.anger.value / 100;
          vitals.mental.longing = 0;
          vitals.derived = computeDerived(vitals);
        }
      }
    };

    const checkpoint = async () => {
      const before = vitalsPersistenceStatus(vitals);
      const cpuBefore = process.cpuUsage();
      const started = performance.now();
      await saveVitals(path, vitals);
      saveDurationsMs.push(performance.now() - started);
      const cpu = process.cpuUsage(cpuBefore);
      saveCpuMs.push((cpu.user + cpu.system) / 1000);
      const after = vitalsPersistenceStatus(vitals);
      changedSections.push(after.sectionWriteCount - before.sectionWriteCount);
      changedSectionBytes.push(after.bytesWritten - before.bytesWritten);
      const nextShape = await committedShape(path);
      manifestSizes.push(nextShape.manifestBytes);
      layoutSizes.push(nextShape.layoutBytes);
      for (const change of changedDescriptors(priorShape.layout, nextShape.layout)) {
        const summary = mutationSummary.get(change.name) || { checkpointsChanged: 0, newBlobBytes: 0 };
        summary.checkpointsChanged++;
        summary.newBlobBytes += change.newBlobBytes;
        mutationSummary.set(change.name, summary);
      }
      priorShape = nextShape;
    };

    for (let interval = 0; interval < intervals; interval++) {
      if (active) {
        advanceTicks(checkpointIntervalMs / tickMs / 2);
        soma.observe({
          name: `benchmark_incident_${interval}`,
          text: `officer checked the door during interval ${interval}`,
          tags: ['officer', 'control'],
          entities: ['officer'],
        }, { now });
        soma.observeOutput(`still watchin that door interval ${interval}`, { mode: 'journal', now });
        await checkpoint();
        advanceTicks(checkpointIntervalMs / tickMs / 2);
      } else {
        advanceTicks(checkpointIntervalMs / tickMs);
      }
      await checkpoint();
    }

    const status = vitalsPersistenceStatus(vitals);
    const writes = physicalWrites.slice(measurementWriteStart);
    const bytesPerHour = status.bytesWritten - statusStart.bytesWritten;
    const saveCount = status.stateWriteCount - statusStart.stateWriteCount;
    return {
      scenario: name,
      sourceFixtureBytes: sourceBytes.length,
      reconciledLogicalStateBytes: status.stateSizeBytes,
      migrationBytesWritten: statusStart.bytesWritten,
      migrationRetainedBytes: statusStart.retainedGenerationBytes,
      savesPerHour: saveCount,
      physicalWritesPerHour: writes.length,
      bytesPerHour,
      projectedMiBPerDay: Number(mib(bytesPerHour * 24).toFixed(3)),
      averageChangedSectionsPerSave: Number(mean(changedSections).toFixed(2)),
      averageBytesPerSave: Math.round(bytesPerHour / Math.max(1, saveCount)),
      largestOrdinaryWriteBytes: Math.max(0, ...writes.map((write) => write.bytes)),
      averageCheckpointWallMs: Number(mean(saveDurationsMs).toFixed(3)),
      averageCheckpointCpuMs: Number(mean(saveCpuMs).toFixed(3)),
      averageManifestBytes: Math.round(mean(manifestSizes)),
      averageLayoutIndexBytes: Math.round(mean(layoutSizes)),
      finalRetainedRollbackBytes: status.retainedGenerationBytes,
      mutations: Object.fromEntries(
        [...mutationSummary.entries()]
          .sort((a, b) => b[1].newBlobBytes - a[1].newBlobBytes || a[0].localeCompare(b[0])),
      ),
      compatibility: {
        somaAvailable: soma.available,
        amplificationRatioVsFullCurrentAndPrevious: Number(
          (bytesPerHour / Math.max(1, saveCount * status.stateSizeBytes * 2)).toFixed(5),
        ),
        lastAmp: Number(ampOf(vitals).toFixed(3)),
      },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const report = {
  fixture: basename(sourcePath),
  intervalMinutes: checkpointIntervalMs / 60_000,
  idle: await runScenario('idle', { active: false }),
  active: await runScenario('active-six-events-per-hour', { active: true }),
};

console.log(JSON.stringify(report, null, 2));
