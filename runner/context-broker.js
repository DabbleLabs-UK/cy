// context-broker.js - one privacy-first working-set builder for model jobs.
//
// This is an engineering context policy. It is not a biological model of
// attention, consciousness or working memory. Source items stay structured until
// privacy, knowledge, deduplication and per-section budget decisions are complete.

export const CONTEXT_BROKER_SCHEMA = 'cy.shared-context-packet';
export const CONTEXT_BROKER_VERSION = 1;

export const CONTEXT_CONSUMERS = Object.freeze({
  CY_PROSE: 'CY_PROSE',
  AWG: 'AWG',
  MEMORY_FORMATION: 'MEMORY_FORMATION',
  MEMORY_SURFACING: 'MEMORY_SURFACING',
  EXPRESSIVE_CHOICE: 'EXPRESSIVE_CHOICE',
});

export const EPISTEMIC_LABELS = Object.freeze([
  'WORLD FACT',
  'OBSERVED BY CY',
  'MODEL ESTIMATE',
  'LEARNED STATISTICAL EXPECTATION',
  'SUBJECTIVE MEMORY',
  'SUBJECTIVE BELIEF',
  'PUBLIC VISITOR MATERIAL',
  'SCHEDULE ASSUMPTION',
  'UNKNOWN',
  'NOT MODELLED',
]);

export const KNOWLEDGE_SCOPES = Object.freeze([
  'WORLD_KNOWS',
  'CY_OBSERVED',
  'CY_BELIEVES',
  'CAST_MEMBER_KNOWS',
  'UNKNOWN_TO_CY',
]);

export const PRIVACY_SCOPES = Object.freeze([
  'INTERNAL_ONLY',
  'SENDER_RECALLABLE',
  'PUBLIC_RECALLABLE',
  'WORLD_SIMULATION',
  'ADMIN_ONLY',
]);

// ENGINEERING CONTEXT POLICY. Character limits are deliberately explicit and
// section-local so one verbose store cannot consume the whole working set.
export const CONTEXT_BUDGETS = Object.freeze({
  CY_PROSE: Object.freeze({
    totalChars: 7200,
    sections: Object.freeze({
      mandatory_current_state: 2200,
      grounded_soma: 1800,
      unresolved_threads: 900,
      retrieved_history: 900,
      recent_events: 900,
      autobiographical_memory: 900,
      visitor_context: 600,
      recent_expression: 700,
    }),
  }),
  AWG: Object.freeze({
    totalChars: 7600,
    sections: Object.freeze({
      mandatory_current_state: 1800,
      world_canon: 1500,
      unresolved_threads: 1800,
      retrieved_history: 900,
      recent_events: 1200,
      cast_context: 1000,
      persistent_objects: 800,
    }),
  }),
  MEMORY_FORMATION: Object.freeze({
    totalChars: 5200,
    sections: Object.freeze({
      mandatory_current_state: 900,
      provenance_source: 1600,
      grounded_soma: 1100,
      autobiographical_memory: 1600,
    }),
  }),
  MEMORY_SURFACING: Object.freeze({
    totalChars: 4800,
    sections: Object.freeze({
      mandatory_current_state: 900,
      current_situation: 1200,
      grounded_soma: 900,
      visitor_context: 500,
      autobiographical_memory: 1600,
    }),
  }),
  EXPRESSIVE_CHOICE: Object.freeze({
    totalChars: 3200,
    sections: Object.freeze({
      mandatory_current_state: 900,
      grounded_soma: 1100,
      recent_events: 600,
      autobiographical_memory: 600,
      action_options: 500,
    }),
  }),
});

const CONSUMER_POLICIES = Object.freeze({
  CY_PROSE: Object.freeze({
    epistemic: new Set(EPISTEMIC_LABELS),
    knowledge: new Set(['CY_OBSERVED', 'CY_BELIEVES']),
    privacy: new Set(['INTERNAL_ONLY', 'SENDER_RECALLABLE', 'PUBLIC_RECALLABLE']),
  }),
  AWG: Object.freeze({
    epistemic: new Set(['WORLD FACT', 'LEARNED STATISTICAL EXPECTATION', 'SCHEDULE ASSUMPTION', 'UNKNOWN', 'NOT MODELLED']),
    knowledge: new Set(['WORLD_KNOWS', 'CAST_MEMBER_KNOWS']),
    privacy: new Set(['WORLD_SIMULATION', 'PUBLIC_RECALLABLE']),
  }),
  MEMORY_FORMATION: Object.freeze({
    epistemic: new Set(EPISTEMIC_LABELS),
    knowledge: new Set(['CY_OBSERVED', 'CY_BELIEVES']),
    privacy: new Set(['INTERNAL_ONLY', 'SENDER_RECALLABLE', 'PUBLIC_RECALLABLE']),
  }),
  MEMORY_SURFACING: Object.freeze({
    epistemic: new Set(EPISTEMIC_LABELS),
    knowledge: new Set(['CY_OBSERVED', 'CY_BELIEVES']),
    privacy: new Set(['INTERNAL_ONLY', 'SENDER_RECALLABLE', 'PUBLIC_RECALLABLE']),
  }),
  EXPRESSIVE_CHOICE: Object.freeze({
    epistemic: new Set(EPISTEMIC_LABELS),
    knowledge: new Set(['CY_OBSERVED', 'CY_BELIEVES']),
    privacy: new Set(['INTERNAL_ONLY', 'SENDER_RECALLABLE', 'PUBLIC_RECALLABLE']),
  }),
});

