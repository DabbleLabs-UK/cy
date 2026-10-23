// Bounded meal decisions. No general action engine and no prose executor.
import { randomUUID } from 'node:crypto';

export const MEAL_ACTIONS = Object.freeze(['eat', 'decline']);
export const MEAL_CHOICE_FORMAT = Object.freeze({
  type: 'object', properties: { action: { type: 'string', enum: MEAL_ACTIONS } },
  required: ['action'], additionalProperties: false,
});
const copy = (value) => JSON.parse(JSON.stringify(value));
const stamp = (now) => new Date(now).toISOString();
const terminal = new Set(['APPLIED', 'NO_DECISION', 'UNAVAILABLE']);

export function mealChoiceState(raw) {
  if (raw == null) return { schema: 'cy.meal-choice', version: 1, episodes: [], pendingEvents: [] };
  if (raw.schema !== 'cy.meal-choice' || raw.version !== 1
    || !Array.isArray(raw.episodes) || !Array.isArray(raw.pendingEvents)) {
    throw new Error('Unrecognised meal-choice checkpoint; refusing to discard decisions');
  }
  return copy(raw);
}

// A live opportunity ends at an existing routine boundary, a location/regime
// change or restriction change. This expires permission to act, NOT the food.
// No arbitrary food-removal time, officer, delivery reason or NPC is inferred.
export function mealContext({ nowMs, date, location, phase, asleep, nextBoundaryAt,
  restricted = false, restrictionIdentity = null } = {}) {
  return {
    nowMs, date, location: location?.id || null, phase, asleep: !!asleep,
    restricted: !!restricted,
    fence: JSON.stringify([date, location?.id, location?.entered_at,
      location?.source_event_id, phase, restrictionIdentity]),
    nextBoundaryAt,
  };
}

export function liveMeal(episode, context) {
  return !!episode && episode.available && context.location === 'CELL'
    && !context.asleep && !context.restricted
    && episode.date === context.date && episode.fence === context.fence
    && context.nowMs >= Date.parse(episode.availableAt)
    && context.nowMs < episode.expiresAt;
}

export function openMeal(state, { id, meal, available, context, availabilityEventId }) {
  const existing = state.episodes.find((item) => item.id === id);
  if (existing) return { episode: existing, created: false };
  const episode = {
    id, meal, date: context.date, available: !!available,
    availableAt: stamp(context.nowMs), expiresAt: context.nextBoundaryAt,
    fence: context.fence, availabilityEventId,
    phase: available ? 'AVAILABLE' : 'UNAVAILABLE',
    offeredAt: null, decision: null, effectEventId: null, failure: null,
  };
  state.episodes.push(episode);
  // Keep unresolved work and all unacknowledged deliveries; prune only older
  // terminal receipt entries. Same-day IDs are never pruned/rerolled.
  state.episodes = state.episodes.filter((item, index, all) =>
    item.date === context.date || !terminal.has(item.phase) || index >= all.length - 56);
  return { episode, created: true };
}

export function mealModelCall(episode, { bodily = '', location = 'cell', regime = '' } = {}) {
  return {
    system: 'You are Cy, inmate 7734, held in HMP ThinkPad. Choose what to do with the food actually present. Return only the JSON choice, with no explanation or story.',
    prompt: JSON.stringify({
      present: `${episode.meal.replaceAll('_', ' ')} is available to you here. No specific ingredients are established.`,
      where: location, current_activity: regime, body: bodily,
      // The schema supplies the response shape; do not add an ordered answer hint.
      choices: { eat: 'Eat the available meal.', decline: 'Do not eat this meal.' },
    }),
    format: MEAL_CHOICE_FORMAT,
  };
}

export function parseMealChoice(text) {
  try {
    const value = JSON.parse(text);
    return value && !Array.isArray(value) && Object.keys(value).length === 1
      && MEAL_ACTIONS.includes(value.action) ? value.action : null;
  } catch { return null; }
}

export function stageMealEvent(state, event) {
  const delivery = { ...event, delivery_id: event.delivery_id || randomUUID() };
  if (!state.pendingEvents.some((item) => item.delivery_id === delivery.delivery_id)) {
    state.pendingEvents.push(delivery);
  }
  return delivery;
}

export function acknowledgeMealEvents(state, events) {
  const ids = new Set(events.map((event) => event.delivery_id));
  const previous = state.pendingEvents.length;
  state.pendingEvents = state.pendingEvents.filter((event) => !ids.has(event.delivery_id));
  return previous !== state.pendingEvents.length;
}

export async function flushMealEvents(state, { checkpoint, enqueue, enqueued }) {
  // Never publish an in-memory intake or decision ahead of its atomic checkpoint.
  // Another timer may append an event while IO is awaited. That later event
  // belongs to a later checkpoint, not this publication barrier.
  const pending = copy(state.pendingEvents);
  await checkpoint();
  for (const event of pending) {
    if (enqueued.has(event.delivery_id)) continue;
    enqueue(event);
    enqueued.add(event.delivery_id);
  }
}

