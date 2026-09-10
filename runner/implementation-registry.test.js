import assert from 'node:assert/strict';
import {
  implementationRegistry,
  implementationEntry,
  somaImplementationStatus,
} from './implementation-registry.js';
import { createEnvironmentEvent, environmentEventToSomaInput } from './environment-schema.js';

const registry = implementationRegistry;
assert.equal(registry.schema, 'cy.implementation-registry');
assert.equal(registry.soma_variables.length, 8);
assert.ok(registry.soma_variables.every((entry) => entry.implementation_status === 'PROVISIONAL'));
assert.equal(somaImplementationStatus(), 'provisional');
assert.equal(implementationEntry('soma_subsystems', 'sleep_homeostasis').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'circadian_component').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_variables', 'fatigue').implementation_status, 'PROVISIONAL');
assert.equal(implementationEntry('brain_regions', 'hypothalamic').implementation_status, 'NOT_IMPLEMENTED');
assert.ok(registry.brain_regions.filter((entry) => entry.implementation_status === 'PROVISIONAL').length >= 1);

const schemaKeys = new Set(Object.keys(environmentEventToSomaInput(createEnvironmentEvent('calm_routine', {
  id: 'registry-schema-check',
  timestamp: '2026-09-10 12:00:00.000',
}))));
for (const entry of registry.soma_variables) {
  for (const dependency of entry.data_dependencies) {
    assert.ok(schemaKeys.has(dependency), `${entry.id} dependency ${dependency} must exist in cy.soma-input`);
  }
}

console.log('implementation-registry.test.js: all checks passed');
