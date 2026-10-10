// Foreground continuity reads the existing canonical store, without inference.
// Background model-mediated enrichment remains optional and independently timed.
import { filterMemoriesBeforePrompt, formatAutobiographicalMemory, memoryEpistemicNature } from './autobiographical-memory.js';

export const SENDER_MEMORY_WAIT_MS = 5000;
export const POSTCARD_ENRICHMENT_WAIT_MS = 750;
export const SENDER_MEMORY_PER_TYPE = 2;
export const SENDER_MEMORY_CHARS = 600;

export async function loadPostcardSenderContinuity({ client, visitorId, query = {},
  deadlineMs = SENDER_MEMORY_WAIT_MS, now = () => Date.now() }) {
  const started = now();
  if (!visitorId) return { ready: true, status: 'NO_SENDER_ID', selected: [], elapsedMs: 0 };
  const controller = new AbortController();
  let timer;
  try {
    const response = await Promise.race([
      Promise.resolve().then(() => client.getSenderContinuity({ visitorId, query, signal: controller.signal })),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('sender continuity deadline'));
        }, deadlineMs);
      }),
    ]);
    if (response?.ok !== true || !Array.isArray(response.candidates)) throw new Error('invalid sender continuity response');
    // Defense in depth: a public memory from another sender is not this layer.
    const own = response.candidates.filter(m => m && m.subjectVisitorId === visitorId
      && ['PERSON', 'UNRESOLVED_THREAD'].includes(m.type));
    const safe = filterMemoriesBeforePrompt(own, { currentVisitorId: visitorId });
    const selected = ['PERSON', 'UNRESOLVED_THREAD'].flatMap(type => safe
      .filter(m => m.type === type).slice(0, SENDER_MEMORY_PER_TYPE))
      .map(m => ({ ...m, content: m.content.slice(0, SENDER_MEMORY_CHARS) }));
    return { ready: true, status: selected.length ? 'READY' : 'NO_STORED_MEMORIES', selected,
      elapsedMs: now() - started };
  } catch {
    return { ready: false, status: controller.signal.aborted ? 'TIMEOUT' : 'UNAVAILABLE', selected: [],
      elapsedMs: now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export async function loadPostcardEnrichment(runtime, context, sender, {
  deadlineMs = POSTCARD_ENRICHMENT_WAIT_MS, now = () => Date.now(),
} = {}) {
  const started = now();
  let timer;
  try {
    const result = await Promise.race([
      runtime.requestWorkingContext(context, { deadlineMs, priority: 100, scheduleDelayMs: 1000 }),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), deadlineMs); }),
    ]);
    const ready = result?.inspection?.status === 'PREPARED';
    const ownIds = new Set(sender.selected.map(m => m.id));
    // Snapshot the set: a late background completion cannot replace this turn's
    // required sender layer or change context between local and cloud fallback.
    const selected = ready ? filterMemoriesBeforePrompt((result.selected || []).map(m => ({ ...m, status: 'ACTIVE' })),
      { currentVisitorId: context.currentVisitorId }).filter(m => !ownIds.has(m.id)).slice(0, 3) : [];
    return { status: ready ? 'READY' : 'DEADLINE_EXPIRED', selected, elapsedMs: now() - started };
  } catch {
    return { status: 'UNAVAILABLE', selected: [], elapsedMs: now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export function postcardSenderMemoryItems(sender) {
  return sender.selected.map(memory => ({
    id: `memory:${memory.id}`, sourceId: `memory:${memory.id}`, section: 'autobiographical_memory',
    provenanceClass: 'SUBJECTIVE MEMORY', knowledgeScope: 'CY_BELIEVES',
    epistemicDetail: memoryEpistemicNature(memory),
    privacyScope: memory.privacyScope, senderId: memory.subjectVisitorId,
    priority: 100, mandatory: true,
    content: `${memory.type.toLowerCase()} recollection (${memory.consistencyStatus.toLowerCase()}): ${memory.content}`,
  }));
}

export function postcardMemoryDirective({ sender, enrichment }) {
  // The generic formatter caps a set at three. Format required records separately
  // so both reserved PERSON and unresolved-topic slots survive broker fallback.
  return [...sender.selected.map(m => formatAutobiographicalMemory([m])),
    formatAutobiographicalMemory(enrichment.selected)].filter(Boolean).join('\n');
}

export function postcardMemoryReadiness(sender, enrichment = null) {
  return {
    sender_status: sender.status, sender_wait_ms: sender.elapsedMs,
    sender_memory_count: sender.selected.length,
    person_count: sender.selected.filter(m => m.type === 'PERSON').length,
    unresolved_count: sender.selected.filter(m => m.type === 'UNRESOLVED_THREAD').length,
    enrichment_status: enrichment?.status || 'NOT_REQUESTED',
    enrichment_wait_ms: enrichment?.elapsedMs || 0,
    enrichment_count: enrichment?.selected.length || 0,
    reply_held: !sender.ready,
  };
}
