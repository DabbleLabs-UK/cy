import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { searchPropertyFixture } from './fixtures/search-property.js';
import { bindSearchProperty, resolveSearchPropertyAction, searchPropertyBindingValid,
  advanceCellSearchEpisode, startCellSearchEpisode } from './location-regime.js';
import { createInstrumentalAgencyState, openInstrumentalOpportunity, queueInstrumentalOpportunity,
  reconcileInstrumentalAgencyState, resolveInstrumentalOpportunity,
  takePendingInstrumentalOpportunities } from './instrumental-agency.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import { loadVitals, saveVitals } from './vitals.js';

const AT = '2026-10-24T12:01:05.000Z';
const copy = (value) => JSON.parse(JSON.stringify(value));
function prepare(f = searchPropertyFixture(), action = 'action:hand_over_item') {
  const state = createInstrumentalAgencyState();
  const opened = openInstrumentalOpportunity(state, { ...f, sourceKind: 'officer', sourceEventType: 'search',
    actorKey: 'proctor', actorName: 'Mr Proctor', opportunityId: 'opportunity:test', timestamp: AT,
    forcedAction: action });
  const pending = opened ? queueInstrumentalOpportunity(state, opened.pending, 'env:opening') : null;
  return { ...f, state, opened, pending };
}
function apply(f) {
  return resolveSearchPropertyAction(f.searchState, { binding: f.pending?.propertyBinding,
    objects: f.objects, action: f.pending?.chosenAction, opportunityId: f.pending?.opportunityId, timestamp: AT });
}

test('no canonical available Cy-held object: no property scenario or selector change', () => {
  for (const mutate of [f => { f.objects = []; }, f => { f.searchState.searchEpisode.object_id = null; },
    f => { f.objects[0].holderId = 'bill'; }, f => { f.objects[0].status = 'CONFISCATED'; },
    f => { f.objects[0].location = 'officer_desk'; }, f => { f.objects[0].id = null; }]) {
    const f = searchPropertyFixture(); mutate(f);
    const p = prepare(f);
    assert.equal(p.opened, null);
    assert.deepEqual(p.state.selectionCounters, {});
    assert.deepEqual(p.state.pending, []);
  }
});

test('generic officer/search cannot borrow a live staged search without its explicit ID', () => {
  const f = searchPropertyFixture(); delete f.searchId;
  assert.equal(prepare(f).opened, null);
});

test('live search and real canonical object bind at admission and in canonical event provenance', () => {
  const f = prepare();
  assert.ok(f.opened);
  assert.deepEqual(f.pending.propertyBinding, { searchId: f.searchId, objectId: f.objects[0].id,
    actorId: 'proctor', revision: 1, transitionId: f.objects[0].transitionId });
  const outcome = resolveInstrumentalOpportunity(f.pending, { ...f, timestamp: AT });
  const record = createEnvironmentRecord(createEnvironmentEvent(outcome.archetypeId, {
    id: 'env:resolved', timestamp: AT, world: outcome.world, observation: outcome.observation,
  }));
  assert.equal(record.world_event.world.search_episode.object_id, f.objects[0].id);
  assert.equal(record.world_event.world.search_episode.id, f.searchId);
});

for (const action of ['action:hand_over_item', 'action:withhold_item']) {
  test(`${action}: affects exactly the bound object/search once, including replay`, () => {
    const f = prepare(undefined, action);
    const unrelated = { ...copy(f.objects[0]), id: 'object:other' };
    f.objects.push(unrelated);
    const before = copy(f.objects);
    const result = apply(f);
    assert.equal(result.applied, true);
    assert.equal(result.object.id, before[0].id);
    assert.equal(result.state.searchEpisode.property_action.opportunityId, f.pending.opportunityId);
    assert.deepEqual(f.objects, before, 'pure preparation has no partial mutations');
    assert.deepEqual(f.objects[1], unrelated);
    if (action === 'action:hand_over_item') {
      assert.equal(result.object.holderId, 'proctor');
      assert.equal(result.object.status, 'CONFISCATED');
      assert.equal(result.object.revision, 2);
      assert.notEqual(result.object.transitionId, before[0].transitionId);
    } else {
      assert.deepEqual(result.object, before[0], 'retention does not invent an object movement');
      assert.equal(result.state.searchEpisode.property_result, 'EXISTING_OBJECT_RETAINED');
    }
    f.searchState = copy(result.state); f.objects[0] = copy(result.object);
    assert.equal(apply(f).applied, false);
    assert.equal(resolveInstrumentalOpportunity(f.pending, { ...f, timestamp: AT }), null);
  });
}

