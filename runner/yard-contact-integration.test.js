import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { execFileSync } from 'node:child_process';

import { Client, tsNow } from './client.js';
import { loadVitals, saveVitals } from './vitals.js';
import { createSomaRuntime } from './soma-runtime.js';
import { observeEnvironmentRecord } from './grounded-environment-transition.js';
import { sourceFromEnvironmentRecord } from './autobiographical-memory.js';
import { buildGroundedProseContext, formatGroundedProseContext } from './grounded-prose-context.js';
import { socialContactSnapshot } from './social-contact-substrate.js';
import { beforeYardContactTurn } from './fixtures/yard-contact-turn-source.mjs';
import * as yard from './yard-contact-choice.js';
import * as location from './location-regime.js';
import * as cast from './cast.js';

const AT = Date.parse('2026-10-27T14:30:00.000Z');
const ID = 'yard-00000000-0000-4000-8000-000000000001';
const CAST = { key: 'reg', name: 'Reg', blurb: 'An old lifer.' };
const source = readFileSync(new URL('./run.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const copy = value => JSON.parse(JSON.stringify(value));

function extract(text, first, last) {
  const a = text.indexOf(first), b = text.indexOf(last, a);
  assert.ok(a >= 0 && b > a, `runtime boundary: ${first}`);
  return text.slice(a, b).trim();
}

function yardLocation() {
  const at = new Date(AT - 15 * 60_000).toISOString();
  const exercise = { id: 'exercise:2026-10-27', status: 'ACTIVE', type: 'DAILY_EXERCISE',
    started_at: at, last_observation_at: at, interaction_count: 0, event_ids: [] };
  return { schema: 'cy.location-regime', version: 1,
    current: { id: 'EXERCISE_YARD', regime_activity: 'DAILY_EXERCISE', entered_at: at, source_event_id: 'yard-entry' },
    activeExerciseEpisode: copy(exercise), activeRegimeEpisode: copy(exercise),
    exerciseEpisodes: [copy(exercise)], searchEpisode: null, lockdownEpisode: null, activeRoutineEpisode: null };
}

function context(locationState = yardLocation(), nowMs = AT) {
  return yard.yardTurnContext({ nowMs, locationState, asleep: false, minutes: 870,
    regimeEpoch: 3, regime: 'auto' });
}

async function withState(run) {
  const directory = await mkdtemp(join(tmpdir(), 'cy-yard-integration-'));
  const path = join(directory, 'vitals.json');
  try {
    const vitals = await loadVitals(path);
    vitals.locationRegime = yardLocation();
    vitals.yardContactChoice = yard.yardContactState();
    await run({ directory, path, vitals });
  } finally {
    // Only this test's exclusively owned fixture directory.
    await rm(directory, { recursive: true, force: true });
  }
}

function runtimeFixture({ vitals, path, directory }, hooks = {}) {
  const calls = { history: [], memory: [], generated: [], diagnostics: [], projected: [], saved: [] };
  const client = new Client({ dryRun: true }, directory);
  client.regime = 'auto';
  const soma = createSomaRuntime(vitals.cognition, { now: AT,
    onState: value => { vitals.cognition = value; } });
  assert.equal(soma.available, true);
  class Clock extends Date { static now() { return AT; } }
  const env = { ...yard, ...location, Date: Clock, AbortController, setTimeout, clearTimeout,
    vitals, vitalsPath: path, client, soma, recentWorldHistory: calls.history,
    yardEnqueued: new Set(), yardRemembered: new Set(), regimeEpoch: 3,
    running: true, pendingPostcards: [], pendingWarden: [], maintenance: { blocked: false },
    config: { threads: 4 }, FOREGROUND_INFERENCE_TIMEOUT_MS: 420_000,
    londonParts: () => ({ mins: 870 }), effectiveAsleep: () => false,
    saveVitals: async (...args) => {
      calls.saved.push(copy(vitals.yardContactChoice));
      if (hooks.save) return hooks.save(...args);
      return saveVitals(...args);
    },
    observeEnvironmentRecord: (target, record) => {
      calls.projected.push(record.world_event.id);
      return observeEnvironmentRecord(target, record);
    },
    journalSubjectFromWorldRecord: record => record.world_event.id,
    rememberEnvironmentRecord: record => calls.memory.push(sourceFromEnvironmentRecord(record)),
    generationCancellation: { register() {}, clear() {} }, abortWithReason: (controller, reason) => controller.abort(reason),
    recordInferenceDiagnostic: record => calls.diagnostics.push(record), tsNow: () => new Date(AT).toISOString(),
    prepareSomaGeneration: () => ({ groundedDirective: 'The air feels cold.' }),
    options: (_vitals, _threads, _mode, opts) => opts,
    rawGenerate: async call => {
      calls.generated.push(call);
      assert.equal(call.purpose, 'yard_contact_choice');
      assert.equal(call.format, yard.YARD_CHOICE_FORMAT);
      assert.equal(call.isEligible(), true);
      return hooks.generate ? hooks.generate(call, env) : '{"action":"respond"}';
    },
  };
  const body = extract(source, '  // YARD TURN BEGIN: service and committed projections',
    '  // YARD TURN END: service and committed projections');
  const functions = runInNewContext(`(function() { ${body}
    return { service: serviceYardContactChoice, flush: checkpointYardTurns,
      current: currentYardTurnContext, project: projectYardRecord };
  })()`, env);
  return { ...functions, calls, client, soma, env };
}

function open(vitals) {
  const entry = yard.openYardGreeting(vitals.yardContactChoice, { id: ID, cast: CAST,
    context: context(vitals.locationRegime) });
  assert.ok(entry);
  return entry;
}

function assertPointEpisodes(soma) {
  assert.equal(soma.available, true);
  for (const episode of soma.state.socialContact.episodes) {
    assert.equal(episode.resolution, 'COMPLETED');
    assert.equal(episode.durationMs, 0);
    assert.equal(episode.startTimestamp, episode.endTimestamp);
    assert.equal(episode.isolation.continuouslyObserved, false);
    assert.equal(episode.isolation.aloneEstablished, false);
    assert.equal(episode.isolation.noContactEstablished, false);
  }
  assert.equal(soma.state.socialContact.episodes.filter(item => item.resolution === 'ONGOING').length, 0);
  const prose = formatGroundedProseContext(buildGroundedProseContext(soma.state, { now: AT }));
  assert.doesNotMatch(prose, /interacting with Reg|confirmed alone/);
  const current = socialContactSnapshot(soma.state.socialContact, AT).currentContext;
  assert.equal(current.currentlyInteracting, false);
  assert.equal(current.currentlyWith, null);
  assert.equal(current.currentlyAlone, false);
}

function assertDeliveryReceipts(entry, events) {
  const records = [entry.opening, entry.resolutionRecord].filter(Boolean);
  for (const record of records) {
    assert.equal(Object.hasOwn(record, 'social_contact'), false, 'canonical source remains immutable');
    assert.deepEqual(record.consumed_by, []);
    const event = events.find(item => item.kind === 'world_event_record' && item.payload.world_event.id === record.world_event.id);
    assert.ok(event);
    assert.deepEqual(event.payload.world_event, record.world_event);
    assert.deepEqual(event.payload.observation, record.observation);
    assert.deepEqual(event.payload.soma_input, record.soma_input);
    assert.equal(event.payload.social_contact.updated, true);
    assert.equal(event.payload.social_contact.sourceEnvironmentEventId, record.world_event.id);
    assert.equal(event.payload.consumed_by.includes('social-contact-detector-ledger-v1'), true);
    assert.equal(new Set(event.payload.consumed_by).size, event.payload.consumed_by.length);
    for (const key of ['feeding', 'somatic_nociceptive', 'action_outcome_contingency',
      'current_defensive_context', 'threat_learning']) assert.equal(Object.hasOwn(event.payload, key), true);
  }
}

test('actual service projects only checkpointed opening and action, with real Social and stable Client envelopes', async () => {
  await withState(async fixture => {
    const entry = open(fixture.vitals);
    const f = runtimeFixture(fixture);
    assert.equal(f.calls.history.length, 0);
    assert.equal(f.soma.state.socialContact.episodes.length, 0);
    assert.equal(f.client.batch.length, 0);
    assert.equal(await f.service(), true);
    assert.equal(entry.resolution.status, 'EXECUTED');
    assert.equal(f.calls.generated.length, 1);
    assert.equal(f.calls.history.length, 2);
    assert.deepEqual(f.calls.projected, [entry.opening.world_event.id, entry.resolutionRecord.world_event.id]);
    assert.equal(f.calls.memory.length, 1);
    assert.equal(f.calls.memory[0].sourceId, entry.resolutionRecord.world_event.id);
    assert.deepEqual(entry.resolutionRecord.world_event.world.social.linked_event_ids,
      [entry.opening.world_event.id, entry.resolutionRecord.world_event.id]);
    assert.deepEqual(f.client.batch.map(event => event.delivery_id), entry.pendingEvents.map(event => event.delivery_id));
    assert.deepEqual(f.client.batch, entry.pendingEvents);
    assertDeliveryReceipts(entry, f.client.batch);
    assert.equal(f.client.batch.every(event => event.yard_opportunity_id === ID), true);
    assert.equal(f.client.batch.every(event => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(event.ts)), true,
      'outer ingest timestamp retains the existing MariaDB DATETIME(3) contract');
    assert.equal(f.client.batch.some(event => ['text', 'draw'].includes(event.kind)), false);
    assert.equal(f.soma.state.socialContact.episodes.length, 2);
    const contact = f.soma.state.socialContact.episodes.find(item => item.episodeType === 'CONTACT');
    assert.equal(contact.contactForm, 'DIRECT_INTERACTION');
    assert.equal(contact.direction, 'INITIATED_BY_CY');
    assert.equal(contact.reciprocity, 'RECIPROCAL');
    assertPointEpisodes(f.soma);
    const restarted = await loadVitals(fixture.path);
    assert.deepEqual(restarted.yardContactChoice, fixture.vitals.yardContactChoice);
    assert.equal(restarted.cognition.socialContact.episodes.length, 2);
    await f.flush();
    assert.equal(f.calls.history.length, 2);
    assert.equal(f.calls.memory.length, 1);
    assert.equal(f.client.batch.length, 3);
    assert.equal(await f.service(), false);
    assert.equal(f.calls.generated.length, 1);
  });
});

for (const [label, output, action] of [
  ['decline', '{"action":"decline"}', 'decline'],
  ['invalid output', 'Cy begins a conversation.', null],
  ['provider failure', null, null],
]) test(`actual ${label} service cannot fabricate reciprocal contact or a conversation memory`, async () => {
  await withState(async fixture => {
    const entry = open(fixture.vitals);
    const f = runtimeFixture(fixture, { generate: () => {
      if (output === null) throw new Error('offline provider failure');
      return output;
    } });
    await f.service();
    assert.equal(entry.resolution.action, action);
    assert.equal(f.soma.state.socialContact.episodes.some(item => item.episodeType === 'CONTACT'), false);
    assertPointEpisodes(f.soma);
    const last = entry.resolutionRecord;
    assert.equal(last.world_event.world.social.action_executed, action);
    assert.doesNotMatch(f.calls.memory[0].text, /spoke briefly|conversation|returned.*greeting/);
    assert.equal(f.calls.generated.length, 1);
  });
});

test('same-millisecond yard resolutions reach the actual latest grounded fact and wording without ongoing presence', async () => {
  for (const [output, status, action, words] of [
    ['{"action":"respond"}', 'RESPONDED', 'respond', 'returned the greeting'],
    ['{"action":"decline"}', 'DECLINED', 'decline', 'deliberately declined this exchange'],
    ['no valid decision', 'NO_DECISION', null, 'no executed Cy decision is established'],
  ]) {
    await withState(async fixture => {
      const entry = open(fixture.vitals);
      const f = runtimeFixture(fixture, { generate: () => output });
      await f.service();
      assert.equal(entry.opening.world_event.timestamp, entry.resolutionRecord.world_event.timestamp,
        'both canonical records deliberately occupy the same millisecond');
      const grounded = buildGroundedProseContext(f.soma.state, { now: AT });
      const latest = grounded.sections.find(section => section.id === 'social').entries
        .find(item => item.fact === 'latest_social_episode');
      assert.ok(latest);
      assert.deepEqual(latest.value.yardDecision, { status, action });
      const rendered = formatGroundedProseContext(grounded);
      assert.ok(rendered.includes(`Cy's greeting turn: ${words}.`));
      assertPointEpisodes(f.soma);
      // The tie-break is specific to these yard identities. Ordinary tied
      // social records retain their established first-observed ordering.
      const ordinary = copy(f.soma.state.socialContact);
      for (const episode of ordinary.episodes) episode.opportunity.opportunityId = 'ordinary-social-episode';
      assert.equal(socialContactSnapshot(ordinary, AT).latestEpisode.opportunity.status, 'DECISION_PENDING');
    });
  }
});

for (const boundary of ['opening source', 'offered', 'committed', 'resolved source',
  'before projection checkpoint', 'after projection checkpoint']) {
  test(`real checkpoint restart at ${boundary} retains canonical identities and never repeats inference or projection`, async () => {
    await withState(async fixture => {
      const entry = open(fixture.vitals);
      let interrupted = false;
      const f = runtimeFixture(fixture, { save: async (...args) => {
        const projected = entry.projectedRecordIds.includes(entry.resolutionRecord?.world_event.id);
        const stop = !interrupted && (
          (boundary === 'opening source' && entry.phase === 'AVAILABLE' && !entry.projectedRecordIds.length)
          || (boundary === 'offered' && entry.phase === 'OFFERED')
          || (boundary === 'committed' && entry.phase === 'COMMITTED')
          || (boundary === 'resolved source' && entry.phase === 'RESOLVED' && !projected)
          || (boundary === 'before projection checkpoint' && projected)
          || (boundary === 'after projection checkpoint' && projected));
        if (stop && boundary === 'before projection checkpoint') {
          interrupted = true;
          throw new Error('offline process death');
        }
        await saveVitals(...args);
        if (stop) {
          interrupted = true;
          throw new Error('offline process death');
        }
      } });
      await assert.rejects(f.service(), /offline process death/);
      assert.equal(interrupted, true, 'the requested real checkpoint boundary was reached');
      assert.equal(f.client.batch.every(event => event.payload.world_event?.event_type === 'yard_greeting_opening'), true,
        'no executed-action callback can precede the projection checkpoint');
      assert.equal(f.calls.memory.length, 0, 'no memory callback can precede the projection checkpoint');
      const persisted = await loadVitals(fixture.path);
      const savedEntry = copy(persisted.yardContactChoice.encounters[0]);
      const executed = ['resolved source', 'before projection checkpoint', 'after projection checkpoint'].includes(boundary);
      assert.equal(savedEntry.phase === 'RESOLVED', executed);
      persisted.yardContactChoice = yard.yardContactState(persisted.yardContactChoice);
      assert.equal(yard.recoverYardTurns(persisted.yardContactChoice, { nowMs: AT }), !executed);
      const restarted = runtimeFixture({ ...fixture, vitals: persisted });
      const recoveredEntry = persisted.yardContactChoice.encounters[0];
      assert.equal(recoveredEntry.opening.world_event.id, savedEntry.opening.world_event.id);
      assert.deepEqual(recoveredEntry.decision, savedEntry.decision);
      assert.equal(recoveredEntry.resolution.status, executed ? 'EXECUTED' : 'NO_DECISION');
      assert.equal(recoveredEntry.resolution.action, executed ? 'respond' : null);
      await restarted.flush();
      assert.equal(await restarted.service(), false);
      assert.equal(restarted.calls.generated.length, 0, 'recovery cannot repeat or invent the interrupted inference');
      assert.equal(persisted.cognition.socialContact.episodes.length, 2);
      assert.equal(persisted.cognition.socialContact.episodes.filter(item => item.episodeType === 'CONTACT').length,
        executed ? 1 : 0);
      assertPointEpisodes(restarted.soma);
      const expectedProjections = boundary === 'opening source' ? 2
        : boundary === 'after projection checkpoint' ? 0 : 1;
      assert.equal(restarted.calls.projected.length, expectedProjections);
      if (executed) {
        assert.deepEqual(recoveredEntry.pendingEvents.map(event => event.delivery_id),
          savedEntry.pendingEvents.map(event => event.delivery_id));
        for (const saved of savedEntry.pendingEvents) {
          const replayed = recoveredEntry.pendingEvents.find(event => event.delivery_id === saved.delivery_id);
          if (saved.kind === 'event' || saved.payload.social_contact) {
            assert.deepEqual(replayed, saved, 'already checkpointed enriched payloads replay exactly');
          } else {
            assert.deepEqual(replayed.payload.world_event, saved.payload.world_event);
            assert.deepEqual(replayed.payload.observation, saved.payload.observation);
            assert.deepEqual(replayed.payload.soma_input, saved.payload.soma_input);
            assert.deepEqual({ ...replayed, payload: null }, { ...saved, payload: null });
          }
        }
      }
      assertDeliveryReceipts(recoveredEntry, restarted.client.batch);
      assert.deepEqual(restarted.client.batch, recoveredEntry.pendingEvents);
      assert.deepEqual(restarted.client.batch.map(event => event.delivery_id),
        recoveredEntry.pendingEvents.map(event => event.delivery_id));
      assert.equal(restarted.calls.memory[0].sourceId, recoveredEntry.resolutionRecord.world_event.id);
      const after = await loadVitals(fixture.path);
      assert.deepEqual(after.yardContactChoice.encounters[0].projectedRecordIds, recoveredEntry.projectedRecordIds);
      assert.deepEqual(after.yardContactChoice.encounters[0].pendingEvents, recoveredEntry.pendingEvents,
        'the exact enriched outbound payloads share the projection checkpoint');
      assert.equal(after.cognition.socialContact.episodes.length, 2);
      await restarted.flush();
      assert.equal(restarted.client.batch.length, 3);
      assert.equal(restarted.calls.memory.length, 1);
      assert.equal(restarted.calls.projected.length, expectedProjections);
    });
  });
}

test('real Client queue and checkpoint outbox replay the same delivery IDs after lost acknowledgement', async () => {
  await withState(async fixture => {
    open(fixture.vitals);
    const f = runtimeFixture(fixture);
    await f.service();
    const ids = f.client.batch.map(event => event.delivery_id);
    f.client.config.dryRun = false;
    f.client._send = async () => { throw new Error('offline lost response'); };
    await f.client.flush();
    const queued = (await readFile(f.client.queuePath, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(queued.map(event => event.delivery_id), ids);
    assertDeliveryReceipts(fixture.vitals.yardContactChoice.encounters[0], queued);
    const persisted = await loadVitals(fixture.path);
    const restarted = runtimeFixture({ ...fixture, vitals: persisted });
    await restarted.flush();
    assert.deepEqual(restarted.client.batch.map(event => event.delivery_id), ids);
    assert.deepEqual(restarted.client.batch, queued, 'all consumer receipt fields survive lost-ack replay unchanged');
    assert.equal(restarted.calls.projected.length, 0);
    assert.equal(yard.acknowledgeYardDeliveries(persisted.yardContactChoice, queued), true);
    await saveVitals(fixture.path, persisted);
    const acknowledged = await loadVitals(fixture.path);
    const again = runtimeFixture({ ...fixture, vitals: acknowledged });
    await again.flush();
    assert.equal(again.client.batch.length, 0);
    assert.equal(again.calls.projected.length, 0);
    assert.deepEqual(acknowledged.yardContactChoice.encounters[0].acknowledgedDeliveryIds, ids);
    assert.equal(yard.acknowledgeYardDeliveries(acknowledged.yardContactChoice, queued), false);
  });
});

test('late no-decision recovery keeps public greeting chronology while recording a distinct present closure', async () => {
  await withState(async fixture => {
    const original = copy(open(fixture.vitals).opening);
    await saveVitals(fixture.path, fixture.vitals);
    const recovered = await loadVitals(fixture.path);
    const closureAt = AT + 30 * 60_000;
    yard.recoverYardTurns(recovered.yardContactChoice, { nowMs: closureAt });
    const entry = recovered.yardContactChoice.encounters[0];
    const f = runtimeFixture({ ...fixture, vitals: recovered });
    await f.flush();
    assert.deepEqual(entry.opening, original);
    assert.equal(entry.resolution.status, 'NO_DECISION');
    assert.equal(entry.resolution.reason, 'RESTART_WITHOUT_RESOLVED_TURN');
    assert.equal(entry.resolutionRecord.world_event.timestamp, new Date(closureAt).toISOString());
    assert.match(entry.resolutionRecord.observation.summary, /^No executed Cy response or deliberate decline is established/);
    const publication = f.client.batch.find(event => event.kind === 'event');
    assert.equal(publication.ts, tsNow(new Date(AT)));
    assert.equal(publication.payload.environment_event_id, original.world_event.id);
    assert.equal(publication.payload.text, original.observation.summary);
    assert.equal(f.calls.history.find(item => item.id === entry.resolutionRecord.world_event.id).summary,
      entry.resolutionRecord.observation.summary);
    assert.equal(f.calls.memory[0].text, entry.resolutionRecord.observation.summary);
    assertDeliveryReceipts(entry, f.client.batch);
    assertPointEpisodes(f.soma);
    const checkpointed = await loadVitals(fixture.path);
    assert.deepEqual(checkpointed.yardContactChoice.encounters[0].pendingEvents, f.client.batch);
  });
});

test('actual away branch services a yard turn outside CELL before any journal or drawing route', async () => {
  await withState(async fixture => {
    open(fixture.vitals);
    const f = runtimeFixture(fixture);
    const calls = { yard: 0, journal: 0, idle: 0 };
    const env = { ...f.env, calls, currentMode: 'exercise', expressionEligibleSinceMs: AT,
      idleSilently: async () => { calls.idle++; env.running = false; },
      emit: () => assert.fail('no journal or draw publication'),
      serviceYardContactChoice: async () => { calls.yard++; const result = await f.service(); env.running = false; return result; },
    };
    const branch = extract(source, '      if (vitals.locationRegime.current.id !== LOCATIONS.CELL) {',
      '      if (pendingPostcards.length) {');
    await runInNewContext(`(async function() { while (running) { ${branch}
      calls.journal++; break;
    } })()`, env);
    assert.deepEqual(calls, { yard: 1, journal: 0, idle: 0 });
    assert.equal(f.calls.generated.length, 1);
    assert.equal(f.calls.generated[0].purpose, 'yard_contact_choice');
    assert.equal(fixture.vitals.locationRegime.current.id, 'EXERCISE_YARD');
    assert.equal(fixture.vitals.yardContactChoice.encounters[0].resolution.status, 'EXECUTED');
  });
});

for (const when of ['provider return', 'committed checkpoint']) {
  test(`actual service rechecks authoritative movement after ${when} before projecting any Cy action`, async () => {
    await withState(async fixture => {
      const entry = open(fixture.vitals);
      const move = () => { fixture.vitals.locationRegime.current = {
        id: 'CELL', entered_at: new Date(AT).toISOString(), regime_activity: 'CELL_TIME', source_event_id: 'return-to-cell',
      }; };
      const f = runtimeFixture(fixture, {
        generate: () => { if (when === 'provider return') move(); return '{"action":"respond"}'; },
        save: async (...args) => {
          await saveVitals(...args);
          if (when === 'committed checkpoint' && entry.phase === 'COMMITTED') move();
        },
      });
      await f.service();
      assert.equal(entry.resolution.status, 'NO_DECISION');
      assert.equal(entry.resolution.action, null);
      assert.equal(entry.resolution.executionStatus, 'NOT_EXECUTED');
      assert.equal(f.calls.generated.length, 1);
      assert.equal(f.soma.state.socialContact.episodes.some(item => item.episodeType === 'CONTACT'), false);
      assertPointEpisodes(f.soma);
      assert.equal(f.calls.memory.length, 1);
      assert.doesNotMatch(f.calls.memory[0].text, /returned|chose not|spoke briefly/);
      assert.equal(f.client.batch.some(event => /returned|chose not|spoke briefly/.test(event.payload.text || '')), false);
      const restarted = await loadVitals(fixture.path);
      assert.equal(restarted.locationRegime.current.id, 'CELL');
      assert.equal(restarted.yardContactChoice.encounters[0].resolution.action, null);
    });
  });
}

function locationFixture(runtime = source, rolls = [0.7, 0]) {
  const calls = { random: [], captures: [], public: [] };
  const vitals = { locationRegime: yardLocation(), yardContactChoice: yard.yardContactState() };
  const available = [...cast.CAST.filter(item => !['root', 'daemon'].includes(item.key)), ...cast.OFFICERS];
  const math = Object.create(Math);
  math.random = () => { assert.ok(rolls.length, 'no added random draws'); const value = rolls.shift(); calls.random.push(value); return value; };
  const env = { ...location, ...yard, ...cast, Math: math, vitals,
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
    reconcileRegimeLocation: state => ({ state, events: [] }),
    currentYardTurnContext: () => context(vitals.locationRegime),
    recordScheduledOutcome: () => assert.fail('no routine result'),
    captureEpisodeEvent: event => { calls.captures.push(copy(event)); return { world_event: { id: 'captured' } }; },
    publishEpisodeEvent: event => calls.public.push(copy(event)),
  };
  env.plausibleCastAtLocation = runInNewContext(`(${extract(runtime,
    'function plausibleCastAtLocation(', '  function publishEpisodeEvent(')})`, env);
  const process = runInNewContext(`(${extract(runtime,
    'function processLocationRegime(', '  function beginCellSearch(')})`, env);
  return { calls, vitals, available, tick: now => process(now, '2026-10-27', 870, false) };
}

test('actual yard producer consumes the same two draws and cast choice, at the existing 15-minute cadence', () => {
  const f = locationFixture();
  f.tick(AT - 1);
  assert.equal(f.calls.random.length, 0);
  f.tick(AT);
  assert.deepEqual(f.calls.random, [0.7, 0]);
  assert.equal(f.vitals.yardContactChoice.encounters.length, 1);
  assert.equal(f.calls.captures.length, 0, 'opening cannot speculatively reach history or Soma');
  assert.equal(f.calls.public.length, 0, 'opening cannot publish a completed conversation');
  f.tick(AT + location.YARD_OBSERVATION_INTERVAL_MS - 1);
  assert.equal(f.calls.random.length, 2);
  assert.equal(f.vitals.yardContactChoice.encounters.length, 1);
});

test('quiet, company, avoided and officer observations retain production events and exact random consumption', () => {
  const baseline = execFileSync('git', ['show', '0eeb5b6c654e54c807b9b29f0136a1e420fac450:runner/run.js'],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).replace(/\r\n/g, '\n');
  const sample = locationFixture();
  const officerIndex = sample.available.findIndex(item => cast.OFFICERS.some(officer => officer.key === item.key));
  assert.ok(officerIndex > 0);
  for (const rolls of [[0.1, 0], [0.4, 0], [0.9, 0], [0.7, (officerIndex + 0.1) / sample.available.length]]) {
    const before = locationFixture(baseline, [...rolls]), after = locationFixture(source, [...rolls]);
    before.tick(AT);
    after.tick(AT);
    assert.deepEqual(after.calls, before.calls);
    assert.deepEqual(after.vitals.locationRegime, before.vitals.locationRegime);
    assert.equal(after.vitals.yardContactChoice.encounters.length, 0);
  }
});

test('the exact yard delta reverts the entire runner and Client to the pinned production baseline', () => {
  for (const filename of ['run.js', 'client.js']) {
    const runtime = readFileSync(new URL(filename, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const baseline = execFileSync('git', ['show', `0eeb5b6c654e54c807b9b29f0136a1e420fac450:runner/${filename}`],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).replace(/\r\n/g, '\n');
    assert.equal(beforeYardContactTurn(runtime), baseline, `${filename} has no unrelated runtime change`);
  }
});
