import assert from 'node:assert/strict';

import {
  DREAM_CONTEXT_CHAR_LIMIT,
  DREAM_MAX_CHARS_PER_FRAGMENT,
  DREAM_MAX_FRAGMENTS,
  DREAM_MAX_WORDS_PER_FRAGMENT,
  DREAM_MEMORY_TRACE_LIMIT,
  DREAM_RETRY_LIMIT,
  DREAM_TOKEN_LIMIT,
  buildDreamContextPacket,
  dreamGenerationDirective,
  dreamMemoryQuery,
  parseDreamFragments,
  selectDreamMemoryTraces,
  validateDreamOutput,
} from './dream.js';
import { sourceFromDreamExpression } from './autobiographical-memory.js';
import { dreamLayout, DREAM_LAYOUT_INVENTORY } from '../public/assets/dream-view.js';

let n = 0;
const ok = (message) => { n++; console.log('  ok - ' + message); };

const raw = JSON.stringify({
  fragments: [
    'door will not fit the frame',
    'Proctor with no face',
    'someone laughing underwater while the keys keep turning beyond the wall forever tonight',
    'wrong name on the tray',
    'the landing folds inward',
    'this sixth fragment must be discarded',
  ],
});
const fragments = parseDreamFragments(raw);
assert.equal(fragments.length, DREAM_MAX_FRAGMENTS);
assert.deepEqual(fragments.slice(0, 2), ['door will not fit the frame', 'Proctor with no face']);
assert.ok(fragments.every((fragment) => fragment.split(/\s+/).length <= DREAM_MAX_WORDS_PER_FRAGMENT));
assert.ok(fragments.every((fragment) => fragment.length <= DREAM_MAX_CHARS_PER_FRAGMENT));
assert.equal(DREAM_TOKEN_LIMIT, 96);
assert.equal(DREAM_RETRY_LIMIT, 0);
ok('fragment boundaries survive JSON parsing and compact output limits are enforced');

const guarded = validateDreamOutput('Here is a dream for Cy: {"fragments":["door"]}');
assert.equal(guarded.valid, false);
assert.match(guarded.result, /REJECTED/);
assert.equal(validateDreamOutput('[MODEL ESTIMATE] {"fragments":["door"]}').valid, false);
assert.equal(validateDreamOutput(raw).valid, true);
ok('assistant and model-scaffold frames are rejected before display');

const memories = [
  { id: 'public-episode', status: 'ACTIVE', privacyScope: 'PUBLIC_RECALLABLE', type: 'EPISODIC', publicSummary: 'the cell search', tags: ['cell'] },
  { id: 'private-sender', status: 'ACTIVE', privacyScope: 'SENDER_RECALLABLE', type: 'MOTIF', content: 'private postcard phrase' },
  { id: 'internal', status: 'ACTIVE', privacyScope: 'INTERNAL_ONLY', type: 'MOTIF', content: 'internal thought' },
  { id: 'public-semantic', status: 'ACTIVE', privacyScope: 'PUBLIC_RECALLABLE', type: 'SEMANTIC', publicSummary: 'general fact' },
  { id: 'public-motif', status: 'ACTIVE', privacyScope: 'PUBLIC_RECALLABLE', type: 'MOTIF', publicSummary: 'a repeated tile pattern' },
  { id: 'archived', status: 'ARCHIVED', privacyScope: 'PUBLIC_RECALLABLE', type: 'PERSON', publicSummary: 'Bill' },
  { id: 'public-person', status: 'ACTIVE', privacyScope: 'PUBLIC_RECALLABLE', type: 'PERSON', publicSummary: 'Daemon at the door' },
  { id: 'fourth-public', status: 'ACTIVE', privacyScope: 'PUBLIC_RECALLABLE', type: 'UNRESOLVED_THREAD', publicSummary: 'the missing tray' },
];
const selected = selectDreamMemoryTraces(memories);
assert.equal(selected.length, DREAM_MEMORY_TRACE_LIMIT);
assert.deepEqual(selected.map((memory) => memory.id), ['public-episode', 'public-motif', 'public-person']);
assert.ok(selected.every((memory) => memory.id !== 'private-sender' && memory.id !== 'internal'));
ok('dream retrieval admits at most three public eligible traces and excludes sender-private material');

