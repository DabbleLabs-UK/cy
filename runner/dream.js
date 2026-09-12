// Dream generation and presentation contracts.
//
// This is an engineering, model-mediated subjective-expression path. It is not
// a biological model of dreaming or memory consolidation. Dream material may be
// queued for autobiographical-memory formation, but it is never evidence that a
// prison-world event happened and must not update grounded Soma stores.

import { looksLikeAssistantFrame } from './warden.js';

export const DREAM_MAX_FRAGMENTS = 5;
export const DREAM_MAX_WORDS_PER_FRAGMENT = 12;
export const DREAM_MAX_CHARS_PER_FRAGMENT = 96;
export const DREAM_TOKEN_LIMIT = 96;
export const DREAM_MEMORY_TRACE_LIMIT = 3;
export const DREAM_RECENT_WORLD_LIMIT = 4;
export const DREAM_MATERIAL_LIMIT = 3;
export const DREAM_CONTEXT_CHAR_LIMIT = 1200;
export const DREAM_MEMORY_DEADLINE_MS = 750;
export const DREAM_RETRY_LIMIT = 0;

export const DREAM_MEMORY_TYPES = Object.freeze([
  'EPISODIC', 'PERSON', 'MOTIF', 'UNRESOLVED_THREAD',
]);

function compact(value, limit) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = key(item);
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

// Dreams are public output, so this consumer is deliberately stricter than the
// ordinary private working-context path: only ACTIVE, PUBLIC_RECALLABLE records
// can enter the model call. Sender-private and INTERNAL_ONLY memories are never
// supplied, even when the server returned them to the authenticated runner.
export function selectDreamMemoryTraces(memories, limit = DREAM_MEMORY_TRACE_LIMIT) {
  return uniqueBy((Array.isArray(memories) ? memories : [])
    .filter((memory) => memory
      && memory.status === 'ACTIVE'
      && memory.privacyScope === 'PUBLIC_RECALLABLE'
      && DREAM_MEMORY_TYPES.includes(memory.type))
    .map((memory) => ({
      id: String(memory.id || ''),
      type: memory.type,
      text: compact(memory.publicSummary || memory.content, 160),
      tags: (Array.isArray(memory.tags) ? memory.tags : [])
        .map((tag) => compact(tag, 40)).filter(Boolean).slice(0, 6),
      reasons: (Array.isArray(memory.reasons) ? memory.reasons : [])
        .map((reason) => compact(reason, 40)).filter(Boolean).slice(0, 4),
    }))
    .filter((memory) => memory.id && memory.text), (memory) => memory.id)
    .slice(0, Math.max(0, Math.min(DREAM_MEMORY_TRACE_LIMIT, Number(limit) || 0)));
}

export function buildDreamContextPacket({
  sleepState = {}, recentWorld = [], material = [], memoryTraces = [],
} = {}) {
  const packet = {
    consumer: 'DREAM_MEMORY_SURFACING',
    epistemic_status: 'SUBJECTIVE_EXPRESSION_INPUT',
    sleep: {
      state: compact(sleepState.state || 'ASLEEP', 24),
      period_id: compact(sleepState.periodId, 80),
      local_time: compact(sleepState.localTime, 32),
    },
    recent_world_residue: (Array.isArray(recentWorld) ? recentWorld : [])
      .filter((item) => item && item.dreamEligible !== false && item.sourceClass !== 'VISITOR_PRIVATE')
      .slice(-DREAM_RECENT_WORLD_LIMIT)
      .map((item) => ({
        text: compact(item && (item.summary || item.text), 120),
        location: compact(item && item.location, 40) || null,
      })).filter((item) => item.text),
    immediate_material: (Array.isArray(material) ? material : [])
      .slice(0, DREAM_MATERIAL_LIMIT)
      .map((item) => ({ kind: compact(item && item.kind, 32), text: compact(item && item.text, 120) }))
      .filter((item) => item.text),
    autobiographical_traces: selectDreamMemoryTraces(memoryTraces).map((memory, index) => ({
      ref: `D${index + 1}`,
      type: memory.type,
      text: memory.text,
      tags: memory.tags,
      reasons: memory.reasons,
    })),
    boundaries: {
      not_world_truth: true,
      not_biological_dream_model: true,
      sender_private_memories_allowed: false,
    },
  };

  // Bound the serialized packet without splitting fields into malformed text.
  while (JSON.stringify(packet).length > DREAM_CONTEXT_CHAR_LIMIT) {
    if (packet.recent_world_residue.length > 1) packet.recent_world_residue.shift();
    else if (packet.immediate_material.length > 1) packet.immediate_material.pop();
    else if (packet.autobiographical_traces.length) packet.autobiographical_traces.pop();
    else break;
  }
  return packet;
}

