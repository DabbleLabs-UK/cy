import { advanceCellSearchEpisode, reconcileLocationRegimeState, startCellSearchEpisode } from '../location-regime.js';

// Disposable canonical state, never production history.
export function searchPropertyFixture(actorId = 'proctor', nowMs = Date.parse('2026-10-24T12:00:00Z')) {
  const objects = [{ id: `object:${actorId}`, type: 'contraband_item', status: 'ACTIVE',
    holderId: 'cy:7734', location: 'cell', revision: 1,
    transitionId: '00000000-0000-4000-8000-000000000001' }];
  let { state } = startCellSearchEpisode(reconcileLocationRegimeState(null, {
    nowMs, date: '2026-10-24', minutes: 12 * 60,
  }), { nowMs, actorId, actorName: actorId, objects, makeId: () => `search:${actorId}` });
  for (let tick = 1; tick <= 3; tick++) {
    ({ state } = advanceCellSearchEpisode(state, { nowMs: nowMs + tick * 20_000, objects }));
  }
  return { searchState: state, searchId: state.searchEpisode.id, objects };
}