const packet = buildDreamContextPacket({
  sleepState: { state: 'ASLEEP', periodId: 'sleep-2026-09-12', localTime: '03:17' },
  recentWorld: [
    { summary: 'private postcard words', location: 'cell', sourceClass: 'VISITOR_PRIVATE' },
    { summary: 'explicitly excluded', location: 'cell', dreamEligible: false },
    ...Array.from({ length: 12 }, (_, i) => ({ summary: `recent prison event ${i} ${'x'.repeat(100)}`, location: 'cell' })),
  ],
  material: Array.from({ length: 8 }, (_, i) => ({ kind: 'incident', text: `material ${i} ${'y'.repeat(100)}` })),
  memoryTraces: memories,
});
assert.ok(JSON.stringify(packet).length <= DREAM_CONTEXT_CHAR_LIMIT);
assert.ok(packet.recent_world_residue.length <= 4);
assert.ok(!JSON.stringify(packet).includes('private postcard words'));
assert.ok(!JSON.stringify(packet).includes('explicitly excluded'));
assert.ok(packet.immediate_material.length <= 3);
assert.ok(packet.autobiographical_traces.length <= 3);
assert.deepEqual(packet.autobiographical_traces.map((memory) => memory.ref), ['D1', 'D2', 'D3']);
assert.ok(packet.autobiographical_traces.every((memory) => !Object.hasOwn(memory, 'id')));
assert.ok(!JSON.stringify(packet).includes('public-episode'));
assert.equal(packet.boundaries.not_world_truth, true);
assert.equal(packet.boundaries.sender_private_memories_allowed, false);
assert.equal(dreamMemoryQuery(packet).text.includes('recent prison event'), true);
ok('the dream context packet is bounded and records the world/privacy boundary');

const noMotifPacket = buildDreamContextPacket({
  recentWorld: [{ summary: 'the tea came cold', location: 'cell' }],
  memoryTraces: [memories[0]],
});
const directive = dreamGenerationDirective(noMotifPacket);
assert.doesNotMatch(directive, /8\s*(?:x|by|x)\s*4/i);
assert.match(directive, /fragments/);
assert.doesNotMatch(directive, /full recent journal|journal context/i);
ok('the recurring motif is not hard-coded and dream prompting remains separate');

const retrievedMotifPacket = buildDreamContextPacket({
  recentWorld: [{ summary: 'the landing went quiet', location: 'wing' }],
  memoryTraces: [{
    id: 'retrieved-motif', status: 'ACTIVE', privacyScope: 'PUBLIC_RECALLABLE',
    type: 'MOTIF', publicSummary: '8 by 4 keeps returning',
  }],
});
assert.match(dreamGenerationDirective(retrievedMotifPacket), /8 by 4/);
assert.match(dreamGenerationDirective(buildDreamContextPacket({ memoryTraces: [memories[0]] })), /the cell search/);
ok('relevant retrieved memories can enter dream material, including the motif only when retrieved');

const source = sourceFromDreamExpression(['door will not fit', 'Bill underwater'], 'dream:event-1', '2026-09-12T03:17:00Z');
assert.equal(source.sourceType, 'DREAM_EXPRESSION');
assert.equal(source.sourceVisibility, 'INTERNAL_ONLY');
assert.deepEqual(source.tags, ['dream', 'subjective-expression']);
assert.equal(source.world_event, undefined);
ok('dream formation provenance is subjective DREAM_EXPRESSION, never WORLD_EVENT');

assert.deepEqual(dreamLayout('stable-event', 2), dreamLayout('stable-event', 2));
assert.deepEqual(DREAM_LAYOUT_INVENTORY.offsetsPct, [4, 18, 9, 27, 13]);
assert.equal(DREAM_LAYOUT_INVENTORY.animationMs, 4800);
ok('dream layout is deterministic across historical re-renders');

console.log(`\ndream-fragments.test.js: all ${n} checks passed`);
