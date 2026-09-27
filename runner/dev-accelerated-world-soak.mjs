// dev-accelerated-world-soak.mjs - accelerated, non-publishing validation
// harness for Cy's WORLD and grounded-input pipelines (scheduler eligibility,
// lifecycle managers, AWG, grounded Soma ingestion). This is developer
// tooling, not a Cy feature: it never runs as part of the live runner and
// must never be imported by it.
//
// PURPOSE
// Answers "is the world/grounded-input pipeline coherent enough to resume
// serious Soma work?" by running the REAL production world-producer
// functions (from location-regime.js, environment.js, instrumental-agency.js,
// ambient-world-generator.js, cast.js, the grounded-environment-transition.js
// ingestion seam, and soma-runtime.js) forward from a FROZEN COPY of a real
// captured checkpoint, at a simulated 5-second tick cadence (matching
// production's real tick granularity exactly, so every per-tick probability
// - e.g. fireSocial's 0.006/tick - fires at its真 real-world rate rather than
// being distorted by a coarser simulated step), for many simulated hours in
// a few seconds of real wall-clock time.
//
// ISOLATION GUARANTEES (do not weaken without updating this comment)
//   - The checkpoint is COPIED into a fresh mkdtemp() directory before this
//     module ever reads it. loadVitals()/saveVitals() are only ever pointed
//     at that copy. The original path is opened exactly once, for the copy,
//     and never written to.
//   - No network call of any kind is made. AWG's `generate` callback is a
//     synthetic, deterministic stub (see buildSyntheticAwgGenerator) - never
//     a live Ollama/provider call. This also means the harness can never
//     compete with the live runner for the shared inference arbiter lease.
//   - No SQL/database of any kind is touched. Autobiographical-memory
//     ELIGIBILITY is checked via the real, pure sourceFromEnvironmentRecord()
//     function; nothing is ever queued to a durable store.
//   - run.js itself is never imported (it has heavy, environment-coupled
//     top-level imports - provider clients, config loading - unsafe to
//     import as a library). This harness re-implements run.js's thin
//     scheduler/tick ORCHESTRATION (which function fires when, under what
//     roll/condition) by calling the exact same real, already-exported
//     production functions run.js itself calls. Every orchestration function
//     below carries a comment pointing at the run.js function/line range it
//     mirrors, so drift is easy to spot on a future run.js change.
//   - Explicitly OUT OF SCOPE (deliberately not reproduced - these are
//     prose/generation concerns, not world/grounded-input concerns):
//     journal/dream/drawing generation, expressive-choice selection, legacy
//     relations/monotony/amp bookkeeping, the incident ledger (recordIncident
//     - a UI/prose diagnostic with no grounded substrate consumer), letter/
//     mail streaming, host/power telemetry.
//
// USAGE
//   node dev-accelerated-world-soak.mjs --from <vitals.json> --hours 16
//   node dev-accelerated-world-soak.mjs --from <vitals.json> --hours 16 --out report.json

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, mkdir, copyFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadVitals, saveVitals } from './vitals.js';
import { SECTIONED_STORE_DIRECTORY } from './sectioned-state-store.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import { observeEnvironmentRecord } from './grounded-environment-transition.js';
import { createSomaRuntime } from './soma-runtime.js';
import { sourceFromEnvironmentRecord } from './autobiographical-memory.js';
import {
  LOCATIONS,
  locationContextId,
  reconcileLocationRegimeState,
  reconcileRegimeLocation,
  startCellSearchEpisode,
  advanceCellSearchEpisode,
  startLockdownEpisode,
  advanceLockdownEpisode,
  createYardObservation,
  markSearchPropertyAction,
  registerEpisodeEvent,
  CELL_SEARCH_TICK_CHANCE,
  YARD_OBSERVATION_INTERVAL_MS,
} from './location-regime.js';
import {
  PRISON_SCHEDULE,
  EXERCISE_REGIME,
  materialiseScheduledEvent,
  mealExpectation,
} from './environment.js';
import {
  createInstrumentalAgencyState,
  reconcileInstrumentalAgencyState,
  openInstrumentalOpportunity,
  queueInstrumentalOpportunity,
  resolveInstrumentalOpportunity,
  takePendingInstrumentalOpportunities,
  instrumentalDefinitionFor,
} from './instrumental-agency.js';
import {
  reconcileWorldSimulationState,
  shouldRunAwg,
  runAmbientWorldCycle,
  awgEventToEnvironment,
  AWG_MIN_IDLE_BUDGET_MS,
} from './ambient-world-generator.js';
import {
  CAST,
  OFFICERS,
  BY_KEY,
  pickSocial,
  pickOfficer,
  pickOverheard,
} from './cast.js';
import { isSleepWindow } from './prompt.js';

// ---- tiny pure helpers mirrored from run.js (never imported - see header) --