for (const [label, mutate] of [
  ['disappeared', f => { f.objects = []; }],
  ['different holder', f => { f.objects[0].holderId = 'bill'; }],
  ['confiscated', f => { f.objects[0].status = 'CONFISCATED'; }],
  ['relocated', f => { f.objects[0].location = 'yard'; }],
  ['revision changed', f => { f.objects[0].revision++; }],
  ['transition changed', f => { f.objects[0].transitionId = '00000000-0000-4000-8000-000000000002'; }],
  ['Cy departed', f => { f.searchState.current.id = 'EXERCISE_YARD'; }],
  ['search completed', f => { f.searchState.searchEpisode.status = 'COMPLETE'; }],
  ['stage advanced', f => { f.searchState.searchEpisode.stage = 'SEARCH_COMPLETE'; }],
  ['officer changed', f => { f.searchState.searchEpisode.actor_id = 'locke'; }],
  ['null object binding', f => { f.searchState.searchEpisode.object_id = null; }],
]) {
  test(`${label} before resolution: no possession/consequence or state mutation`, () => {
    const f = prepare(); mutate(f); const before = copy(f.searchState);
    assert.equal(resolveInstrumentalOpportunity(f.pending, { ...f, timestamp: AT }), null);
    assert.equal(apply(f).applied, false);
    assert.deepEqual(f.searchState, before);
  });
}

test('old unbound pending evidence survives reconciliation but cannot resolve against completed search', () => {
  const f = prepare(); delete f.pending.propertyBinding;
  f.state.pending = [f.pending];
  const restored = reconcileInstrumentalAgencyState(copy(f.state));
  assert.deepEqual(restored.pending, [f.pending]);
  f.searchState.searchEpisode.status = 'COMPLETE';
  f.searchState.searchEpisode.object_id = null;
  assert.equal(resolveInstrumentalOpportunity(restored.pending[0], { ...f, timestamp: AT }), null);
  assert.equal(apply(f).applied, false);
  assert.equal(f.searchState.searchEpisode.property_result, 'EXISTING_OBJECT_INSPECTED');
});

test('two nearby searches cannot cross-bind even with the same officer and object', () => {
  const f = prepare();
  const other = copy(f.searchState); other.searchEpisode.id = 'search:other';
  assert.equal(resolveInstrumentalOpportunity(f.pending, { searchState: other, objects: f.objects, timestamp: AT }), null);
  assert.equal(searchPropertyBindingValid(other, f.pending.propertyBinding, f.objects), false);
  other.searchEpisode.status = 'COMPLETE';
  assert.equal(resolveSearchPropertyAction(other, { binding: f.pending.propertyBinding, objects: f.objects,
    action: f.pending.chosenAction, opportunityId: f.pending.opportunityId, timestamp: AT }).applied, false);
});

test('same live search cannot queue a second property opportunity', () => {
  const f = prepare();
  assert.equal(openInstrumentalOpportunity(f.state, { ...f, sourceKind: 'officer', sourceEventType: 'search',
    actorKey: 'proctor', actorName: 'Mr Proctor', opportunityId: 'opportunity:second', timestamp: AT }), null);
});

test('no object and lost ownership at the staged producer never offer a property branch', () => {
  for (const missing of [true, false]) {
    const f = searchPropertyFixture();
    f.searchState.searchEpisode.stage = 'SEARCH_ONGOING';
    if (missing) f.objects = []; else f.objects[0].holderId = 'bill';
    const next = advanceCellSearchEpisode(f.searchState, { nowMs: Date.parse(AT), force: true, objects: f.objects });
    assert.equal(next.actionOpportunity, null);
    assert.equal(next.state.searchEpisode.property_result, 'NOTHING_FOUND');
  }
});

