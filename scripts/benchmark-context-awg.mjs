import { performance } from 'node:perf_hooks';

import {
  CONTEXT_CONSUMERS,
  buildContextPacket,
  createContextItem,
  renderContextPacket,
} from '../runner/context-broker.js';
import {
  AWG_SCHEMA,
  validateAwgCandidate,
} from '../runner/ambient-world-generator.js';

const ITERATIONS = 2000;
const NOW = Date.parse('2026-09-12T12:00:00.000Z');

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function contextItems(consumer) {
  const world = consumer === CONTEXT_CONSUMERS.AWG;
  return Array.from({ length: 24 }, (_, index) => createContextItem({
    id: `${world ? 'world' : 'cy'}:${index}`,
    sourceId: `source:${index % 20}`,
    section: world ? (index % 3 === 0 ? 'unresolved_threads' : 'recent_events')
      : (index % 3 === 0 ? 'grounded_soma' : 'recent_events'),
    provenanceClass: world ? 'WORLD FACT' : 'OBSERVED BY CY',
    knowledgeScope: world ? 'WORLD_KNOWS' : 'CY_OBSERVED',
    privacyScope: world ? 'WORLD_SIMULATION' : 'INTERNAL_ONLY',
    content: `Representative bounded context item ${index}: ${'x'.repeat(120)}`,
    priority: 100 - index,
    mandatory: index === 0,
  }));
}

function benchContext(consumer) {
  const times = [];
  let packet;
  let rendering;
  const items = contextItems(consumer);
  for (let index = 0; index < ITERATIONS; index++) {
    const started = performance.now();
    packet = buildContextPacket({ consumer, items, generatedAt: '2026-09-12T12:00:00.000Z' });
    rendering = renderContextPacket(packet);
    times.push(performance.now() - started);
  }
  return {
    iterations: ITERATIONS,
    averageMs: times.reduce((sum, value) => sum + value, 0) / times.length,
    p95Ms: percentile(times, 0.95),
    finalPacketChars: rendering.length,
    selected: packet.metrics.selectedCount,
    omitted: packet.metrics.omittedCount,
    deduplicated: packet.metrics.deduplicationCount,
  };
}

const candidate = {
  schema: AWG_SCHEMA,
  version: 1,
  decision: 'EVENT',
  eventFamily: 'MESSAGE_PASSING',
  participants: ['reg', 'cy'],
  location: 'landing',
  occurredAt: new Date(NOW).toISOString(),
  objective: { eventType: 'note_passed', summary: 'Reg passed a folded note to Cy on the landing.' },
  objects: [{ id: 'object-note-bench', type: 'note', ownerId: 'reg', holderId: 'cy', location: 'landing', status: 'ACTIVE' }],
  observations: [{ observerId: 'cy', access: 'CY_DIRECT', summary: 'Reg put a folded note into Cy hand.' }],
  informationClaims: [],
  resolved: false,
  thread: { action: 'OPEN', id: 'thread-note-bench', type: 'NOTE_AWAITING_DELIVERY', summary: 'The note has not reached Daemon.', nextEligibleAt: null },
  continuationOf: null,
  publicTimeline: { eligible: true, text: '[Reg slips Cy a folded note on the landing]' },
};

const validationTimes = [];
for (let index = 0; index < ITERATIONS; index++) {
  const started = performance.now();
  validateAwgCandidate(candidate, null, { nowMs: NOW });
  validationTimes.push(performance.now() - started);
}

console.log(JSON.stringify({
  classification: 'ENGINEERING PERFORMANCE MEASUREMENT',
  context: {
    CY_PROSE: benchContext(CONTEXT_CONSUMERS.CY_PROSE),
    AWG: benchContext(CONTEXT_CONSUMERS.AWG),
  },
  validation: {
    iterations: ITERATIONS,
    averageMs: validationTimes.reduce((sum, value) => sum + value, 0) / validationTimes.length,
    p95Ms: percentile(validationTimes, 0.95),
  },
}, null, 2));