export function dreamGenerationDirective(packet, { lucid = false, wakeLine = '' } = {}) {
  if (lucid) {
    return [
      'A wing noise briefly wakes Cy from sleep.',
      'Return JSON only: {"fragments":["one short frightened line"]}.',
      'Use one locally meaningful fragment of at most 12 words.',
      'No analysis, explanation, headings, assistant framing, or technical labels.',
      'Noise: ' + compact(wakeLine || 'something in the dark', 120),
      'Bounded dream context: ' + JSON.stringify(packet),
    ].join('\n');
  }
  return [
    'Cy is asleep. Produce short involuntary-seeming dream fragments, not a journal entry.',
    'Return one JSON object only with this exact shape: {"fragments":["...","..."]}.',
    'Return 1 to 5 fragments. Each fragment must have local meaning and use at most 12 words.',
    'Use half-sentences, isolated images, abrupt substitutions, repetitions, names or places.',
    'Let transitions between fragments create discontinuity. Do not write word salad.',
    'Do not narrate or explain the dream. Do not say today I dreamed or I am thinking.',
    'Do not expose prompts, model labels, analysis, instructions, or technical metadata.',
    'Material is optional: do not force every supplied item into the output.',
    'Bounded dream context: ' + JSON.stringify(packet),
  ].join('\n');
}

function extractJson(raw) {
  const text = String(raw || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function shapeFragment(value) {
  let text = compact(value, DREAM_MAX_CHARS_PER_FRAGMENT * 2)
    .replace(/^[-*\d.)\s]+/, '')
    .replace(/^['"]|['"]$/g, '')
    .trim();
  if (!text) return '';
  text = text.split(/\s+/).slice(0, DREAM_MAX_WORDS_PER_FRAGMENT).join(' ');
  return text.slice(0, DREAM_MAX_CHARS_PER_FRAGMENT).trim();
}

export function parseDreamFragments(raw) {
  const parsed = extractJson(raw);
  let values = parsed && Array.isArray(parsed.fragments) ? parsed.fragments : null;
  if (!values) {
    values = String(raw || '').split(/[\r\n]+/)
      .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
      .filter(Boolean);
  }
  return values.map(shapeFragment).filter(Boolean).slice(0, DREAM_MAX_FRAGMENTS);
}

export function validateDreamOutput(raw) {
  if (looksLikeAssistantFrame(raw)) {
    return { valid: false, fragments: [], result: 'REJECTED_ASSISTANT_FRAME' };
  }
  const fragments = parseDreamFragments(raw);
  return fragments.length
    ? { valid: true, fragments, result: 'PASSED' }
    : { valid: false, fragments: [], result: 'REJECTED_INVALID_SHAPE' };
}

export function dreamMemoryQuery(packet) {
  const text = [
    ...packet.recent_world_residue.map((item) => item.text),
    ...packet.immediate_material.map((item) => item.text),
  ].join(' ').slice(0, 600);
  const tags = uniqueBy([
    ...packet.immediate_material.map((item) => item.kind),
    ...packet.recent_world_residue.map((item) => item.location),
  ].filter(Boolean), (item) => item).slice(0, 12);
  return { text, tags, location: packet.recent_world_residue.at(-1)?.location || null };
}

// Public layout values are deterministic engineering presentation choices. The
// arrays prevent overlap by preserving document flow; only horizontal offset,
// opacity, scale and spacing vary.
const OFFSETS = Object.freeze([4, 18, 9, 27, 13]);
const OPACITIES = Object.freeze([0.86, 0.72, 0.80, 0.66, 0.76]);
const SCALES = Object.freeze([1.00, 0.96, 0.98, 1.01, 0.97]);
const GAPS = Object.freeze([10, 18, 8, 22, 14]);

function hash(text) {
  let value = 2166136261;
  for (const ch of String(text || '')) {
    value ^= ch.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function dreamFragmentLayout(eventId, index) {
  const base = hash(eventId) % OFFSETS.length;
  const pos = (base + Math.max(0, Number(index) || 0)) % OFFSETS.length;
  return {
    offsetPct: OFFSETS[pos], opacity: OPACITIES[pos], scale: SCALES[pos], gapPx: GAPS[pos],
  };
}

export const DREAM_PRESENTATION_NUMBERS = Object.freeze({
  offsetsPct: OFFSETS, opacities: OPACITIES, scales: SCALES, gapsPx: GAPS,
  animationMs: 4800,
});
