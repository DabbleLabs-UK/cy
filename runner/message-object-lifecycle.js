// message-object-lifecycle.js - deterministic lifecycle for persistent messages.

export const MESSAGE_OBJECT_SCHEMA = 'cy.message-object-state';
export const MESSAGE_OBJECT_VERSION = 1;

export const MESSAGE_LIFECYCLE_STATES = Object.freeze([
  'CREATED', 'DELIVERED', 'READ', 'RESOLVED', 'RETIRED',
]);

export const MESSAGE_TRANSITION_ACTIONS = Object.freeze([
  'CREATE', 'DELIVER', 'READ', 'RESOLVE', 'RETIRE',
]);

export const MESSAGE_READ_STATES = Object.freeze(['UNREAD', 'READ']);

export const MESSAGE_LIFECYCLE_SEMANTICS = Object.freeze({
  CREATED: 'A distinct physical message exists but has not been delivered.',
  DELIVERED: 'The physical message reached its recipient; content is not necessarily known.',
  READ: 'The recipient obtained the message content through a grounded observation.',
  RESOLVED: 'The message no longer represents an open current-world concern.',
  RETIRED: 'The physical message was removed from current salient world state.',
});

const MESSAGE_TRANSITIONS = Object.freeze({
  CREATED: new Set(['DELIVER', 'RETIRE']),
  DELIVERED: new Set(['READ', 'RESOLVE', 'RETIRE']),
  READ: new Set(['RESOLVE', 'RETIRE']),
  RESOLVED: new Set(['RETIRE']),
  RETIRED: new Set(),
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clean(value, max = 800) {
  return value == null ? '' : String(value).trim().slice(0, max);
}

function id(value) {
  return clean(value, 160).replace(/[^a-zA-Z0-9:_-]/g, '');
}

export function isMeaningfulMessageContent(value) {
  const content = clean(value);
  if (!content) return false;
  return !/^(?:unknown|none|n\/a|message|no content|contents? unknown)$/i.test(content);
}

export function normaliseMessageState(value) {
  if (!value || typeof value !== 'object') return null;
  const lifecycleState = clean(value.lifecycleState).toUpperCase();
  const readState = clean(value.readState).toUpperCase();
  if (!MESSAGE_LIFECYCLE_STATES.includes(lifecycleState)
    || !MESSAGE_READ_STATES.includes(readState)) return null;
  const content = clean(value.content) || null;
  const contentRef = value.contentRef && typeof value.contentRef === 'object'
    ? {
      eventId: id(value.contentRef.eventId) || null,
      claimIndex: Number.isInteger(value.contentRef.claimIndex)
        ? value.contentRef.claimIndex : null,
    }
    : null;
  const reconciliation = clean(value.reconciliation, 80).toUpperCase() || null;
  const mergedIntoObjectId = id(value.mergedIntoObjectId) || null;
  return {
    schema: MESSAGE_OBJECT_SCHEMA,
    version: MESSAGE_OBJECT_VERSION,
    senderId: id(value.senderId) || null,
    recipientId: id(value.recipientId) || null,
    content,
    contentTruthStatus: clean(value.contentTruthStatus, 24).toUpperCase() || 'UNKNOWN',
    contentRef: contentRef && contentRef.eventId && contentRef.claimIndex != null ? contentRef : null,
    receiptObservedByCy: value.receiptObservedByCy === true,
    readState,
    lifecycleState,
    threadId: id(value.threadId) || null,
    resolvedAt: clean(value.resolvedAt, 40) || null,
    retiredAt: clean(value.retiredAt, 40) || null,
    sourceEventIds: [...new Set((Array.isArray(value.sourceEventIds) ? value.sourceEventIds : [])
      .map(id).filter(Boolean))],
    ...(reconciliation ? { reconciliation } : {}),
    ...(mergedIntoObjectId ? { mergedIntoObjectId } : {}),
  };
}

export function isCurrentMessageObject(object) {
  if (!object || String(object.type || '').toLowerCase() !== 'message') return true;
  const message = normaliseMessageState(object.message);
  // Legacy messages remain visible until an explicit, reviewed reconciliation.
  // An explicit terminal lifecycle marker is already a reviewed non-current
  // decision even if an older record lacks newer schema fields.
  if (!message) {
    const lifecycleState = clean(object.message && object.message.lifecycleState).toUpperCase();
    return !['RESOLVED', 'RETIRED'].includes(lifecycleState);
  }
  return !['RESOLVED', 'RETIRED'].includes(message.lifecycleState);
}

export function messageStatusForAction(actionValue, existingStatus = null) {
  const action = clean(actionValue).toUpperCase();
  if (action === 'CREATE') return 'ACTIVE';
  if (['DELIVER', 'READ', 'RESOLVE'].includes(action)) return 'DELIVERED';
  if (action === 'RETIRE') return 'RETIRED';
  return clean(existingStatus, 24).toUpperCase() || 'ACTIVE';
}

export function isAllowedMessageTransition(existingMessage, actionValue) {
  const action = clean(actionValue).toUpperCase();
  if (!existingMessage) return ['CREATE', 'DELIVER'].includes(action);
  const message = normaliseMessageState(existingMessage);
  if (!message) return false;
  return MESSAGE_TRANSITIONS[message.lifecycleState].has(action);
}

export function deriveMessageState({
  existingMessage = null,
  transition,
  claims = [],
  eventId,
  threadId = null,
  cyObservation = null,
  acceptedAt,
} = {}) {
  const previous = normaliseMessageState(existingMessage);
  const action = clean(transition && transition.action).toUpperCase();
  if (!MESSAGE_TRANSITION_ACTIONS.includes(action)) throw new Error('INVALID_MESSAGE_ACTION');
  if (!isAllowedMessageTransition(previous, action)) throw new Error('INVALID_MESSAGE_TRANSITION');

  const claimIndex = Number.isInteger(transition && transition.contentClaimIndex)
    ? transition.contentClaimIndex : null;
  const claim = claimIndex != null ? claims[claimIndex] : null;
  const suppliedContent = clean(claim && claim.content) || null;
  const content = suppliedContent || previous && previous.content || null;
  const sourceId = id(eventId);
  const recipientId = id(transition && transition.recipientId) || previous && previous.recipientId || null;
  const cyAccess = clean(cyObservation && cyObservation.access).toUpperCase();
  const observedReceipt = recipientId === 'cy'
    && ['DELIVER', 'READ'].includes(action)
    && ['CY_DIRECT', 'CY_LEARNS_LATER'].includes(cyAccess);
  const lifecycleState = action === 'CREATE' ? 'CREATED'
    : action === 'DELIVER' ? 'DELIVERED'
      : action === 'READ' ? 'READ'
        : action === 'RESOLVE' ? 'RESOLVED' : 'RETIRED';

  return {
    schema: MESSAGE_OBJECT_SCHEMA,
    version: MESSAGE_OBJECT_VERSION,
    senderId: id(transition && transition.senderId) || previous && previous.senderId || null,
    recipientId,
    content,
    contentTruthStatus: suppliedContent
      ? clean(claim && claim.truthStatus, 24).toUpperCase() || 'UNKNOWN'
      : previous && previous.contentTruthStatus || 'UNKNOWN',
    contentRef: suppliedContent
      ? { eventId: sourceId, claimIndex }
      : previous && clone(previous.contentRef) || null,
    receiptObservedByCy: !!(previous && previous.receiptObservedByCy) || observedReceipt,
    readState: action === 'READ' ? 'READ' : previous && previous.readState || 'UNREAD',
    lifecycleState,
    threadId: id(threadId) || previous && previous.threadId || null,
    resolvedAt: action === 'RESOLVE' ? clean(acceptedAt, 40)
      : previous && previous.resolvedAt || null,
    retiredAt: action === 'RETIRE' ? clean(acceptedAt, 40)
      : previous && previous.retiredAt || null,
    sourceEventIds: [...new Set([
      ...(previous && previous.sourceEventIds || []),
      sourceId,
    ].filter(Boolean))],
  };
}

function cyObservation(candidate) {
  return (Array.isArray(candidate && candidate.observations) ? candidate.observations : [])
    .find((observation) => id(observation && observation.observerId) === 'cy') || null;
}

function candidateClaim(candidate, object) {
  const claims = Array.isArray(candidate && candidate.informationClaims)
    ? candidate.informationClaims : [];
  const index = Number.isInteger(object && object.contentClaimIndex)
    ? object.contentClaimIndex : claims.length === 1 ? 0 : null;
  return index == null ? { index: null, claim: null } : { index, claim: claims[index] || null };
}

function legacyMessageIsPhysical(candidate) {
  const source = `${candidate && candidate.eventFamily || ''} ${candidate && candidate.objective && candidate.objective.eventType || ''} ${candidate && candidate.objective && candidate.objective.summary || ''}`;
  return /message|note|deliver|hand|pass/i.test(source);
}

export function planLegacyMessageReconciliation(entries) {
  const input = Array.isArray(entries) ? clone(entries) : [];
  const plans = [];
  const migratedByThread = new Map();

  for (const entry of input) {
    const object = entry && entry.object || {};
    const candidate = entry && entry.candidate || {};
    const participants = new Set((candidate.participants || []).map(id));
    const threadId = id(entry && entry.thread && entry.thread.id
      || candidate.continuationOf && candidate.continuationOf.threadId);
    const ownerId = id(object.ownerId);
    const holderId = id(object.holderId);
    const { index: claimIndex, claim } = candidateClaim(candidate, object);
    const directCyObservation = cyObservation(candidate);
    const sourceEventId = id(object.sourceEventId);
    const reasons = [];

    if (!legacyMessageIsPhysical(candidate)) reasons.push('EVENT_DID_NOT_CREATE_A_PHYSICAL_MESSAGE');
    if (!ownerId || !participants.has(ownerId)) reasons.push('SENDER_NOT_A_PARTICIPANT');
    if (!claim || !isMeaningfulMessageContent(claim.content)) reasons.push('NO_MEANINGFUL_MESSAGE_CONTENT');

    const mergeTarget = threadId ? migratedByThread.get(threadId) : null;
    if (candidate.decision === 'CONTINUATION' && mergeTarget) {
      plans.push({
        objectId: id(object.id),
        classification: 'MERGE INTO EXISTING',
        targetObjectId: mergeTarget.objectId,
        reasons: ['CONTINUATION_OF_EXISTING_MESSAGE_THREAD'],
        proposedMessage: {
          ...clone(mergeTarget.proposedMessage),
          receiptObservedByCy: mergeTarget.proposedMessage.receiptObservedByCy
            || !!directCyObservation,
          sourceEventIds: [...new Set([
            ...mergeTarget.proposedMessage.sourceEventIds,
            sourceEventId,
          ].filter(Boolean))],
        },
      });
      continue;
    }

    if (reasons.length) {
      plans.push({
        objectId: id(object.id),
        classification: 'INVALID HISTORICAL ARTIFACT',
        targetObjectId: null,
        reasons,
        proposedMessage: null,
      });
      continue;
    }

    const proposedMessage = {
      schema: MESSAGE_OBJECT_SCHEMA,
      version: MESSAGE_OBJECT_VERSION,
      senderId: ownerId,
      recipientId: holderId || null,
      content: clean(claim.content),
      contentTruthStatus: clean(claim.truthStatus, 24).toUpperCase() || 'UNKNOWN',
      contentRef: { eventId: sourceEventId, claimIndex },
      receiptObservedByCy: holderId === 'cy' && !!directCyObservation
        && ['CY_DIRECT', 'CY_LEARNS_LATER'].includes(clean(directCyObservation.access).toUpperCase()),
      readState: 'UNREAD',
      lifecycleState: 'DELIVERED',
      threadId: threadId || null,
      resolvedAt: null,
      retiredAt: null,
      sourceEventIds: [sourceEventId].filter(Boolean),
    };
    const plan = {
      objectId: id(object.id),
      classification: 'UPDATE/MIGRATE',
      targetObjectId: null,
      reasons: [proposedMessage.receiptObservedByCy
        ? 'GROUNDED_DIRECT_RECEIPT' : 'WORLD_ONLY_DELIVERY_WITHOUT_CY_KNOWLEDGE'],
      proposedMessage,
    };
    plans.push(plan);
    if (threadId) migratedByThread.set(threadId, plan);
  }
  return plans;
}