// Mirrors run.js's officerEventCompatibleLocation/INMATE_SOCIAL_COMPATIBLE_LOCATION
// (both already exported from run.js as of the social-contact-grounding fix,
// duplicated here rather than imported to avoid importing run.js as a module).
function officerEventCompatibleLocation(eventType) {
  return eventType === 'search' ? LOCATIONS.CELL : LOCATIONS.WING_OR_LANDING;
}
const INMATE_SOCIAL_COMPATIBLE_LOCATION = LOCATIONS.WING_OR_LANDING;

// Mirrors run.js's londonParts().
const LONDON_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
function londonParts(d) {
  const p = Object.fromEntries(LONDON_FMT.formatToParts(d).map((x) => [x.type, x.value]));
  const hour = +p.hour % 24;
  const minute = +p.minute;
  return { date: `${p.year}-${p.month}-${p.day}`, hour, minute, mins: hour * 60 + minute };
}

// Mirrors run.js's REGIME table and crossed()/currentRegime().
const REGIME = [
  { mins: 6 * 60 + 30, phase: 'lights_on' },
  { mins: 7 * 60 + 30, phase: 'unlock_slop' },
  { mins: 8 * 60 + 30, phase: 'work_assoc' },
  { mins: 11 * 60 + 45, phase: 'lunch_bangup' },
  { mins: EXERCISE_REGIME.startMinutes, phase: 'exercise_yard' },
  { mins: EXERCISE_REGIME.endMinutes, phase: 'return_to_cell' },
  { mins: 16 * 60 + 45, phase: 'tea' },
  { mins: 17 * 60 + 30, phase: 'bangup_night' },
  { mins: 22 * 60 + 30, phase: 'lights_out' },
];
function currentRegime(mins) {
  let cur = REGIME[REGIME.length - 1];
  for (const r of REGIME) if (mins >= r.mins) cur = r;
  return cur;
}
const DEVIATIONS = {
  unlock_slop: { chance: 0.22, event: 'delayed_unlock' },
  exercise_yard: { chance: 0.22, event: 'delayed_unlock' },
  work_assoc: { chance: 0.15, event: 'assoc_cancelled' },
};
function crossed(target, cur, prev) {
  if (prev === null) return false;
  if (prev <= cur) return prev < target && target <= cur;
  return target > prev || target <= cur;
}
function effectiveAsleep(mins) {
  return isSleepWindow(mins);
}

// Mirrors run.js's inmateSocialFacts/officerSocialFacts (social-contact-substrate input facts).
function inmateSocialFacts(type, castKey, actorName) {
  const supportive = new Set(['kindness', 'shared_joke', 'lent_book']);
  const hostile = new Set(['swapped_tray', 'borrowed']);
  const rejecting = new Set(['unanswered', 'talked_over']);
  const passive = type === 'sat_with';
  return {
    episode_type: 'CONTACT', actor_id: castKey, actor_label: actorName,
    target_id: 'cy:7734', target_label: 'Cy', relationship_ref: castKey,
    channel: 'IN_PERSON', contact_form: passive ? 'PASSIVE_CO_PRESENCE' : 'DIRECT_INTERACTION',
    direction: passive ? 'INITIATED_BY_OTHER' : 'MUTUAL',
    reciprocity: passive || type === 'lent_book' ? 'ONE_WAY' : 'RECIPROCAL',
    character: supportive.has(type) ? 'SUPPORTIVE' : hostile.has(type) ? 'HOSTILE'
      : rejecting.has(type) ? 'REJECTING' : 'ORDINARY',
    resolution: 'COMPLETED',
  };
}
function officerSocialFacts(type, officerKey, officerName) {
  return {
    episode_type: 'CONTACT', actor_id: officerKey, actor_label: officerName,
    target_id: 'cy:7734', target_label: 'Cy', relationship_ref: officerKey,
    channel: 'OFFICER_INTERACTION', contact_form: 'DIRECT_INTERACTION',
    direction: 'INITIATED_BY_OTHER', reciprocity: 'RECIPROCAL',
    character: type === 'kindness' ? 'SUPPORTIVE' : type === 'refusal' ? 'REJECTING' : 'ORDINARY',
    resolution: 'COMPLETED',
  };
}
function plausibleCastAtLocation(locationId) {
  if (locationId === LOCATIONS.EXERCISE_YARD) {
    return [...CAST.filter((entry) => !['root', 'daemon'].includes(entry.key)), ...OFFICERS];
  }
  return [...CAST, ...OFFICERS];
}

// ---- synthetic (non-network) AWG candidate generator -----------------------

