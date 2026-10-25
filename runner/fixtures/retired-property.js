import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import * as currentAgency from '../instrumental-agency.js';
import { advanceWorldEntity } from '../world-mirror.js';
import { makeObjectTransitionIncident, pushIncident, reconcileObjectIncidentThreads } from '../incidents.js';
import { createEnvironmentEvent, createEnvironmentRecord } from '../environment-schema.js';

export const BASE = '76cfd0285d95cf5ecaa130c074da05dc4b3902b2';
export const copy = value => JSON.parse(JSON.stringify(value));
export const AT = '2026-10-24T21:48:00.000Z';
export const currentSource = readFileSync(new URL('../run.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const root = fileURLToPath(new URL('../..', import.meta.url));
export function originalSource(path) {
  return execFileSync('git', ['show', `${BASE}:${path}`], { cwd: root, encoding: 'utf8' }).replaceAll('\r\n', '\n');
}
// The original module is self-contained, with no imports or runtime startup.
export const originalAgency = await import('data:text/javascript;base64,'
  + Buffer.from(originalSource('runner/instrumental-agency.js')).toString('base64'));

export function legacyPending(action = 'action:withhold_item') {
  const state = originalAgency.createInstrumentalAgencyState();
  const opened = originalAgency.openInstrumentalOpportunity(state, {
    sourceKind: 'officer', sourceEventType: 'search', actorKey: 'locke', actorName: 'Mr Locke',
    opportunityId: 'legacy:locke', timestamp: AT, forcedAction: action,
  });
  return originalAgency.queueInstrumentalOpportunity(state, opened.pending, 'env:legacy-opening');
}

export function executePropertyDispatch(vitals, { original = false, mirrorReady = true } = {}) {
  const source = original ? originalSource('runner/run.js') : currentSource;
  const agency = original ? originalAgency : currentAgency;
  const events = [];
  const captures = [];
  const context = { vitals, worldMirrorReady: mirrorReady, tsNow: () => AT,
    takePendingInstrumentalOpportunities: agency.takePendingInstrumentalOpportunities,
    resolveInstrumentalOpportunity: agency.resolveInstrumentalOpportunity,
    advanceWorldEntity, makeObjectTransitionIncident, pushIncident, reconcileObjectIncidentThreads,
    emit: event => events.push(copy(event)),
    captureEnvironmentEvent(archetypeId, options) {
      const record = createEnvironmentRecord(createEnvironmentEvent(archetypeId, {
        id: `env-${randomUUID()}`, timestamp: AT, ...options,
      }));
      captures.push(record);
      return record;
    },
  };
  if (original) {
    const locationSource = originalSource('runner/location-regime.js');
    const helper = locationSource.slice(locationSource.indexOf('export function markSearchPropertyAction('));
    vm.runInNewContext('const clone = value => JSON.parse(JSON.stringify(value));\n'
      + helper.replace('export function', 'function')
      + '\nglobalThis.markSearchPropertyAction = markSearchPropertyAction;', context);
  }
  const start = source.indexOf('  function resolvePendingInstrumentalIncidents()');
  const end = source.indexOf('  function structuredEventForName(', start);
  if (start < 0 || end < 0) throw new Error('Actual runner dispatch not found');
  vm.runInNewContext(source.slice(start, end) + '\nresolvePendingInstrumentalIncidents();', context);
  return { events, captures };
}
