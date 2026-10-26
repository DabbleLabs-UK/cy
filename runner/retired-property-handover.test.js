import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { loadVitals, saveVitals } from './vitals.js';
import * as agency from './instrumental-agency.js';
import { startCellSearchEpisode, advanceCellSearchEpisode, reconcileLocationRegimeState,
  CELL_SEARCH_TICK_CHANCE, SEARCH_STAGE_MIN_MS } from './location-regime.js';
import { AT, copy, legacyPending, currentSource, originalSource, executePropertyDispatch } from './fixtures/retired-property.js';

const now = Date.parse(AT);
const object = { id: 'object:real', type: 'permitted_item', status: 'ACTIVE', holderId: 'cy:7734',
  location: 'cell', revision: 1, transitionId: '00000000-0000-4000-8000-000000000001' };
function cell() { return reconcileLocationRegimeState(null, { nowMs: now, date: '2026-10-24', minutes: 12 * 60 }); }

test('generic officer search has no active definition, opening, forced action or substitute', () => {
  assert.equal(agency.instrumentalDefinitionFor('officer', 'search'), null);
  assert.equal(agency.instrumentalOpportunityDefinitions().length, 4);
  for (const objects of [[], [object]]) for (const forcedAction of [null, 'action:hand_over_item', 'action:withhold_item']) {
    const state = agency.createInstrumentalAgencyState();
    assert.equal(agency.openInstrumentalOpportunity(state, {
      sourceKind: 'officer', sourceEventType: 'search', actorKey: 'locke', actorName: 'Mr Locke',
      opportunityId: 'new:search', timestamp: AT, forcedAction, objects, searchState: cell(),
    }), null);
    assert.deepEqual(state, agency.createInstrumentalAgencyState());
  }
});

for (const objects of [[], [object]]) test(`staged search completes at unchanged intervals; objects=${objects.length}`, () => {
  let result = startCellSearchEpisode(cell(), { nowMs: now, actorId: 'proctor', objects });
  const observed = [];
  for (let stage = 1; stage <= 5; stage++) {
    assert.equal(advanceCellSearchEpisode(result.state, { nowMs: now + stage * SEARCH_STAGE_MIN_MS - 1, objects }).advanced, false);
    result = advanceCellSearchEpisode(result.state, { nowMs: now + stage * SEARCH_STAGE_MIN_MS, objects });
    observed.push(result.actionOpportunity);
    if (stage === 3) assert.equal(result.state.searchEpisode.property_result,
      objects.length ? 'EXISTING_OBJECT_INSPECTED' : 'NOTHING_FOUND');
    // A restart at every stage must neither reopen a property scenario nor reroll.
    result.state = reconcileLocationRegimeState(copy(result.state), { nowMs: now + stage * SEARCH_STAGE_MIN_MS,
      date: '2026-10-24', minutes: 12 * 60 });
  }
  assert.deepEqual(observed, ['COMPLY_OR_REFUSE', null, null, null, null]);
  assert.equal(result.state.searchEpisode.status, 'COMPLETE');
  assert.equal(result.state.searchEpisode.object_id, objects[0]?.id || null);
  assert.deepEqual(objects, objects.length ? [object] : []);
});

test('actual staged runner dispatch opens only the preserved instruction', () => {
  const start = currentSource.indexOf('  function advanceCellSearch(now)');
  const end = currentSource.indexOf('  function beginLockdown(', start);
  const vitals = { locationRegime: startCellSearchEpisode(cell(), { nowMs: now, objects: [object] }).state,
    worldSimulation: { objects: [copy(object)] } };
  const calls = [];
  const context = { vitals, worldMirrorReady: true, advanceCellSearchEpisode,
    captureEpisodeEvent: () => ({}), publishEpisodeEvent: () => {},
    beginInstrumentalIncident: (...args) => calls.push(args) };
  vm.runInNewContext(currentSource.slice(start, end) + '\nglobalThis.advance = advanceCellSearch;', context);
  for (let tick = 1; tick <= 5; tick++) context.advance(now + tick * 20_000);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ['officer', 'order']);
  assert.equal(vitals.locationRegime.searchEpisode.status, 'COMPLETE');
});

