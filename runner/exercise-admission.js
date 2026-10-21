// Fictional exercise-only regime mechanics. No NPC presence or LLM decisions.
import { EXERCISE_REGIME } from './environment.js';

export const EXERCISE_DELAY_CHANCE = 0.22;
export const EXERCISE_DELAY_MINUTES = Object.freeze([15, 20, 25, 40]);

const clone = (value) => JSON.parse(JSON.stringify(value));
const stamp = (ms) => new Date(ms).toISOString();

function admissionEvent(episode, stage, nowMs, location, observed = true) {
  const summaries = {
    WITHHELD: 'Exercise admission was withheld; Cy had not been admitted to the yard',
    PERMITTED: 'The exercise admission hold ended; entry was permitted subject to the current restrictions',
    MISSED: 'The exercise window ended without a recorded yard visit',
  };
  return {
    eventType: `exercise_admission_${stage.toLowerCase()}`,
    summary: summaries[stage], occurredAt: stamp(nowMs), cyObserved: observed,
    world: {
      context: { location: location === 'WING_OR_LANDING' ? 'wing' : location.toLowerCase(), associated_entities: ['cy:7734'] },
      temporal: { onset: 'event', persistence: 'completed', recurrence: 'routine' },
      situation: { agency: 'institution', resolution_status: stage === 'WITHHELD' ? 'unresolved' : 'resolved' },
      exercise_admission: {
        episode_id: episode.id, stage,
        scheduled_start_at: episode.admission.scheduled_start_at,
        scheduled_end_at: episode.admission.scheduled_end_at,
        release_target_at: episode.admission.release_target_at,
        observation_gap: episode.admission.observation_gap,
      },
    },
    observation: {
      modality: observed ? 'direct' : 'none', certainty: observed ? 'certain' : 'unknown',
      observed_facts: observed ? { exercise_episode_id: episode.id, admission_stage: stage } : {},
    },
  };
}

