import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadVitals, saveVitals } from './vitals.js';
import {
  LOCATIONS,
  advanceCellSearchEpisode,
  canStartScheduledRoutine,
  reconcileLocationRegimeState,
  reconcileRegimeLocation,
  startCellSearchEpisode,
  startScheduledRoutineEpisode,
} from './location-regime.js';

const date = '2026-09-30';
const now = Date.parse('2026-09-30T09:15:00.000Z');

test('sectioned checkpoint preserves routine location and staged search across restarts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cy-world-continuity-'));
  const path = join(dir, 'vitals.json');
  try {
    const vitals = await loadVitals(path);
    const cell = reconcileLocationRegimeState(null, { nowMs: now, date, minutes: 9 * 60 + 15 });
    vitals.locationRegime = startScheduledRoutineEpisode(cell, {
      nowMs: now, date, routine: 'shower', outcome: 'shower_warm',
    }).state;
    await saveVitals(path, vitals);
    let restarted = await loadVitals(path);
    restarted.locationRegime = reconcileLocationRegimeState(restarted.locationRegime, {
      nowMs: now + 60_000, date, minutes: 9 * 60 + 16,
    });
    assert.equal(restarted.locationRegime.current.id, LOCATIONS.SHOWER);
    assert.equal(restarted.locationRegime.activeRoutineEpisode.outcome, 'shower_warm');
    const returned = reconcileRegimeLocation(restarted.locationRegime, {
      nowMs: now + 15 * 60_000, date, minutes: 9 * 60 + 30,
    });
    restarted.locationRegime = returned.state;
    assert.equal(returned.events.length, 1);
    assert.equal(restarted.locationRegime.current.id, LOCATIONS.CELL);

    const object = { id: 'note-1', type: 'note', status: 'ACTIVE', location: 'cell', holderId: 'cy' };
    const started = startCellSearchEpisode(restarted.locationRegime, { nowMs: now + 20 * 60_000, objects: [object] });
    const instructed = advanceCellSearchEpisode(started.state, { nowMs: now + 20 * 60_000 + 20_000 });
    restarted.locationRegime = instructed.state;
    await saveVitals(path, restarted);
    const searchRestart = await loadVitals(path);
    searchRestart.locationRegime = reconcileLocationRegimeState(searchRestart.locationRegime, {
      nowMs: now + 20 * 60_000 + 25_000, date, minutes: 9 * 60 + 35,
    });
    assert.equal(searchRestart.locationRegime.searchEpisode.stage, 'CY_INSTRUCTION');
    assert.equal(searchRestart.locationRegime.searchEpisode.object_id, 'note-1');
    assert.equal(canStartScheduledRoutine(searchRestart.locationRegime, date, 'association'), false);
    const continued = advanceCellSearchEpisode(searchRestart.locationRegime, {
      nowMs: now + 20 * 60_000 + 40_000, objects: [object],
    });
    assert.equal(continued.event.world.search_episode.stage, 'SEARCH_ONGOING');
    assert.equal(continued.state.routineEpisodes[0].status, 'COMPLETE');
    searchRestart.locationRegime = continued.state;
    await saveVitals(path, searchRestart);
    const secondRestart = await loadVitals(path);
    assert.equal(secondRestart.locationRegime.searchEpisode.stage, 'SEARCH_ONGOING');
    assert.equal(secondRestart.locationRegime.routineEpisodes[0].status, 'COMPLETE');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