// All effect callbacks must be synchronous: feeding, receipt and outbox are one
// checkpoint snapshot. A failed checkpoint is retried, never re-executed.
export function applyCommittedMeal(episode, { readContext, apply, diagnostic = () => {} }) {
  if (episode.phase === 'APPLIED') {
    diagnostic('duplicate_prevented', episode);
    return false;
  }
  if (episode.phase !== 'COMMITTED') return false;
  if (episode.decision?.mealId !== episode.id || !MEAL_ACTIONS.includes(episode.decision?.action)
    || !episode.effectEventId) return false;
  const context = readContext();
  if (!liveMeal(episode, context)) return false;
  const result = apply(episode, context.nowMs);
  if (result && typeof result.then === 'function') throw new Error('Meal intake application must be synchronous');
  episode.phase = 'APPLIED';
  episode.appliedAt = stamp(context.nowMs);
  diagnostic('effect_applied', episode);
  return true;
}

export function closeMealWithoutDecision(episode, reason, { unknown, diagnostic = () => {} }) {
  if (terminal.has(episode.phase)) return false;
  episode.phase = 'NO_DECISION';
  episode.failure = reason;
  // Still offered/delivered; intake UNKNOWN, not zero/refused/unavailable.
  unknown(episode);
  diagnostic('no_valid_decision', episode, reason);
  return true;
}

export function expireMeals(state, context, callbacks) {
  let changed = false;
  for (const episode of state.episodes) {
    if (terminal.has(episode.phase) || liveMeal(episode, context)) continue;
    changed = closeMealWithoutDecision(episode, 'OPPORTUNITY_NO_LONGER_LIVE', callbacks) || changed;
  }
  return changed;
}

// Startup NEVER resends a possibly offered inference. Only a fully checkpointed
// decision can be recovered; it is still fenced against current world state.
export function recoverMeals(state, callbacks) {
  let changed = false;
  for (const episode of state.episodes) {
    if (terminal.has(episode.phase)) continue;
    callbacks.diagnostic?.('restart_recovery', episode);
    if (episode.phase === 'COMMITTED' && applyCommittedMeal(episode, callbacks)) changed = true;
    else changed = closeMealWithoutDecision(episode, 'RESTART_WITHOUT_APPLICABLE_COMMIT', callbacks) || changed;
  }
  return changed;
}

export async function decideMeal(state, episode, {
  readContext, checkpoint, generate, apply, unknown, diagnostic = () => {},
  characterContext = {}, signal = null,
  isAdmitted = () => true,
}) {
  if (episode.phase !== 'AVAILABLE') {
    diagnostic('duplicate_offer_prevented', episode);
    return false;
  }
  const fail = (reason) => closeMealWithoutDecision(episode, reason, { unknown, diagnostic });
  if (!liveMeal(episode, readContext())) { fail('STALE_BEFORE_OFFER'); await checkpoint(); return false; }
  episode.phase = 'OFFERED';
  episode.offeredAt = stamp(readContext().nowMs);
  episode.offeredActions = [...MEAL_ACTIONS];
  // Offer receipt is committed even if provider admission later fails. A restart
  // cannot create another call for this opportunity.
  await checkpoint();
  diagnostic('choice_offered', episode);
  if (episode.phase !== 'OFFERED') return false;
  if (signal?.aborted || !isAdmitted() || !liveMeal(episode, readContext())) {
    fail('STALE_BEFORE_INFERENCE'); await checkpoint(); return false;
  }
  let action = null;
  try { action = parseMealChoice(await generate(mealModelCall(episode, characterContext))); }
  catch { /* provider failure is not a consumption action */ }
  if (episode.phase !== 'OFFERED') return false;
  if (signal?.aborted || !isAdmitted() || !liveMeal(episode, readContext())) {
    fail('STALE_OR_CANCELLED_RESULT'); await checkpoint(); return false;
  }
  if (!action) { fail('NO_VALID_PROVIDER_RESULT'); await checkpoint(); return false; }
  diagnostic('valid_choice_returned', episode);
  episode.decision = { id: randomUUID(), mealId: episode.id, action, committedAt: stamp(readContext().nowMs) };
  episode.effectEventId = `env-${randomUUID()}`;
  episode.phase = 'COMMITTED';
  await checkpoint();
  diagnostic('decision_committed', episode);
  if (episode.phase !== 'COMMITTED') return false;
  // Clock, sleep, location/restriction and cancellation may change during IO.
  if (signal?.aborted || !isAdmitted() || !applyCommittedMeal(episode, { readContext, apply, diagnostic })) {
    fail('STALE_BEFORE_EFFECT');
    await checkpoint();
    return false;
  }
  await checkpoint();
  return true;
}
