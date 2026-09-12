import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTEXT_CONSUMERS,
  buildContextPacket,
  createContextItem,
  renderContextPacket,
} from './context-broker.js';

function item(id, overrides = {}) {
  return createContextItem({
    id,
    sourceId: overrides.sourceId || id,
    section: 'recent_events',
    provenanceClass: 'OBSERVED BY CY',
    knowledgeScope: 'CY_OBSERVED',
    privacyScope: 'INTERNAL_ONLY',
    content: `content ${id}`,
    ...overrides,
  });
}

test('A: CY cannot receive world-only hidden facts', () => {
  const packet = buildContextPacket({
    consumer: CONTEXT_CONSUMERS.CY_PROSE,
    items: [item('hidden', { provenanceClass: 'WORLD FACT', knowledgeScope: 'WORLD_KNOWS', privacyScope: 'WORLD_SIMULATION' })],
  });
  assert.equal(packet.metrics.selectedCount, 0);
  assert.equal(packet.omitted[0].reason, 'PRIVACY_SCOPE');
});

test('B: AWG cannot receive sender-private memories', () => {
  const packet = buildContextPacket({
    consumer: CONTEXT_CONSUMERS.AWG,
    currentSenderId: 'visitor-a',
    items: [item('private', {
      provenanceClass: 'SUBJECTIVE MEMORY', knowledgeScope: 'CY_BELIEVES',
      privacyScope: 'SENDER_RECALLABLE', senderId: 'visitor-a',
    })],
  });
  assert.equal(packet.metrics.selectedCount, 0);
  assert.equal(packet.omitted[0].reason, 'PRIVACY_SCOPE');
});

test('C: same-sender context receives sender memory', () => {
  const packet = buildContextPacket({
    consumer: CONTEXT_CONSUMERS.CY_PROSE,
    currentSenderId: 'visitor-a',
    items: [item('same', { provenanceClass: 'SUBJECTIVE MEMORY', knowledgeScope: 'CY_BELIEVES', privacyScope: 'SENDER_RECALLABLE', senderId: 'visitor-a' })],
  });
  assert.equal(packet.metrics.selectedCount, 1);
});

test('D: cross-visitor privacy is enforced before assembly', () => {
  const packet = buildContextPacket({
    consumer: CONTEXT_CONSUMERS.MEMORY_SURFACING,
    currentSenderId: 'visitor-b',
    items: [item('other', { provenanceClass: 'SUBJECTIVE MEMORY', knowledgeScope: 'CY_BELIEVES', privacyScope: 'SENDER_RECALLABLE', senderId: 'visitor-a' })],
  });
  assert.equal(packet.metrics.selectedCount, 0);
  assert.equal(packet.omitted[0].reason, 'SENDER_SCOPE_MISMATCH');
});

test('E and F: duplicate source is represented once and reason is inspectable', () => {
  const packet = buildContextPacket({
    consumer: CONTEXT_CONSUMERS.CY_PROSE,
    items: [item('a', { sourceId: 'event-1', priority: 10 }), item('b', { sourceId: 'event-1', priority: 90 })],
  });
  assert.equal(packet.metrics.selectedCount, 1);
  assert.equal(packet.sections[0].items[0].id, 'b');
  assert.ok(packet.omitted.some((entry) => entry.reason === 'DUPLICATE_SOURCE'));
});

test('G: budget exhaustion never deletes mandatory current-world facts', () => {
  const packet = buildContextPacket({
    consumer: CONTEXT_CONSUMERS.CY_PROSE,
    budget: { totalChars: 8, sections: { mandatory_current_state: 4 } },
    items: [item('mandatory', { section: 'mandatory_current_state', mandatory: true, content: 'This fact exceeds both budgets.' })],
  });
  assert.equal(packet.metrics.selectedCount, 1);
});

test('H: UNKNOWN remains explicitly unknown in final rendering', () => {
  const packet = buildContextPacket({
    consumer: CONTEXT_CONSUMERS.CY_PROSE,
    items: [item('unknown', { provenanceClass: 'UNKNOWN', content: 'Whether the reported transfer will happen is not established.' })],
  });
  assert.match(renderContextPacket(packet), /\[UNKNOWN\]/);
});

test('I: SUBJECTIVE MEMORY cannot be relabelled by rendering', () => {
  const packet = buildContextPacket({
    consumer: CONTEXT_CONSUMERS.CY_PROSE,
    items: [item('memory', { provenanceClass: 'SUBJECTIVE MEMORY', knowledgeScope: 'CY_BELIEVES' })],
  });
  const rendering = renderContextPacket(packet);
  assert.match(rendering, /\[SUBJECTIVE MEMORY\]/);
  assert.doesNotMatch(rendering, /\[WORLD FACT\]/);
});

test('J: consumers receive only their allowed source classes', () => {
  const sources = [
    item('world', { provenanceClass: 'WORLD FACT', knowledgeScope: 'WORLD_KNOWS', privacyScope: 'WORLD_SIMULATION' }),
    item('seen', { provenanceClass: 'OBSERVED BY CY', knowledgeScope: 'CY_OBSERVED', privacyScope: 'INTERNAL_ONLY' }),
    item('belief', { provenanceClass: 'SUBJECTIVE BELIEF', knowledgeScope: 'CY_BELIEVES', privacyScope: 'INTERNAL_ONLY' }),
  ];
  const cy = buildContextPacket({ consumer: CONTEXT_CONSUMERS.CY_PROSE, items: sources });
  const awg = buildContextPacket({ consumer: CONTEXT_CONSUMERS.AWG, items: sources });
  assert.deepEqual(cy.sections.flatMap((section) => section.items.map((entry) => entry.id)), ['belief', 'seen']);
  assert.deepEqual(awg.sections.flatMap((section) => section.items.map((entry) => entry.id)), ['world']);
});

test('model-facing rendering excludes raw source and sender identifiers', () => {
  const packet = buildContextPacket({
    consumer: CONTEXT_CONSUMERS.CY_PROSE,
    currentSenderId: 'visitor-secret-123',
    items: [item('memory', {
      sourceId: 'event-secret-999', senderId: 'visitor-secret-123',
      provenanceClass: 'SUBJECTIVE MEMORY', knowledgeScope: 'CY_BELIEVES',
      privacyScope: 'SENDER_RECALLABLE',
    })],
  });
  const rendered = renderContextPacket(packet);
  assert.doesNotMatch(rendered, /visitor-secret|event-secret/);
});