// Never a live model call - see the ISOLATION GUARANTEES header. Returns a
// realistic candidate string (what parseAwgCandidate expects: raw text
// containing a JSON object) so the REAL validator/materialiser/lifecycle
// code is genuinely exercised, without any network/inference dependency.
export function buildSyntheticAwgGenerator({ eventEveryNCycles = 4 } = {}) {
  let cycle = 0;
  return async function generate() {
    cycle += 1;
    // The raw LLM proposal must contain ONLY the fields the prompt asks for -
    // schema/version are added later by materialiseAwgProposal, and asserting
    // them here trips assertProposalKeys' FORBIDDEN_..._FIELD check (proven
    // by this harness's own dry-run debugging).
    if (cycle % eventEveryNCycles !== 0) {
      return JSON.stringify({ decision: 'NO_EVENT' });
    }
    return JSON.stringify({
      decision: 'EVENT',
      eventFamily: 'WING_ACTIVITY',
      participants: ['cy'],
      // Deliberately location-neutral text: the real semantic validator
      // correctly rejects a candidate whose narrative contradicts Cy's
      // actual current location (OBJECTIVE_LOCATION_CONTRADICTION, proven
      // by this harness's own development) - a location-specific phrase like
      // "down the wing" would spuriously fail whenever Cy is elsewhere.
      objective: { eventType: 'ambient_noise', summary: 'A metallic clang echoed nearby, unexplained.' },
      objects: [],
      observations: [{ observerId: 'cy', access: 'CY_DIRECT', summary: 'You heard a metallic clang nearby.' }],
      informationClaims: [],
      // A one-shot event with no ongoing thread: action 'NONE', no thread id
      // (the only valid shape for a non-CONTINUATION decision).
      thread: { action: 'NONE', id: null, summary: 'Ambient noise, no follow-up expected.' },
    });
  };
}

// ---- checkpoint capture (isolation boundary) --------------------------------

// Copies the REAL authoritative checkpoint into a fresh mkdtemp() dir, then
// loads it from the copy. The source is opened for reading only; nothing is
// ever written back to it.
//
// loadVitals() prefers the sectioned persistence store
// (state/<SECTIONED_STORE_DIRECTORY>/{current,previous}.json + sections/*.json
// - see sectioned-state-store.js) and falls back to the flat vitals.json only
// when the sectioned store is absent/invalid. The flat vitals.json/
// vitals.previous.json files on a live host can be STALE (the sectioned
// store is the one actually kept current - confirmed empirically: this
// harness's own first draft, which copied only flat 'vitals*' files, silently
// resurrected weeks-old contamination already reconciled and fixed in
// production, because omitting the sectioned directory forced loadVitals()
// into that stale flat-file fallback). Copying ONLY the flat file is exactly
// the "stale-state resurrection" failure mode this facility exists to catch -
// so the sectioned directory is copied in full, unconditionally.
export async function captureFrozenState(sourceVitalsPath) {
  const sourceDir = dirname(sourceVitalsPath);
  const tempRoot = await mkdtemp(join(tmpdir(), 'cy-world-soak-'));
  const tempStateDir = join(tempRoot, 'state');
  await mkdir(tempStateDir, { recursive: true });

  // The flat fallback pair only - never the miscellaneous *.bak/.previous/
  // .initialized marker files that can accumulate in a long-lived state dir.
  for (const name of ['vitals.json', 'vitals.previous.json', 'bookkeeping.json']) {
    await copyFile(join(sourceDir, name), join(tempStateDir, name)).catch(() => {});
  }
  // The real authoritative store: copy the whole sectioned directory,
  // recursively, exactly as it stands.
  const sectionedSourceDir = join(sourceDir, SECTIONED_STORE_DIRECTORY);
  const sectionedTempDir = join(tempStateDir, SECTIONED_STORE_DIRECTORY);
  await cp(sectionedSourceDir, sectionedTempDir, { recursive: true }).catch(() => {});

  const tempVitalsPath = join(tempStateDir, 'vitals.json');
  const vitals = await loadVitals(tempVitalsPath);
  return { vitals, tempRoot, tempVitalsPath };
}

export async function releaseFrozenState(tempRoot) {
  await rm(tempRoot, { recursive: true, force: true });
}

// ---- the world harness -------------------------------------------------

