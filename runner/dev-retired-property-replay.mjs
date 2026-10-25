import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadVitals, saveVitals } from './vitals.js';
import { createInstrumentalAgencyState, reconcileInstrumentalAgencyState } from './instrumental-agency.js';
import { copy, legacyPending, executePropertyDispatch } from './fixtures/retired-property.js';

// Retain the false-possession/latest-search and publication-before-checkpoint
// failure order as positive controls. No production state, network or inference.
for (const action of ['action:withhold_item', 'action:hand_over_item']) {
  for (const hasObject of [false, true]) for (const original of [true, false]) {
    const directory = await mkdtemp(join(tmpdir(), 'cy-retired-property-replay-'));
    try {
      const path = join(directory, 'vitals.json');
      const initial = await loadVitals(path);
      initial.instrumentalAgency = { ...createInstrumentalAgencyState(), pending: [legacyPending(action)] };
      initial.worldSimulation = { objects: hasObject ? [{ id: 'object:bailey', type: 'permitted_item',
        status: 'ACTIVE', location: 'cell', holderId: 'cy:7734', revision: 1,
        transitionId: '00000000-0000-4000-8000-000000000001' }] : [], threads: [] };
      initial.locationRegime = { searchEpisode: { id: 'search:bailey-completed', actor_id: 'bailey',
        status: 'COMPLETE', object_id: hasObject ? 'object:bailey' : null,
        property_result: 'NOTHING_FOUND' } };
      initial.ledger = [];
      await saveVitals(path, initial);
      let worldOutcomes = 0, publicOutcomes = 0;
      const worldIds = new Set();
      for (let restart = 0; restart < 3; restart++) {
        const loaded = await loadVitals(path);
        if (!original) loaded.instrumentalAgency = reconcileInstrumentalAgencyState(loaded.instrumentalAgency);
        const result = executePropertyDispatch(loaded, { original });
        worldOutcomes += result.captures.length;
        for (const record of result.captures) worldIds.add(record.world_event.id);
        publicOutcomes += result.events.filter(event => event.kind === 'event').length;
        if (original) {
          assert.equal(loaded.locationRegime.searchEpisode.property_result, action === 'action:hand_over_item'
            ? 'EXISTING_OBJECT_CONFISCATED' : 'EXISTING_OBJECT_RETAINED');
          // Crash AFTER observed delivery but BEFORE receipt/state checkpoint.
        } else {
          assert.deepEqual(loaded.locationRegime, initial.locationRegime);
          assert.deepEqual(loaded.worldSimulation, initial.worldSimulation);
          assert.deepEqual(loaded.ledger, []);
          await saveVitals(path, loaded);
        }
      }
      assert.equal(worldOutcomes, original ? 3 : 0);
      assert.equal(publicOutcomes, original ? 3 : 0);
      assert.equal(worldIds.size, original ? 3 : 0);
      console.log(JSON.stringify({ action, hasObject,
        result: original ? 'OLD_FALSE_POSSESSION_CROSS_SEARCH_AND_CRASH_REPLAY_REPRODUCED'
          : 'RETIRED_BRANCH_UNREACHABLE',
        restarts: 2, worldOutcomes, publicOutcomes, uniqueWorldIds: worldIds.size,
        productionTouched: false, inferenceCalls: 0 }));
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}
