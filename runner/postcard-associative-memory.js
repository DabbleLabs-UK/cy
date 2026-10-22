import { filterMemoriesBeforePrompt, memoryEpistemicNature } from './autobiographical-memory.js';

export const ASSOCIATIVE_WAIT_MS = 750;
export const ASSOCIATIVE_LIMIT = 2;
export const ASSOCIATIVE_CHARS = 260;

export function postcardAssociativeItem(memory) {
  return {
    id: `memory:${memory.id}`, sourceId: `memory:${memory.id}`, section: 'autobiographical_memory',
    provenanceClass: 'SUBJECTIVE MEMORY', knowledgeScope: 'CY_BELIEVES',
    privacyScope: memory.privacyScope, senderId: memory.subjectVisitorId,
    priority: 70, mandatory: false,
    // Put the origin INSIDE the budgeted content; do not add uncounted metadata
    // or technical source IDs to model text. Recall never corroborates a claim.
    content: `Optional association: ${memoryEpistemicNature(memory)}; ${String(memory.consistencyStatus).toLowerCase()} recollection, not world proof: ${memory.content}`,
  };
}

// No global working set, model selector, history lookup or mutation. A late
// response cannot modify the immutable local/cloud context snapshot.
export async function loadPostcardAssociativeRecall({ client, visitorId = null, text = '', sender,
  deadlineMs = ASSOCIATIVE_WAIT_MS, now = Date.now }) {
  const started = now();
  const controller = new AbortController();
  let timer;
  const empty = status => ({ status, mechanism: 'INDEXED_ASSOCIATIVE', selected: [], consideredIds: [], elapsedMs: now() - started });
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => client.getPostcardAssociations({ visitorId, query: { text },
        excludeIds: sender.selected.map(m => m.id), signal: controller.signal })),
      new Promise((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(new Error('optional recall deadline'));
      }, deadlineMs); }),
    ]);
    if (result?.ok !== true || !Array.isArray(result.candidates)) return empty('UNAVAILABLE');
    const selected = [], used = new Set(), own = new Set(sender.selected.map(m => m.id));
    for (const raw of result.candidates) {
      if (!raw || own.has(raw.id) || raw.status !== 'ACTIVE') continue;
      if (raw.subjectVisitorId && visitorId && raw.subjectVisitorId === visitorId) continue;
      const publicSafe = raw.privacyScope === 'PUBLIC_RECALLABLE' && !!raw.publicSummary?.trim();
      const ownExperience = raw.privacyScope === 'INTERNAL_ONLY' && !raw.subjectVisitorId
        && !['POSTCARD', 'CY_REPLY'].includes(raw.originKind)
        && !raw.sourceRefs?.some(s => ['POSTCARD', 'CY_REPLY'].includes(s.type) || s.visibility === 'SENDER_RECALLABLE')
        && !raw.sourceKeys?.some(k => typeof k === 'string' && k.startsWith('exchange:'));
      if (!publicSafe && !ownExperience) continue;
      if (!memoryEpistemicNature(raw) || !Array.isArray(raw.sourceRefs) || !raw.sourceRefs.length
        || !Array.isArray(raw.sourceKeys) || !raw.sourceKeys.length
        || !raw.sourceRefs.every(s => typeof s.type === 'string' && s.type && typeof s.id === 'string' && s.id)
        || !raw.sourceKeys.every(k => typeof k === 'string' && k)) continue;
      if (raw.sourceKeys.some(k => used.has(k))) continue;
      const [safe] = filterMemoriesBeforePrompt([raw], { currentVisitorId: visitorId });
      if (!safe || [...safe.content].length > ASSOCIATIVE_CHARS) continue;
      selected.push({ ...safe, sourceKeys: [...raw.sourceKeys], sourceRefs: raw.sourceRefs.map(s => ({ ...s })) });
      raw.sourceKeys.forEach(k => used.add(k)); own.add(raw.id);
      if (selected.length === ASSOCIATIVE_LIMIT) break;
    }
    return { status: selected.length ? 'READY' : 'NO_MATCH', mechanism: 'INDEXED_ASSOCIATIVE', selected,
      consideredIds: Array.isArray(result.consideredIds) ? result.consideredIds.filter(id => typeof id === 'string').slice(0, 200) : [],
      elapsedMs: now() - started };
  } catch {
    return empty(controller.signal.aborted ? 'DEADLINE_EXPIRED' : 'UNAVAILABLE');
  } finally { clearTimeout(timer); }
}

// The broker's actual included items, not a string search or the offered set,
// establish prompt insertion. These identities stay in private access telemetry.
export function associativePromptInspection(recall, packet) {
  const included = new Set((packet?.sections || []).flatMap(s => s.items || []).map(i => i.id));
  const inserted = recall.selected.filter(m => included.has(`memory:${m.id}`));
  return {
    querySourceType: 'POSTCARD_ASSOCIATIVE', senderKnown: false,
    query: { consumer: 'postcard', status: recall.status, phase: 'ACTUAL_PROMPT_ASSEMBLY' },
    mechanisms: ['FULLTEXT_LEXICAL', 'SAFE_TEXT_TOPIC_RANK', 'SOURCE_GROUP_DEDUP'],
    privacyFilter: 'PUBLIC SAFE SUMMARY OR UNLINKED CY AUTOBIOGRAPHY; NO SENDER-ONLY MEMORY',
    candidateIds: recall.consideredIds, offeredIds: recall.selected.map(m => m.id),
    selectedIds: inserted.map(m => m.id), insertedIds: inserted.map(m => m.id),
    candidateProvenance: Object.fromEntries(recall.selected.map(m => [m.id, {
      originKind: m.originKind, sourceRefs: m.sourceRefs, sourceKeys: m.sourceKeys,
    }])),
  };
}