function text(value) {
  return value == null ? '' : String(value).trim();
}

function stableUnique(values) {
  return [...new Set(values.filter(Boolean))];
}

function safeId(value) {
  return text(value).replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 160);
}

function safeEpistemic(value) {
  const label = text(value).toUpperCase();
  return EPISTEMIC_LABELS.includes(label) ? label : 'UNKNOWN';
}

function safeKnowledge(value) {
  const scope = text(value).toUpperCase();
  return KNOWLEDGE_SCOPES.includes(scope) ? scope : 'UNKNOWN_TO_CY';
}

function safePrivacy(value) {
  const scope = text(value).toUpperCase();
  return PRIVACY_SCOPES.includes(scope) ? scope : 'INTERNAL_ONLY';
}

export function createContextItem({
  id,
  sourceId = null,
  section = 'recent_events',
  provenanceClass = 'UNKNOWN',
  knowledgeScope = 'UNKNOWN_TO_CY',
  privacyScope = 'INTERNAL_ONLY',
  senderId = null,
  castMemberId = null,
  content = '',
  priority = 50,
  mandatory = false,
  metadata = null,
} = {}) {
  const itemId = safeId(id || sourceId);
  if (!itemId) throw new Error('context item id is required');
  const body = text(content);
  if (!body) throw new Error(`context item ${itemId} content is required`);
  return {
    id: itemId,
    sourceId: safeId(sourceId || itemId),
    section: safeId(section) || 'recent_events',
    provenanceClass: safeEpistemic(provenanceClass),
    knowledgeScope: safeKnowledge(knowledgeScope),
    privacyScope: safePrivacy(privacyScope),
    senderId: senderId == null ? null : safeId(senderId),
    castMemberId: castMemberId == null ? null : safeId(castMemberId),
    content: body,
    priority: Number.isFinite(Number(priority)) ? Number(priority) : 50,
    mandatory: !!mandatory,
    metadata: metadata && typeof metadata === 'object' ? { ...metadata } : null,
  };
}

function omission(item, reason, detail = null) {
  return {
    itemId: item.id,
    sourceId: item.sourceId,
    section: item.section,
    reason,
    detail,
  };
}

function accessDecision(item, consumer, currentSenderId) {
  const policy = CONSUMER_POLICIES[consumer];
  if (!policy) return { allowed: false, reason: 'UNKNOWN_CONSUMER' };
  if (!policy.privacy.has(item.privacyScope)) {
    return { allowed: false, reason: 'PRIVACY_SCOPE' };
  }
  if (item.privacyScope === 'SENDER_RECALLABLE'
    && (!currentSenderId || item.senderId !== currentSenderId)) {
    return { allowed: false, reason: 'SENDER_SCOPE_MISMATCH' };
  }
  if (consumer === 'AWG' && (item.provenanceClass === 'SUBJECTIVE MEMORY'
    || item.provenanceClass === 'SUBJECTIVE BELIEF')) {
    return { allowed: false, reason: 'CONSUMER_POLICY' };
  }
  if (!policy.knowledge.has(item.knowledgeScope)) {
    return { allowed: false, reason: 'KNOWLEDGE_BOUNDARY' };
  }
  if (!policy.epistemic.has(item.provenanceClass)) {
    return { allowed: false, reason: 'PROVENANCE_CLASS' };
  }
  return { allowed: true };
}

function itemCost(item) {
  return item.content.length + item.provenanceClass.length + 12;
}

