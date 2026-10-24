import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { searchPropertyFixture } from './fixtures/search-property.js';
import { createInstrumentalAgencyState, openInstrumentalOpportunity, queueInstrumentalOpportunity,
  resolveInstrumentalOpportunity, takePendingInstrumentalOpportunities } from './instrumental-agency.js';
import { resolveSearchPropertyAction } from './location-regime.js';
import { loadVitals, saveVitals } from './vitals.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import { Client } from './client.js';

// No servers, inference, real state or source modifications. Execute the actual
// runner resolver and real checkpoint/client code over disposable synthetic data.
const source = await readFile(new URL('./run.js', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('  function resolvePendingInstrumentalIncidents()'),
  source.indexOf('  function structuredEventForName('));
const directory = await mkdtemp(join(tmpdir(), 'cy-search-crash-proof-'));
try {
  const path = join(directory, 'vitals.json');
  const f = searchPropertyFixture();
  const agency = createInstrumentalAgencyState();
  const offered = openInstrumentalOpportunity(agency, { ...f, sourceKind: 'officer', sourceEventType: 'search',
    actorKey: 'proctor', actorName: 'Mr Proctor', opportunityId: 'opportunity:crash-proof',
    timestamp: '2026-10-24T12:01:00Z', forcedAction: 'action:withhold_item' });
  queueInstrumentalOpportunity(agency, offered.pending, 'env:opening');
  const initial = await loadVitals(path);
  Object.assign(initial, { locationRegime: f.searchState, instrumentalAgency: agency,
    worldSimulation: { objects: f.objects, threads: [] } });
  await saveVitals(path, initial);
  const receiptIds = [];
  for (let process = 1; process <= 2; process++) {
    const vitals = await loadVitals(path);
    assert.equal(vitals.instrumentalAgency.pending.length, 1);
    assert.equal(vitals.locationRegime.searchEpisode.property_action, undefined);
    const client = new Client({ dryRun: true }, directory);
    const context = { vitals, worldMirrorReady: true,
      tsNow: () => `2026-10-24T12:01:${process === 1 ? '05' : '10'}Z`,
      takePendingInstrumentalOpportunities, resolveInstrumentalOpportunity, resolveSearchPropertyAction,
      captureEnvironmentEvent: (archetype, options) => {
        const record = createEnvironmentRecord(createEnvironmentEvent(archetype, {
          id: `env-${randomUUID()}`, timestamp: context.tsNow(), ...options,
        }));
        client.enqueue({ kind: 'world_event_record', payload: record });
        receiptIds.push(record.world_event.id);
        return record;
      }, makeObjectTransitionIncident: () => null, reconcileObjectIncidentThreads: () => {},
      emit: event => client.enqueue(event), console };
    vm.runInNewContext(body + '; resolvePendingInstrumentalIncidents();', context);
    assert.equal(vitals.locationRegime.searchEpisode.property_result, 'EXISTING_OBJECT_RETAINED');
    assert.equal(vitals.locationRegime.searchEpisode.property_action.opportunityId, 'opportunity:crash-proof');
    await client.flush();
    // Crash before the later urgent/routine checkpoint: no saveVitals here.
  }
  const events = (await readFile(join(directory, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const records = events.filter(event => event.kind === 'world_event_record');
  const publicOutcomes = events.filter(event => event.kind === 'event');
  assert.equal(records.length, 2);
  assert.equal(publicOutcomes.length, 2);
  assert.notEqual(records[0].delivery_id, records[1].delivery_id);
  assert.notEqual(receiptIds[0], receiptIds[1]);
  assert.equal(records[0].payload.world_event.world.search_episode.id,
    records[1].payload.world_event.world.search_episode.id);
  console.log(JSON.stringify({ result: 'CRASH_WINDOW_REPRODUCED',
    sameSearch: records[0].payload.world_event.world.search_episode.id,
    sameObject: records[0].payload.world_event.world.search_episode.object_id,
    sameOpportunity: 'opportunity:crash-proof', retainedWorldRecords: records.length,
    publicOutcomes: publicOutcomes.length, uniqueWorldEventIds: new Set(receiptIds).size,
    uniqueDeliveryIds: new Set(events.map(event => event.delivery_id)).size,
    productionTouched: false, inferenceCalls: 0 }));
} finally { await rm(directory, { recursive: true, force: true }); }