test('normal empty search completes without invented property', () => {
  const f = searchPropertyFixture();
  let result = startCellSearchEpisode({ ...f.searchState, searchEpisode: null }, { objects: [], nowMs: Date.parse(AT) });
  for (let tick = 1; tick <= 6; tick++) {
    result = advanceCellSearchEpisode(result.state, { objects: [], nowMs: Date.parse(AT) + tick * 20_000 });
    assert.notEqual(result.actionOpportunity, 'HAND_OVER_OR_WITHHOLD');
  }
  assert.equal(result.state.searchEpisode.status, 'COMPLETE');
  assert.equal(result.state.searchEpisode.property_result, 'NOTHING_FOUND');
});

test('actual runner resolution wiring rejects the natural null-object/completed-search case', async () => {
  const source = await readFile(new URL('./run.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('  function resolvePendingInstrumentalIncidents()'),
    source.indexOf('  function structuredEventForName('));
  for (const stale of [false, true]) {
    const f = prepare();
    if (stale) { delete f.pending.propertyBinding; f.searchState.searchEpisode.object_id = null;
      f.searchState.searchEpisode.status = 'COMPLETE'; }
    f.state.pending = [f.pending];
    const events = [], records = [], objects = [], warnings = [];
    const vitals = { instrumentalAgency: f.state, locationRegime: f.searchState,
      worldSimulation: { objects: f.objects }, ledger: [] };
    const before = copy(vitals.locationRegime);
    let id = 0;
    const context = { vitals, worldMirrorReady: true, tsNow: () => AT, takePendingInstrumentalOpportunities,
      resolveInstrumentalOpportunity, resolveSearchPropertyAction,
      captureEnvironmentEvent: (archetype, options) => {
        const record = createEnvironmentRecord(createEnvironmentEvent(archetype, {
          id: `env:${++id}`, timestamp: AT, ...options,
        })); records.push(record); return record;
      }, makeObjectTransitionIncident: args => { objects.push(args); return null; },
      reconcileObjectIncidentThreads: () => {}, emit: event => events.push(copy(event)),
      console: { warn: text => warnings.push(text) } };
    vm.runInNewContext(body + '; resolvePendingInstrumentalIncidents(); resolvePendingInstrumentalIncidents();', context);
    if (stale) {
      assert.deepEqual(vitals.locationRegime, before);
      assert.equal(records.length, 0); assert.equal(events.length, 0); assert.equal(objects.length, 0);
      assert.equal(warnings.length, 1);
    } else {
      assert.equal(records.length, 1); assert.equal(objects.length, 1);
      assert.equal(objects[0].after.id, f.pending.propertyBinding.objectId);
      assert.equal(events.filter(e => e.kind === 'world_object_record').length, 1);
      assert.equal(events.filter(e => e.kind === 'event').length, 1);
    }
  }
  assert.match(source, /beginInstrumentalIncident\('officer', 'search', episode.actor_id, episode.actor_name, episode.id\)/);
  assert.match(source, /beginInstrumentalIncident\('officer', ev.type, officerKey, officerName\)/);
});

test('real sectioned checkpoint preserves binding, and applied receipt prevents recovery replay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cy-search-binding-'));
  try {
    const path = join(directory, 'vitals.json');
    const f = prepare();
    const vitals = await loadVitals(path);
    Object.assign(vitals, { locationRegime: f.searchState, instrumentalAgency: f.state,
      worldSimulation: { objects: f.objects, threads: [] } });
    await saveVitals(path, vitals);
    const restored = await loadVitals(path);
    f.searchState = restored.locationRegime; f.objects = restored.worldSimulation.objects;
    f.pending = reconcileInstrumentalAgencyState(restored.instrumentalAgency).pending[0];
    assert.deepEqual(f.pending.propertyBinding, f.opened.pending.propertyBinding);
    const result = apply(f); assert.equal(result.applied, true);
    restored.locationRegime = result.state; restored.worldSimulation.objects[0] = result.object;
    // Even an old duplicated pending receipt cannot apply against the committed result.
    await saveVitals(path, restored);
    const replay = await loadVitals(path);
    assert.equal(resolveInstrumentalOpportunity(f.pending, { searchState: replay.locationRegime,
      objects: replay.worldSimulation.objects, timestamp: AT }), null);
    assert.equal(replay.worldSimulation.objects[0].revision, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