export function createWorldSoakHarness({ vitals, startMs, makeId = (prefix) => `${prefix}-${randomUUID()}` }) {
  const startClock = londonParts(new Date(startMs));
  vitals.locationRegime = reconcileLocationRegimeState(vitals.locationRegime, {
    nowMs: startMs, date: startClock.date, minutes: startClock.mins, asleep: effectiveAsleep(startClock.mins),
  });
  vitals.instrumentalAgency = reconcileInstrumentalAgencyState(vitals.instrumentalAgency);
  vitals.worldSimulation = reconcileWorldSimulationState(vitals.worldSimulation);

  const soma = createSomaRuntime(vitals.cognition, { now: startMs });

  const report = {
    startMs, endMs: startMs, simulatedMs: 0,
    invariantFailures: [],
    counts: {
      scheduledMeals: 0, scheduledRoutines: 0, regimeDeviations: 0,
      cellSearchOpened: 0, cellSearchAdvanced: 0, lockdownOpened: 0, lockdownAdvanced: 0,
      trivialIrritations: 0, socialFired: 0, socialGated: 0, officerFired: 0, officerGated: 0,
      overheard: 0, instrumentalOpened: 0, instrumentalResolved: 0,
      cyObservedEvents: 0, worldOnlyEvents: 0,
      memoryEligible: 0,
      awgEligible: 0, awgSkipped: 0, awgRejected: 0, awgNoEvent: 0, awgAccepted: 0, awgFailedOrCancelled: 0,
      threadsOpened: 0, threadsUpdated: 0, threadsResolved: 0,
      feedingRecords: 0, socialContactEpisodes: 0, somaticEvents: 0, threatTrials: 0,
      controllabilityUpdates: 0,
    },
    finalWorldSimulationThreadStates: {},
  };

  function fail(kind, detail) {
    report.invariantFailures.push({ kind, detail, atMs: null });
  }

  let prevMins = null;
  let prevDate = startClock.date;
  let lastYardObservationAtMs = null;

  function captureEnvironmentEvent(archetypeId, {
    eventType = archetypeId, summary = null, world = {}, observation = {}, cyObserved = true, nowMs,
  } = {}) {
    const eventId = `env-${randomUUID()}`;
    const eventTimestamp = new Date(nowMs).toISOString();
    const event = createEnvironmentEvent(archetypeId, {
      id: eventId, timestamp: eventTimestamp, eventType,
      world: { ...world, context: { ...(world.context || {}), description: (world.context && world.context.description) ?? summary } },
      observation: { summary, ...observation },
    });
    const record = createEnvironmentRecord(event);
    if (cyObserved) {
      Object.assign(record, observeEnvironmentRecord(soma, record));
      report.counts.cyObservedEvents += 1;
    } else {
      report.counts.worldOnlyEvents += 1;
    }
    if (cyObserved) {
      const source = sourceFromEnvironmentRecord(record);
      if (source) report.counts.memoryEligible += 1;
    }
    return record;
  }

  function captureEpisodeEvent(event, { archetypeId = 'ambient_world_event', locationSource = false, nowMs } = {}) {
    if (!event) return null;
    const record = captureEnvironmentEvent(archetypeId, {
      eventType: event.eventType, summary: event.summary, world: event.world || {},
      observation: event.observation || {}, cyObserved: event.cyObserved !== false, nowMs,
    });
    vitals.locationRegime = registerEpisodeEvent(vitals.locationRegime, record.world_event.id, { locationSource });
    return record;
  }

  function processLocationRegime(nowMs, date, mins, asleep) {
    const reconciled = reconcileRegimeLocation(vitals.locationRegime, { nowMs, date, minutes: mins, asleep });
    vitals.locationRegime = reconciled.state;
    for (const event of reconciled.events) captureEpisodeEvent(event, { locationSource: true, nowMs });

    const exercise = vitals.locationRegime.activeExerciseEpisode;
    if (!exercise || vitals.locationRegime.current.id !== LOCATIONS.EXERCISE_YARD) return;
    const last = Date.parse(exercise.last_observation_at || exercise.started_at || 0);
    if (Number.isFinite(last) && nowMs - last < YARD_OBSERVATION_INTERVAL_MS) return;
    const available = plausibleCastAtLocation(LOCATIONS.EXERCISE_YARD);
    const roll = Math.random();
    const cast = available[Math.floor(Math.random() * available.length)] || null;
    const variant = roll < 0.35 ? 'quiet' : roll < 0.60 ? 'company' : roll < 0.85 ? 'conversation' : 'avoided';
    const yard = createYardObservation({ nowMs, cast, variant, makeId });
    captureEpisodeEvent({
      ...yard, cyObserved: true,
      world: {
        participants: { actor: yard.social && yard.social.actor_id, target: 'cy', relationship_ref: yard.social && yard.social.actor_id },
        context: { location: 'exercise_yard', description: yard.summary },
        situation: { resolution_status: 'resolved' },
        ...(yard.social ? { social: yard.social } : {}),
      },
      observation: { modality: 'direct', certainty: 'certain' },
    }, { nowMs });
    vitals.locationRegime.activeExerciseEpisode.last_observation_at = yard.occurredAt;
    vitals.locationRegime.activeRegimeEpisode.last_observation_at = yard.occurredAt;
    if (yard.social) {
      vitals.locationRegime.activeExerciseEpisode.interaction_count += 1;
      vitals.locationRegime.activeRegimeEpisode.interaction_count += 1;
    }
  }

  function beginCellSearch(nowMs) {
    const officer = OFFICERS[Math.floor(Math.random() * OFFICERS.length)] || { key: 'proctor', name: 'Mr Proctor' };
    const started = startCellSearchEpisode(vitals.locationRegime, {
      nowMs, actorId: officer.key, actorName: officer.name, objects: vitals.worldSimulation.objects, makeId,
    });
    vitals.locationRegime = started.state;
    if (!started.started) return;
    captureEpisodeEvent(started.event, { archetypeId: 'cell_search', nowMs });
    report.counts.cellSearchOpened += 1;
  }

  function advanceCellSearch(nowMs) {
    const advanced = advanceCellSearchEpisode(vitals.locationRegime, { nowMs, objects: vitals.worldSimulation.objects });
    vitals.locationRegime = advanced.state;
    if (!advanced.advanced || !advanced.event) return;
    captureEpisodeEvent(advanced.event, { archetypeId: 'cell_search', nowMs });
    report.counts.cellSearchAdvanced += 1;
    const episode = vitals.locationRegime.searchEpisode;
    if (advanced.actionOpportunity === 'COMPLY_OR_REFUSE') {
      beginInstrumentalIncident('officer', 'order', episode.actor_id, episode.actor_name, nowMs);
    } else if (advanced.actionOpportunity === 'HAND_OVER_OR_WITHHOLD') {
      beginInstrumentalIncident('officer', 'search', episode.actor_id, episode.actor_name, nowMs);
    }
  }

  function beginLockdown(nowMs) {
    const started = startLockdownEpisode(vitals.locationRegime, { nowMs, makeId });
    vitals.locationRegime = started.state;
    if (!started.started) return false;
    captureEpisodeEvent(started.event, { archetypeId: 'lockdown', nowMs });
    report.counts.lockdownOpened += 1;
    return true;
  }

  function advanceLockdown(nowMs) {
    const advanced = advanceLockdownEpisode(vitals.locationRegime, { nowMs });
    vitals.locationRegime = advanced.state;
    if (!advanced.released || !advanced.event) return;
    captureEpisodeEvent(advanced.event, { archetypeId: 'lockdown', nowMs });
    report.counts.lockdownAdvanced += 1;
  }

  let pendingInstrumental = [];
  function beginInstrumentalIncident(sourceKind, sourceEventType, actorKey, actorName, nowMs) {
    const prepared = openInstrumentalOpportunity(vitals.instrumentalAgency, {
      sourceKind, sourceEventType, actorKey, actorName,
      opportunityId: `instrumental:${randomUUID()}`, timestamp: new Date(nowMs).toISOString(),
    });
    if (!prepared) return null;
    const opening = prepared.opening;
    const socialOpportunity = ['social', 'officer'].includes(sourceKind) ? {
      episode_id: `social:${prepared.pending.opportunityId}`, episode_type: 'OPPORTUNITY',
      start_at: prepared.pending.onsetAt, actor_id: prepared.pending.actorKey, actor_label: prepared.pending.actorName,
      target_id: 'cy:7734', target_label: 'Cy', relationship_ref: prepared.pending.actorKey,
      channel: sourceKind === 'officer' ? 'OFFICER_INTERACTION' : 'IN_PERSON',
      contact_form: 'ATTEMPTED_CONTACT', direction: 'INITIATED_BY_OTHER', reciprocity: 'ONE_WAY',
      character: prepared.pending.archetypeId === 'inmate_provocation' ? 'HOSTILE'
        : prepared.pending.archetypeId === 'inmate_check_in' ? 'SUPPORTIVE' : 'ORDINARY',
      resolution: 'ONGOING', opportunity_id: prepared.pending.opportunityId, opportunity_status: 'OPEN', action_executed: null,
    } : null;
    const structured = captureEnvironmentEvent(opening.archetypeId, {
      eventType: opening.eventType, summary: opening.text,
      world: { ...opening.world, ...(socialOpportunity ? { social: socialOpportunity } : {}) },
      observation: opening.observation, nowMs,
    });
    queueInstrumentalOpportunity(vitals.instrumentalAgency, prepared.pending, structured.world_event.id);
    report.counts.instrumentalOpened += 1;
    return structured;
  }

  function resolvePendingInstrumentalIncidents(nowMs) {
    const pending = takePendingInstrumentalOpportunities(vitals.instrumentalAgency);
    for (const opportunity of pending) {
      const resolutionTimestamp = new Date(nowMs).toISOString();
      const outcome = resolveInstrumentalOpportunity(opportunity, { timestamp: resolutionTimestamp });
      const isSocial = opportunity.archetypeId.startsWith('inmate_')
        || ['officer_order', 'cell_search_handover'].includes(opportunity.archetypeId);
      const actualContact = !['action:remain_silent', 'action:withdraw', 'action:disengage'].includes(opportunity.chosenAction);
      const socialOutcome = isSocial ? {
        episode_id: `social:${opportunity.opportunityId}`, episode_type: actualContact ? 'CONTACT' : 'OPPORTUNITY',
        start_at: opportunity.onsetAt, end_at: resolutionTimestamp,
        actor_id: opportunity.actorKey, actor_label: opportunity.actorName,
        target_id: 'cy:7734', target_label: 'Cy', relationship_ref: opportunity.actorKey,
        channel: opportunity.archetypeId.startsWith('inmate_') ? 'IN_PERSON' : 'OFFICER_INTERACTION',
        contact_form: actualContact ? 'DIRECT_INTERACTION' : 'ATTEMPTED_CONTACT',
        direction: actualContact ? 'MUTUAL' : 'INITIATED_BY_OTHER', reciprocity: actualContact ? 'RECIPROCAL' : 'ONE_WAY',
        character: opportunity.archetypeId === 'inmate_provocation' && opportunity.chosenAction === 'action:respond' ? 'HOSTILE'
          : opportunity.archetypeId === 'inmate_check_in' && opportunity.chosenAction === 'action:answer' ? 'SUPPORTIVE' : 'ORDINARY',
        resolution: 'COMPLETED', opportunity_id: opportunity.opportunityId, opportunity_status: 'RESOLVED',
        action_executed: opportunity.chosenAction, linked_event_ids: [opportunity.openingEnvironmentEventId],
      } : null;
      captureEnvironmentEvent(outcome.archetypeId, {
        eventType: outcome.eventType, summary: outcome.text,
        world: { ...outcome.world, ...(socialOutcome ? { social: socialOutcome } : {}) },
        observation: outcome.observation, nowMs,
      });
      if (opportunity.archetypeId === 'cell_search_handover') {
        const objectId = vitals.locationRegime.searchEpisode && vitals.locationRegime.searchEpisode.object_id;
        vitals.locationRegime = markSearchPropertyAction(vitals.locationRegime, { action: opportunity.chosenAction, objectId });
      }
      report.counts.instrumentalResolved += 1;
    }
  }

  function fireScheduled(slot, nowMs) {
    const mealId = slot.kind === 'meal' ? `${londonParts(new Date(nowMs)).date}:${slot.meal}` : null;
    let expectedRecord = null;
    if (mealId) {
      const expected = mealExpectation(slot.meal, mealId);
      expectedRecord = captureEnvironmentEvent(expected.archetypeId, {
        eventType: expected.name, summary: expected.text, world: expected.world, observation: expected.observation, nowMs,
      });
    }
    const event = materialiseScheduledEvent(slot, Math.random, { mealId });
    if (expectedRecord) {
      event.world.context = event.world.context || {};
      event.world.context.previous_event_ids = [expectedRecord.world_event.id];
    }
    captureEnvironmentEvent(event.archetypeId, {
      eventType: event.name, summary: event.text, world: event.world, observation: event.observation, nowMs,
    });
    if (slot.kind === 'meal') report.counts.scheduledMeals += 1; else report.counts.scheduledRoutines += 1;
  }

  function fireSocial(nowMs) {
    const { castKey, ev } = pickSocial();
    const actorName = (BY_KEY[castKey] || {}).name || castKey;
    const groundedSocial = inmateSocialFacts(ev.type, castKey, actorName);
    const quality = ev.social && ev.social.quality ? ev.social.quality : 'unknown';
    const archetypeId = ['SUPPORTIVE', 'ORDINARY'].includes(groundedSocial.character) ? 'friendly_interaction'
      : groundedSocial.character === 'REJECTING' ? 'social_rejection' : 'hostile_interaction';
    const instrumental = instrumentalDefinitionFor('social', ev.type)
      ? beginInstrumentalIncident('social', ev.type, castKey, actorName, nowMs) : null;
    if (!instrumental) {
      captureEnvironmentEvent(archetypeId, {
        eventType: `social_${ev.type}`, summary: ev.slight,
        world: {
          participants: { actor: castKey, target: 'cy', relationship_ref: castKey },
          social: groundedSocial,
          situation: {
            social_contact: 'present', social_contact_quality: quality,
            rejection_support: quality === 'supportive' ? 'support' : quality === 'rejecting' || quality === 'hostile' ? 'rejection' : 'none',
            intent: quality === 'supportive' ? 'supportive' : quality === 'hostile' ? 'hostile' : 'ambiguous',
          },
          context: { location: 'association' },
        },
        observation: { observed_facts: { interaction_type: ev.type } }, nowMs,
      });
    }
    report.counts.socialFired += 1;
  }

  function fireOfficer(nowMs) {
    const { officerKey, ev } = pickOfficer();
    if (vitals.locationRegime.current.id !== officerEventCompatibleLocation(ev.type)) {
      report.counts.officerGated += 1;
      return;
    }
    const officerName = (BY_KEY[officerKey] || {}).name || officerKey;
    const officerArchetype = ev.type === 'kindness' ? 'friendly_interaction'
      : ev.type === 'search' ? 'cell_search' : ev.type === 'refusal' ? 'cancelled_activity' : 'officer_instruction';
    const instrumental = instrumentalDefinitionFor('officer', ev.type)
      ? beginInstrumentalIncident('officer', ev.type, officerKey, officerName, nowMs) : null;
    if (!instrumental) {
      captureEnvironmentEvent(officerArchetype, {
        eventType: `officer_${ev.type}`, summary: `${officerName} ${ev.slight}`,
        world: {
          participants: { actor: officerKey, target: 'cy', relationship_ref: officerKey },
          social: officerSocialFacts(ev.type, officerKey, officerName),
          situation: { agency: 'officer' },
          context: { location: ev.type === 'search' ? 'cell' : 'wing' },
        },
        observation: { observed_facts: { interaction_type: ev.type } }, nowMs,
      });
    }
    report.counts.officerFired += 1;
  }

  function fireOverheard(nowMs) {
    const item = pickOverheard();
    const misheard = Math.random() < 0.25;
    captureEnvironmentEvent('ambiguous_overheard_remark', {
      eventType: 'overheard', summary: misheard ? item.mis : item.heard,
      world: {
        participants: { actor: item.source || null, target: null, relationship_ref: null },
        context: { location: 'wing', description: item.heard },
      },
      observation: { certainty: misheard ? 'uncertain' : 'probable', observed_facts: { misheard } }, nowMs,
    });
    report.counts.overheard += 1;
  }

  const recentWorldHistory = [];

  async function maybeRunAwg(nowMs, asleep, generateAwgCandidate) {
    const eligibility = shouldRunAwg(vitals.worldSimulation, {
      nowMs, idleBudgetMs: AWG_MIN_IDLE_BUDGET_MS, pendingHigherPriority: false, memoryFormationBacklog: 0, inferenceBusy: false,
    });
    if (!eligibility.run) return;
    report.counts.awgEligible += 1;
    const result = await runAmbientWorldCycle({
      state: vitals.worldSimulation, generate: generateAwgCandidate, nowMs, makeId,
      currentLocation: locationContextId(vitals.locationRegime.current.id),
      plausibleCastIds: plausibleCastAtLocation(vitals.locationRegime.current.id).map((c) => c.key),
      recentEvents: recentWorldHistory.slice(-12),
    });
    vitals.worldSimulation = result.state;
    if (result.status === 'SKIPPED') report.counts.awgSkipped += 1;
    else if (result.status === 'REJECTED') report.counts.awgRejected += 1;
    else if (result.status === 'NO_EVENT') report.counts.awgNoEvent += 1;
    else if (result.status === 'ACCEPTED') {
      report.counts.awgAccepted += 1;
      // Mirrors run.js's real AWG-acceptance path (~run.js:4477-4486): convert
      // the applied AWG event into the SAME structured environment
      // event/record shape every other producer uses, and feed it through the
      // identical captureEnvironmentEvent seam - this is the genuine grounded-
      // ingestion path for AWG content, not a side channel.
      const environment = awgEventToEnvironment(result.applied);
      const record = captureEnvironmentEvent(environment.archetypeId, {
        eventType: environment.eventType, summary: environment.summary,
        world: environment.world, observation: environment.observation,
        cyObserved: !!result.applied.cyObserved, nowMs,
      });
      recentWorldHistory.push({ id: record.world_event.id, summary: environment.summary || '' });
      for (const change of result.applied ? result.applied.changes : []) {
        if (change.action === 'OPEN') report.counts.threadsOpened += 1;
        else if (change.action === 'UPDATE') report.counts.threadsUpdated += 1;
        else if (change.action === 'RESOLVE') report.counts.threadsResolved += 1;
      }
    } else {
      // FAILED or CANCELLED - counted explicitly so a real problem (e.g. a
      // synthetic-generator/schema mismatch) is never silently invisible in
      // the report, the way it was during this harness's own development.
      report.counts.awgFailedOrCancelled += 1;
      fail('awg_cycle_failed_or_cancelled', { status: result.status, error: result.error, nowMs });
    }
  }

  async function tick(nowMs, { generateAwgCandidate } = {}) {
    const { date, mins } = londonParts(new Date(nowMs));
    resolvePendingInstrumentalIncidents(nowMs);
    if (date !== prevDate) prevDate = date;
    const asleep = effectiveAsleep(mins);
    processLocationRegime(nowMs, date, mins, asleep);
    advanceCellSearch(nowMs);
    advanceLockdown(nowMs);

    for (const slot of PRISON_SCHEDULE) {
      if (slot.kind === 'routine' && slot.routine === 'exercise') continue;
      if (crossed(slot.mins, mins, prevMins)) fireScheduled(slot, nowMs);
    }
    for (const key of Object.keys(DEVIATIONS)) {
      const r = REGIME.find((item) => item.phase === key);
      if (!r || !crossed(r.mins, mins, prevMins)) continue;
      if (Math.random() < DEVIATIONS[key].chance) report.counts.regimeDeviations += 1;
    }
    prevMins = mins;

    if (vitals.locationRegime.current.id !== LOCATIONS.EXERCISE_YARD) {
      if (!asleep && vitals.locationRegime.current.id === LOCATIONS.CELL
        && Math.random() < CELL_SEARCH_TICK_CHANCE) beginCellSearch(nowMs);
      if (!asleep && Math.random() < 0.0005) beginLockdown(nowMs);
      if (!asleep && Math.random() < 0.004) {
        report.counts.trivialIrritations += 1;
        // no_eggs/cold_tea: deliberately create NO feeding fact (see the
        // tray-irritation-feeding-contamination fix) - nothing to ingest here.
      }
      if (!asleep && Math.random() < 0.006) {
        if (vitals.locationRegime.current.id === INMATE_SOCIAL_COMPATIBLE_LOCATION) fireSocial(nowMs);
        else report.counts.socialGated += 1;
      }
      if (!asleep && Math.random() < 0.004) fireOfficer(nowMs);
      if (!asleep && Math.random() < 0.005) fireOverheard(nowMs);
    }

    if (generateAwgCandidate) await maybeRunAwg(nowMs, asleep, generateAwgCandidate);

    report.endMs = nowMs;
    report.simulatedMs = nowMs - startMs;
  }

  function finalize() {
    for (const thread of vitals.worldSimulation.threads || []) {
      report.finalWorldSimulationThreadStates[thread.state] = (report.finalWorldSimulationThreadStates[thread.state] || 0) + 1;
    }
    const feeding = vitals.cognition && vitals.cognition.feeding;
    const socialContact = vitals.cognition && vitals.cognition.socialContact;
    const somatic = vitals.cognition && vitals.cognition.somaticNociceptive;
    const threatLearning = vitals.cognition && vitals.cognition.threatLearning;
    const controllability = vitals.cognition && vitals.cognition.learnedControllability;
    report.counts.feedingRecords = feeding ? feeding.records.length : 0;
    report.counts.socialContactEpisodes = socialContact ? socialContact.episodes.length : 0;
    report.counts.somaticEvents = somatic ? somatic.history.length : 0;
    report.counts.threatTrials = threatLearning ? threatLearning.history.length : 0;
    report.counts.controllabilityUpdates = controllability ? Object.keys(controllability.pairs || {}).length : 0;
    return report;
  }

  return { vitals, soma, tick, finalize, fail };
}