for (const action of ['action:hand_over_item', 'action:withhold_item']) {
  test(`${action}: raw pending, exact and unrelated completed searches cannot resolve`, () => {
    const pending = legacyPending(action);
    assert.equal(agency.resolveInstrumentalOpportunity(pending, { timestamp: AT }), null);
    assert.throws(() => agency.queueInstrumentalOpportunity(agency.createInstrumentalAgencyState(), pending, 'old'), /invalid pending/);
    for (const mirrorReady of [false, true]) for (const objects of [[], [copy(object)]]) {
      const vitals = { instrumentalAgency: { ...agency.createInstrumentalAgencyState(), pending: [copy(pending)] },
        worldSimulation: { objects, threads: [] }, ledger: [],
        locationRegime: { ...cell(), searchEpisode: { id: 'search:bailey', actor_id: 'bailey',
          status: 'COMPLETE', object_id: objects[0]?.id || null, property_result: 'NOTHING_FOUND' } } };
      const before = copy(vitals);
      const result = executePropertyDispatch(vitals, { mirrorReady });
      assert.deepEqual(result, { events: [], captures: [] });
      assert.deepEqual(vitals.locationRegime, before.locationRegime);
      assert.deepEqual(vitals.worldSimulation, before.worldSimulation);
      assert.deepEqual(vitals.ledger, []);
      assert.deepEqual(vitals.instrumentalAgency.pending, []);
    }
  });

  test(`${action}: real checkpoint recovery silently retires pending work over three restarts`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cy-retired-property-'));
    try {
      const path = join(directory, 'vitals.json');
      const state = await loadVitals(path);
      state.instrumentalAgency = { ...agency.createInstrumentalAgencyState(), pending: [legacyPending(action)] };
      state.worldSimulation = { objects: [copy(object)], threads: [] };
      state.locationRegime = cell();
      state.ledger = [];
      await saveVitals(path, state);
      const original = copy(state);
      for (let restart = 0; restart < 3; restart++) {
        const loaded = await loadVitals(path);
        loaded.instrumentalAgency = agency.reconcileInstrumentalAgencyState(loaded.instrumentalAgency);
        assert.deepEqual(loaded.instrumentalAgency.pending, []);
        assert.deepEqual(executePropertyDispatch(loaded), { events: [], captures: [] });
        assert.deepEqual(loaded.locationRegime, original.locationRegime);
        assert.deepEqual(loaded.worldSimulation, original.worldSimulation);
        assert.deepEqual(loaded.ledger, original.ledger);
        await saveVitals(path, loaded);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}

test('recovery preserves unrelated pending instructions and historical evidence', () => {
  const state = agency.createInstrumentalAgencyState();
  const opened = agency.openInstrumentalOpportunity(state, { sourceKind: 'officer', sourceEventType: 'order',
    actorKey: 'proctor', actorName: 'Mr Proctor', opportunityId: 'order:valid', timestamp: AT });
  const order = agency.queueInstrumentalOpportunity(state, opened.pending, 'env:order');
  state.pending.push(legacyPending());
  const before = copy(state);
  const restored = agency.reconcileInstrumentalAgencyState(state);
  assert.deepEqual(state, before, 'reconciliation does not rewrite the old checkpoint object');
  assert.deepEqual(restored.pending, [order]);
  assert.ok(agency.resolveInstrumentalOpportunity(order, { timestamp: AT }));
});

test('timing, mirror, object lifecycle and accounting implementations are unchanged', async () => {
  const spec = JSON.parse(await readFile(new URL('../config/model-specs/prison-instrumental-opportunities.json', import.meta.url), 'utf8'));
  assert.deepEqual(spec.archetypes.map(item => item.id), agency.instrumentalOpportunityDefinitions().map(item => item.id));
  for (const path of ['runner/world-mirror.js', 'runner/message-object-lifecycle.js', 'runner/meal-choice.js',
    'runner/environment.js', 'runner/cast.js', 'runner/client.js']) {
    let actual = (await readFile(new URL('../' + path, import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
    if (path === 'runner/client.js') {
      // Optional memory claim authority is unrelated to search delivery. Allow
      // only that exact wrapper change; keep every other client byte pinned.
      actual = actual.replace("async claimMemorySurfacing(value = {}) {\n    return this._memoryRequest('claim_surfacing', value);",
        "async claimMemorySurfacing() {\n    return this._memoryRequest('claim_surfacing');");
    }
    assert.equal(actual, originalSource(path), path);
  }
  assert.ok(originalSource('runner/location-regime.js').includes(`export const CELL_SEARCH_TICK_CHANCE = ${CELL_SEARCH_TICK_CHANCE};`));
  assert.doesNotMatch(currentSource, /markSearchPropertyAction|preparedPropertyResolutions|pendingPropertyEvents|enqueueSearchPropertyEvent/);
});