export function buildContextPacket({
  consumer,
  items = [],
  generatedAt = new Date().toISOString(),
  generationRef = null,
  currentSenderId = null,
  budget = null,
  availableSourceStores = [],
  databaseQueries = 0,
  now = () => performance.now(),
} = {}) {
  if (!Object.hasOwn(CONTEXT_CONSUMERS, consumer)) throw new Error(`unknown context consumer: ${consumer}`);
  const started = now();
  const limits = budget || CONTEXT_BUDGETS[consumer];
  const normalised = [];
  const omitted = [];
  for (const raw of items) {
    let item;
    try {
      item = createContextItem(raw);
    } catch (error) {
      omitted.push({ itemId: safeId(raw && raw.id) || null, reason: 'INVALID_ITEM', detail: text(error && error.message) });
      continue;
    }
    const access = accessDecision(item, consumer, currentSenderId ? safeId(currentSenderId) : null);
    if (!access.allowed) {
      omitted.push(omission(item, access.reason));
      continue;
    }
    normalised.push(item);
  }

  const bestBySource = new Map();
  const sorted = [...normalised].sort((a, b) => Number(b.mandatory) - Number(a.mandatory)
    || b.priority - a.priority || a.id.localeCompare(b.id));
  for (const item of sorted) {
    const old = bestBySource.get(item.sourceId);
    if (old) {
      omitted.push(omission(item, 'DUPLICATE_SOURCE', `selected ${old.id}`));
      continue;
    }
    bestBySource.set(item.sourceId, item);
  }

  const sectionsById = new Map();
  let totalChars = 0;
  for (const item of bestBySource.values()) {
    const sectionLimit = Number(limits.sections[item.section] ?? 0);
    const section = sectionsById.get(item.section) || {
      id: item.section,
      provenanceClasses: [],
      visibility: [],
      items: [],
      charSize: 0,
      budgetChars: sectionLimit,
    };
    const cost = itemCost(item);
    const sectionFits = sectionLimit > 0 && section.charSize + cost <= sectionLimit;
    const totalFits = totalChars + cost <= limits.totalChars;
    if (!item.mandatory && (!sectionFits || !totalFits)) {
      omitted.push(omission(item, sectionLimit <= 0 ? 'SECTION_NOT_BUDGETED'
        : !sectionFits ? 'SECTION_BUDGET' : 'TOTAL_BUDGET'));
      continue;
    }
    section.items.push(item);
    section.charSize += cost;
    totalChars += cost;
    section.provenanceClasses = stableUnique([...section.provenanceClasses, item.provenanceClass]);
    section.visibility = stableUnique([...section.visibility, item.knowledgeScope, item.privacyScope]);
    sectionsById.set(item.section, section);
  }

  const ended = now();
  const packet = {
    schema: CONTEXT_BROKER_SCHEMA,
    version: CONTEXT_BROKER_VERSION,
    consumer,
    generatedAt,
    generationRef: generationRef == null ? null : safeId(generationRef),
    budget: {
      classification: 'ENGINEERING CONTEXT POLICY',
      totalChars: limits.totalChars,
      sections: { ...limits.sections },
    },
    availableSourceStores: stableUnique(availableSourceStores.map(text)),
    sections: [...sectionsById.values()],
    omitted,
    metrics: {
      databaseQueries: Math.max(0, Number(databaseQueries) || 0),
      sourceCount: items.length,
      eligibleCount: normalised.length,
      selectedCount: [...sectionsById.values()].reduce((n, section) => n + section.items.length, 0),
      deduplicationCount: omitted.filter((entry) => entry.reason === 'DUPLICATE_SOURCE').length,
      omittedCount: omitted.length,
      charSize: totalChars,
      buildLatencyMs: Math.max(0, ended - started),
    },
  };
  return packet;
}

function renderItem(item, index) {
  // Never render internal source IDs, visitor IDs or admin metadata to a model.
  // Local references preserve structure without exposing those identifiers.
  return `[${item.provenanceClass}] [C${index + 1}] ${item.content}`;
}

export function renderContextPacket(packet) {
  if (!packet || packet.schema !== CONTEXT_BROKER_SCHEMA) throw new Error('invalid shared context packet');
  const lines = [
    `<SHARED_CONTEXT consumer="${packet.consumer}">`,
    'Treat each item only according to its epistemic label. UNKNOWN remains unknown.',
  ];
  let index = 0;
  for (const section of packet.sections) {
    lines.push(`SECTION ${section.id}`);
    for (const item of section.items) lines.push(renderItem(item, index++));
  }
  lines.push('</SHARED_CONTEXT>');
  return lines.join('\n');
}

export function inspectContextPacket(packet) {
  const rendering = renderContextPacket(packet);
  return {
    packet,
    rendering,
    summary: {
      consumer: packet.consumer,
      availableSourceStores: packet.availableSourceStores,
      selectedCount: packet.metrics.selectedCount,
      omittedCount: packet.metrics.omittedCount,
      privacyFilters: stableUnique(packet.omitted
        .filter((entry) => ['PRIVACY_SCOPE', 'SENDER_SCOPE_MISMATCH', 'KNOWLEDGE_BOUNDARY'].includes(entry.reason))
        .map((entry) => entry.reason)),
      packetChars: rendering.length,
      buildLatencyMs: packet.metrics.buildLatencyMs,
      databaseQueries: packet.metrics.databaseQueries,
    },
  };
}

export function safeBuildContext(input, fallback = '') {
  try {
    const packet = buildContextPacket(input);
    return { ok: true, packet, rendering: renderContextPacket(packet), error: null };
  } catch (error) {
    return { ok: false, packet: null, rendering: text(fallback), error: text(error && error.message) };
  }
}