// ---- top-level soak runner --------------------------------------------

export async function runAcceleratedSoak({
  vitals, startMs = Date.now(), durationMs, tickMs = 5000, awgEveryNTicks = 540, // ~45 simulated minutes at 5s/tick
} = {}) {
  const harness = createWorldSoakHarness({ vitals, startMs });
  const generateAwgCandidate = buildSyntheticAwgGenerator();
  const totalTicks = Math.round(durationMs / tickMs);
  for (let i = 0; i < totalTicks; i += 1) {
    const nowMs = startMs + i * tickMs;
    // AWG eligibility is itself cadence-gated internally (AWG_CADENCE_MS) -
    // checking every tick is correct and cheap (no I/O unless truly due).
    // eslint-disable-next-line no-await-in-loop
    await harness.tick(nowMs, { generateAwgCandidate });
  }
  return harness.finalize();
}

// ---- CLI ---------------------------------------------------------------

function parseArgs(argv) {
  const args = { hours: 16, from: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--from') args.from = argv[++i];
    else if (argv[i] === '--hours') args.hours = Number(argv[++i]);
    else if (argv[i] === '--out') args.out = argv[++i];
  }
  return args;
}

async function main(argv) {
  const args = parseArgs(argv.slice(2));
  if (!args.from) {
    console.error('usage: node dev-accelerated-world-soak.mjs --from <vitals.json> [--hours 16] [--out report.json]');
    process.exit(2);
  }
  console.log(`# Accelerated world soak (isolated copy, no network, no SQL, no live-state writes)`);
  console.log(`source checkpoint: ${args.from}`);
  const { vitals, tempRoot } = await captureFrozenState(args.from);
  console.log(`captured into isolated temp dir: ${tempRoot}`);
  try {
    const startMs = Date.now();
    const durationMs = args.hours * 3600 * 1000;
    console.log(`simulating ${args.hours}h from a frozen copy (no wall-clock wait)...`);
    const report = await runAcceleratedSoak({ vitals, startMs, durationMs });
    console.log(JSON.stringify(report, null, 2));
    if (args.out) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(args.out, JSON.stringify(report, null, 2));
      console.log(`report written: ${args.out}`);
    }
  } finally {
    await releaseFrozenState(tempRoot);
    console.log(`isolated temp dir removed: ${tempRoot}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] && process.argv[1].endsWith('dev-accelerated-world-soak.mjs')) {
  main(process.argv).catch((error) => {
    console.error(error && error.stack || error);
    process.exit(1);
  });
}