// Called BEFORE location reconciliation, including on the first post-restart
// tick. Times describe fictional regime policy; an expired target is not proof
// that movement, an officer visit or a release announcement happened off-screen.
export function prepareExerciseAdmission(stateValue, {
  nowMs, date, minutes, asleep = false, rnd = Math.random, restart = false,
} = {}) {
  const state = clone(stateValue);
  const events = [];
  let changed = false;
  const inWindow = minutes >= EXERCISE_REGIME.startMinutes && minutes < EXERCISE_REGIME.endMinutes;
  const id = `exercise:${date}`;
  let episode = state.exerciseEpisodes.find((item) => item.id === id);

  for (const previous of state.exerciseEpisodes) {
    const admission = previous.admission;
    if (admission && !admission.window_ended_at && restart
      && admission.last_resume_at !== stamp(nowMs)) {
      state.observationGaps = [...state.observationGaps, {
        started_at: admission.last_observed_at || admission.decision_at,
        detected_at: stamp(nowMs), reason: 'restart during exercise admission',
        resolution: 'preserved release target; no off-screen attendance inferred',
      }].slice(-20);
      admission.observation_gap = true;
      admission.last_resume_at = stamp(nowMs);
      changed = true;
    }
    if (!admission || admission.window_ended_at || nowMs < Date.parse(admission.scheduled_end_at)) continue;
    admission.window_ended_at = stamp(nowMs);
    changed = true;
    if (!previous.started_at) {
      previous.status = 'MISSED';
      previous.ended_at = stamp(nowMs);
      // Only claim no *recorded* attendance. A restart spanning the window does
      // not establish what Cy experienced throughout that unobserved interval.
      if (restart) admission.observation_gap = true;
      events.push(admissionEvent(previous, 'MISSED', nowMs, state.current.id,
        !asleep && !admission.observation_gap));
    }
  }

  if (!episode && inWindow) {
    const minuteStart = nowMs - ((nowMs % 60_000 + 60_000) % 60_000);
    const start = minuteStart + (EXERCISE_REGIME.startMinutes - minutes) * 60_000;
    const end = start + EXERCISE_REGIME.durationMinutes * 60_000;
    const delayed = rnd() < EXERCISE_DELAY_CHANCE;
    const delay = delayed
      ? EXERCISE_DELAY_MINUTES[Math.min(EXERCISE_DELAY_MINUTES.length - 1, Math.floor(rnd() * EXERCISE_DELAY_MINUTES.length))]
      : 0;
    episode = {
      id, type: 'DAILY_EXERCISE', date, status: 'PENDING',
      started_at: null, ended_at: null, event_ids: [], interaction_count: 0,
      admission: {
        decision_at: stamp(nowMs), delay_minutes: delay,
        scheduled_start_at: stamp(start), scheduled_end_at: stamp(end),
        // A late first observation cannot invent a hold starting in downtime.
        release_target_at: stamp(delayed ? nowMs + delay * 60_000 : nowMs),
        withheld_at: delayed ? stamp(nowMs) : null, permitted_at: null,
        window_ended_at: null, observation_gap: restart || minutes > EXERCISE_REGIME.startMinutes,
      },
    };
    state.exerciseEpisodes = [...state.exerciseEpisodes, episode].slice(-14);
    changed = true;
    if (delayed) events.push(admissionEvent(episode, 'WITHHELD', nowMs, state.current.id,
      !asleep && state.current.id === 'CELL' && state.lockdownEpisode?.status !== 'ACTIVE'));
  }
  // Old already-recorded attendance is not retroactively given a new decision.
  // Legacy completed episodes are likewise never rerolled or rewritten.
  if (episode?.admission && !episode.admission.window_ended_at) {
    const admission = episode.admission;
    if (!admission.permitted_at && nowMs >= Date.parse(admission.release_target_at)
      && nowMs < Date.parse(admission.scheduled_end_at)) {
      admission.permitted_at = stamp(nowMs);
      changed = true;
      // Permission is institutional state, not a heard announcement or proof
      // of an escort. Actual movement supplies Cy's observable fact separately.
      if (admission.delay_minutes) events.push(admissionEvent(episode, 'PERMITTED', nowMs,
        state.current.id, false));
    }
    admission.last_observed_at = stamp(nowMs);
  }
  return { state, events, changed };
}

export function exerciseAdmissionAllows(state, date, nowMs) {
  const episode = state.exerciseEpisodes?.find((item) => item.id === `exercise:${date}`);
  if (!episode?.admission) return true; // legacy callers/episodes retain their semantics
  const admission = episode.admission;
  return !admission.window_ended_at && admission.permitted_at != null
    && nowMs >= Date.parse(admission.release_target_at)
    && nowMs < Date.parse(admission.scheduled_end_at);
}

// This is an outbox on the existing location checkpoint, not a second event or
// incident ledger. The existing server ingest receipts deduplicate deliveries.
export function stageExerciseDelivery(state, event) {
  const pending = state.pendingExerciseEvents || [];
  if (!pending.some((item) => item.delivery_id === event.delivery_id)) pending.push(event);
  state.pendingExerciseEvents = pending;
}

export async function persistExerciseDeliveries(state, checkpoint, enqueue, enqueued = new Set()) {
  await checkpoint();
  for (const event of state.pendingExerciseEvents || []) {
    if (enqueued.has(event.delivery_id)) continue;
    enqueue(event);
    enqueued.add(event.delivery_id);
  }
}

export function acknowledgeExerciseDeliveries(state, events) {
  const delivered = new Set(events.map((event) => event.delivery_id));
  const pending = state?.pendingExerciseEvents || [];
  const remaining = pending.filter((event) => !delivered.has(event.delivery_id));
  if (remaining.length === pending.length) return false;
  state.pendingExerciseEvents = remaining;
  return true;
}
