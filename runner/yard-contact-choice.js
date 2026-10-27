// One bounded response to an actual yard greeting. No NPC presence or dialogue.
import { createHash } from 'node:crypto';
import { CAST } from './cast.js';
import { CHARACTER_KNOWLEDGE_TEXT } from './prompt.js';
import { tsNow } from './client.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';

export const YARD_ACTIONS = Object.freeze(['respond', 'decline']);
export const YARD_CHOICE_FORMAT = Object.freeze({
  type: 'object', properties: { action: { type: 'string', enum: YARD_ACTIONS } },
  required: ['action'], additionalProperties: false,
});
const clone = (value) => JSON.parse(JSON.stringify(value));
const stamp = (ms) => new Date(ms).toISOString();
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London',
  year: 'numeric', month: '2-digit', day: '2-digit' });
const londonDate = (value) => dayFormatter.format(new Date(value));
const flushes = new WeakMap();
const callbackReceipts = new WeakMap();
const projectionPending = new WeakSet();
function deliveryId(id, channel) {
  const bytes = createHash('sha256').update(`cy.yard-contact:${id}:${channel}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const castMember = (cast) => CAST.find((item) => item.key === (typeof cast === 'string' ? cast : cast?.key)
  && !['root', 'daemon'].includes(item.key));

export function yardContactState(raw) {
  if (raw == null) return { schema: 'cy.yard-contact-choice', version: 1, encounters: [] };
  if (raw.schema !== 'cy.yard-contact-choice' || raw.version !== 1 || !Array.isArray(raw.encounters)
    || raw.encounters.some((entry) => !entry?.id || !castMember(entry.castKey)
      || !['AVAILABLE', 'OFFERED', 'COMMITTED', 'RESOLVED'].includes(entry.phase)
      || !entry.opening || !Array.isArray(entry.projectedRecordIds)
      || !Array.isArray(entry.pendingEvents) || !Array.isArray(entry.acknowledgedDeliveryIds)
      || (entry.phase === 'RESOLVED' && (!entry.resolution || !entry.resolutionRecord)))) {
    throw new Error('Unrecognised yard-contact checkpoint; refusing to discard decisions');
  }
  return clone(raw);
}

export function yardTurnContext({ nowMs, locationState, asleep, minutes, regimeEpoch, regime } = {}) {
  const location = locationState?.current;
  const exercise = locationState?.activeExerciseEpisode;
  const active = locationState?.activeRegimeEpisode;
  const search = locationState?.searchEpisode;
  const routine = locationState?.activeRoutineEpisode;
  const lockdown = locationState?.lockdownEpisode;
  const restricted = search && (search.status === 'ACTIVE'
    || !['AFTERMATH_OBSERVED', 'COMPLETE'].includes(search.stage));
  const eligible = Number.isFinite(nowMs) && minutes >= 855 && minutes < 915 && !asleep
    && ['auto', 'day'].includes(regime) && location?.id === 'EXERCISE_YARD'
    && location.regime_activity === 'DAILY_EXERCISE'
    && exercise?.status === 'ACTIVE' && !!exercise.id && !!exercise.started_at && !exercise.ended_at
    && active?.status === 'ACTIVE' && active.type === 'DAILY_EXERCISE' && active.id === exercise.id
    && !restricted && !routine && lockdown?.status !== 'ACTIVE';
  return {
    nowMs, eligible: !!eligible, exerciseEpisodeId: exercise?.id || null,
    fence: JSON.stringify([location?.id, location?.entered_at, location?.source_event_id,
      location?.regime_activity, exercise?.id, exercise?.started_at, active?.id,
      search?.id, search?.stage, search?.status, routine?.id, lockdown?.id,
      lockdown?.status, regimeEpoch, regime]),
  };
}

export function qualifiesYardGreeting(cast, variant) {
  return variant === 'conversation' && !!castMember(cast);
}

export function liveYardTurn(entry, context) {
  return !!entry && entry.phase !== 'RESOLVED' && context?.eligible
    && entry.exerciseEpisodeId === context.exerciseEpisodeId && entry.fence === context.fence
    && context.nowMs >= Date.parse(entry.openedAt);
}

function yardRecord(entry, { nowMs, opening = false, action = null, status = 'NO_DECISION' }) {
  const timestamp = stamp(nowMs);
  const executed = status === 'EXECUTED';
  const summary = opening ? `${entry.castName} greeted Cy in the exercise yard`
    : !executed ? `No executed Cy response or deliberate decline is established for ${entry.castName}'s recorded yard greeting`
      : action === 'respond' ? `Cy returned ${entry.castName}'s greeting in the exercise yard`
        : `Cy chose not to answer ${entry.castName}'s greeting in the exercise yard`;
  const id = `env:${entry.id}:${opening ? 'opening' : 'resolution'}`;
  const social = {
    episode_id: `social:${entry.id}:${opening ? 'opening' : 'resolution'}`,
    episode_type: !opening && executed && action === 'respond' ? 'CONTACT' : 'OPPORTUNITY',
    start_at: timestamp, end_at: timestamp,
    linked_event_ids: opening ? [id] : [entry.opening.world_event.id, id],
    actor_id: opening ? entry.castKey : executed ? 'cy:7734' : null,
    actor_label: opening ? entry.castName : executed ? 'Cy' : null,
    target_id: opening ? 'cy:7734' : entry.castKey,
    target_label: opening ? 'Cy' : entry.castName, relationship_ref: entry.castKey,
    counterpart_id: entry.castKey, counterpart_label: entry.castName,
    channel: 'IN_PERSON', contact_form: opening || (executed && action === 'respond') ? 'DIRECT_INTERACTION' : 'UNKNOWN',
    direction: opening ? 'INITIATED_BY_OTHER' : executed ? 'INITIATED_BY_CY' : 'UNKNOWN',
    reciprocity: opening ? 'ONE_WAY' : !executed ? 'UNKNOWN'
      : action === 'respond' ? 'RECIPROCAL' : 'NO_RESPONSE',
    character: 'ORDINARY', resolution: 'COMPLETED', opportunity_id: entry.id,
    opportunity_status: opening ? 'DECISION_PENDING' : executed
      ? action === 'respond' ? 'RESPONDED' : 'DECLINED' : status,
    action_executed: executed ? action : null, decision_action: executed ? action : 'UNKNOWN',
    decision_status: opening ? 'DECISION_PENDING' : status,
  };
  return createEnvironmentRecord(createEnvironmentEvent('social_episode', {
    id, timestamp, eventType: opening ? 'yard_greeting_opening' : 'yard_greeting_resolution', durationMs: 0,
    world: {
      participants: { actor: social.actor_id, target: social.target_id, relationship_ref: entry.castKey },
      social,
      context: { location: 'exercise_yard', description: summary,
        associated_entities: [entry.castKey, 'cy:7734'] },
      temporal: { onset: 'event', persistence: 'completed', recurrence: 'unknown' },
      situation: { resolution_status: 'resolved' },
      action_opportunity: {
        id: entry.id, context_id: entry.exerciseEpisodeId, context_type: 'YARD_GREETING',
        available_actions: YARD_ACTIONS.map((item) => `action:${item}`),
        chosen_action: executed ? `action:${action}` : 'unknown',
        action_actually_executed: executed ? `action:${action}` : 'unknown',
        execution_status: opening ? 'INTENDED' : executed ? 'EXECUTED' : 'UNKNOWN',
        onset_at: entry.openedAt, resolved_at: opening ? null : timestamp,
        resolution_status: opening ? 'UNRESOLVED' : 'RESOLVED',
        linked_event_ids: social.linked_event_ids,
      },
    },
    observation: { modality: 'direct', certainty: 'certain', summary,
      observed_facts: { greeting_actor: entry.castKey,
        ...(executed ? { cy_action: action } : {}) } },
  }));
}

function resolve(entry, { nowMs, action = null, status = 'NO_DECISION', reason = null }) {
  if (entry.phase === 'RESOLVED') return false;
  entry.resolution = {
    id: `resolution:${entry.id}`, action, status,
    executionStatus: status === 'EXECUTED' ? 'EXECUTED' : 'NOT_EXECUTED',
    reason, resolvedAt: stamp(nowMs),
  };
  entry.resolutionRecord = yardRecord(entry, { nowMs, action, status });
  const record = entry.resolutionRecord;
  const executed = status === 'EXECUTED';
  const publicRecord = executed ? record : entry.opening;
  const summary = publicRecord.observation.summary;
  entry.pendingEvents.push(
    { delivery_id: deliveryId(entry.id, 'world'), kind: 'world_event_record', ts: tsNow(new Date(nowMs)),
      yard_opportunity_id: entry.id, payload: clone(record) },
    { delivery_id: deliveryId(entry.id, 'public'), kind: 'event', ts: tsNow(new Date(executed ? nowMs : entry.openedAt)),
      yard_opportunity_id: entry.id, payload: { name: 'yard_interaction', text: summary,
        environment_event_id: publicRecord.world_event.id, exercise_episode_id: entry.exerciseEpisodeId,
        yard_opportunity_id: entry.id } },
  );
  entry.phase = 'RESOLVED';
  return true;
}

export function openYardGreeting(state, { id, cast, context }) {
  if (!context?.eligible || !id || !castMember(cast)) return null;
  const existing = state.encounters.find((entry) => entry.id === id);
  if (existing) return existing;
  for (const previous of state.encounters) {
    resolve(previous, { nowMs: context.nowMs, reason: 'REPLACED_BY_NEW_GREETING' });
  }
  const member = castMember(cast);
  const entry = {
    id, castKey: member.key, castName: member.name, exerciseEpisodeId: context.exerciseEpisodeId,
    fence: context.fence, openedAt: stamp(context.nowMs), phase: 'AVAILABLE', offeredAt: null,
    decision: null, resolution: null, opening: null, resolutionRecord: null,
    projectedRecordIds: [], pendingEvents: [], acknowledgedDeliveryIds: [],
  };
  entry.opening = yardRecord(entry, { nowMs: context.nowMs, opening: true });
  entry.pendingEvents.push({ delivery_id: deliveryId(entry.id, 'opening'), kind: 'world_event_record',
    ts: tsNow(new Date(context.nowMs)), yard_opportunity_id: entry.id, payload: clone(entry.opening) });
  state.encounters.push(entry);
  // Preserve today's identities, unresolved work and unacknowledged delivery.
  // Only fully projected and acknowledged older receipts can leave the lane.
  const today = londonDate(context.nowMs);
  const older = state.encounters.filter((item) => item.phase === 'RESOLVED' && londonDate(item.openedAt) !== today);
  const retained = new Set(older.slice(-56).map((item) => item.id));
  state.encounters = state.encounters.filter((item) => item.phase !== 'RESOLVED'
    || londonDate(item.openedAt) === today || retained.has(item.id)
    || item.pendingEvents.length || item.acknowledgedDeliveryIds.length !== 3
    || ![item.opening, item.resolutionRecord].every((record) => item.projectedRecordIds.includes(record.world_event.id)));
  return entry;
}

export function yardChoiceCall(entry, { bodily = '', recent = '', grounding = '' } = {}) {
  const bounded = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
  return {
    system: [CHARACTER_KNOWLEDGE_TEXT,
      'Choose your response to this actual greeting. Return only the JSON choice, with no explanation or story.',
      'A response returns the greeting only. No further dialogue or reaction by the other inmate is established.',
    ].join('\n'),
    prompt: JSON.stringify({
      event: `${entry.castName} greeted you in the exercise yard.`,
      person: { standing_description_not_episode_evidence: castMember(entry.castKey).blurb },
      body: bounded(bodily, 1200), recent: bounded(recent, 1600), grounding: bounded(grounding, 1200),
      choices: { respond: 'Return the greeting.', decline: 'Do not answer the greeting.' },
    }),
    format: YARD_CHOICE_FORMAT,
  };
}

export function parseYardChoice(raw) {
  try {
    const value = JSON.parse(raw);
    return value && !Array.isArray(value) && Object.keys(value).length === 1
      && YARD_ACTIONS.includes(value.action) ? value.action : null;
  } catch { return null; }
}

export function expireYardTurns(state, context) {
  let changed = false;
  for (const entry of state.encounters) {
    if (entry.phase !== 'RESOLVED' && !liveYardTurn(entry, context)) {
      changed = resolve(entry, { nowMs: context.nowMs, reason: 'GREETING_NO_LONGER_LIVE' }) || changed;
    }
  }
  return changed;
}

export function recoverYardTurns(state, { nowMs = Date.now() } = {}) {
  let changed = false;
  for (const entry of state.encounters) {
    changed = resolve(entry, { nowMs, reason: 'RESTART_WITHOUT_RESOLVED_TURN' }) || changed;
  }
  return changed;
}

export async function decideYardTurn(state, entry, {
  readContext, checkpoint, generate, isAdmitted = () => true, signal = null,
  diagnostic = () => {}, characterContext = {},
}) {
  if (!state.encounters.includes(entry) || entry.phase !== 'AVAILABLE') return false;
  const fail = async (reason) => {
    resolve(entry, { nowMs: readContext().nowMs, reason });
    diagnostic('no_valid_decision', entry, reason);
    await checkpoint();
    return false;
  };
  const permitted = () => !signal?.aborted && isAdmitted() && liveYardTurn(entry, readContext());
  if (!permitted()) return fail('STALE_BEFORE_OFFER');
  entry.phase = 'OFFERED';
  entry.offeredAt = stamp(readContext().nowMs);
  await checkpoint();
  diagnostic('choice_offered', entry);
  if (entry.phase !== 'OFFERED') return false;
  if (!permitted()) return fail('STALE_BEFORE_INFERENCE');
  let action = null;
  try { action = parseYardChoice(await generate(yardChoiceCall(entry, characterContext))); }
  catch { /* A failed provider call is never a refusal. */ }
  if (entry.phase !== 'OFFERED') return false;
  if (!permitted()) return fail('STALE_OR_CANCELLED_RESULT');
  if (!action) return fail('NO_VALID_PROVIDER_RESULT');
  entry.decision = { id: `decision:${entry.id}`, encounterId: entry.id, action,
    committedAt: stamp(readContext().nowMs) };
  entry.phase = 'COMMITTED';
  await checkpoint();
  diagnostic('decision_committed', entry);
  if (entry.phase !== 'COMMITTED') return false;
  const executionContext = readContext();
  if (signal?.aborted || !isAdmitted() || !liveYardTurn(entry, executionContext)) return fail('STALE_BEFORE_EXECUTION');
  // This synchronous check and resolution form the historical action fact.
  // Movement during the following IO cannot undo an action already taken.
  resolve(entry, { nowMs: executionContext.nowMs, action, status: 'EXECUTED' });
  await checkpoint();
  diagnostic('turn_resolved', entry);
  return true;
}

export function acknowledgeYardDeliveries(state, events) {
  const ids = new Set(events.map((event) => event.delivery_id));
  let changed = false;
  for (const entry of state.encounters) {
    for (const event of entry.pendingEvents) {
      if (ids.has(event.delivery_id) && !entry.acknowledgedDeliveryIds.includes(event.delivery_id)) {
        entry.acknowledgedDeliveryIds.push(event.delivery_id);
        changed = true;
      }
    }
    entry.pendingEvents = entry.pendingEvents.filter((event) => !ids.has(event.delivery_id));
  }
  return changed;
}

function synchronous(result, label) {
  if (result && typeof result.then === 'function') throw new Error(`${label} must be synchronous`);
}

function recordConsumerReceipt(events, recordId, receipt) {
  for (const event of events) {
    if (event.kind !== 'world_event_record' || event.payload?.world_event?.id !== recordId) continue;
    event.payload = { ...clone(event.payload), ...clone(receipt) };
  }
}

export function flushYardTurns(state, callbacks) {
  const preceding = flushes.get(state) || Promise.resolve();
  const operation = preceding.catch(() => {}).then(async () => {
    const { checkpoint, project, enqueue, remember } = callbacks;
    let runtime = callbackReceipts.get(state);
    if (!runtime) { runtime = { enqueued: new Set(), remembered: new Set() }; callbackReceipts.set(state, runtime); }
    const enqueued = callbacks.enqueued || runtime.enqueued;
    const remembered = callbacks.remembered || runtime.remembered;
    // Freeze every envelope before IO. A concurrently resolved encounter is
    // for the next barrier even if its mutable entry changes during this one.
    const work = projectionPending.has(state) || state.encounters.some((entry) =>
      [entry.opening, entry.resolutionRecord].filter(Boolean)
        .some((record) => !entry.projectedRecordIds.includes(record.world_event.id))
      || entry.pendingEvents.some((event) => !entry.acknowledgedDeliveryIds.includes(event.delivery_id)
        && !enqueued.has(event.delivery_id))
      || (remember && entry.resolutionRecord && !remembered.has(entry.resolutionRecord.world_event.id)));
    if (!work) return;
    const pending = state.encounters.map((entry) => ({ entry, snapshot: clone(entry) }));
    await checkpoint();
    for (const { entry, snapshot } of pending) {
      const records = [snapshot.opening, snapshot.resolutionRecord].filter(Boolean);
      for (const record of records) {
        if (entry.projectedRecordIds.includes(record.world_event.id)) continue;
        const result = project(record, snapshot);
        synchronous(result, 'Yard projection');
        if (result && typeof result === 'object') {
          const receipt = Object.fromEntries([
            'feeding', 'somatic_nociceptive', 'social_contact', 'action_outcome_contingency',
            'current_defensive_context', 'threat_learning', 'consumed_by',
          ].filter((key) => Object.hasOwn(result, key)).map((key) => [key, result[key]]));
          if (Array.isArray(receipt.consumed_by)) {
            receipt.consumed_by = [...new Set(receipt.consumed_by.filter((id) => typeof id === 'string' && id))];
          }
          // Only the outbound copies acquire consumer receipts. Keep the
          // canonical source immutable and checkpoint the exact sent payload.
          recordConsumerReceipt(entry.pendingEvents, record.world_event.id, receipt);
          recordConsumerReceipt(snapshot.pendingEvents, record.world_event.id, receipt);
        }
        entry.projectedRecordIds.push(record.world_event.id);
        projectionPending.add(state);
      }
    }
    // Projection, Soma and its receipt share this checkpoint. No public or
    // source callback may precede it, including when the prior attempt failed.
    await checkpoint();
    projectionPending.delete(state);
    for (const { entry, snapshot } of pending) {
      for (const event of snapshot.pendingEvents) {
        if (entry.acknowledgedDeliveryIds.includes(event.delivery_id) || enqueued.has(event.delivery_id)) continue;
        synchronous(enqueue(clone(event)), 'Yard enqueue');
        enqueued.add(event.delivery_id);
      }
      const record = snapshot.resolutionRecord;
      if (record && remember && !remembered.has(record.world_event.id)) {
        await remember(clone(record), snapshot);
        remembered.add(record.world_event.id);
      }
    }
  });
  flushes.set(state, operation);
  return operation;
}
