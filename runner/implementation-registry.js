// implementation-registry.js - the runner's read-only view of the same
// authoritative implementation registry used by PHP and the browser UI.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REGISTRY_URL = new URL('../config/implementation-registry.json', import.meta.url);
const VALID_STATUSES = new Set(['IMPLEMENTED', 'PROVISIONAL', 'NOT_IMPLEMENTED']);

export function validateImplementationRegistry(registry) {
  if (!registry || registry.schema !== 'cy.implementation-registry') {
    throw new Error('implementation registry has an invalid schema');
  }
  for (const scope of ['soma_variables', 'brain_regions']) {
    if (!Array.isArray(registry[scope])) throw new Error(`implementation registry has no ${scope}`);
    const ids = new Set();
    for (const entry of registry[scope]) {
      if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) {
        throw new Error(`implementation registry has an invalid ${scope} id`);
      }
      if (!VALID_STATUSES.has(entry.implementation_status)) {
        throw new Error(`implementation registry has an invalid status for ${entry.id}`);
      }
      ids.add(entry.id);
    }
  }
  return registry;
}

export function readImplementationRegistry(path = fileURLToPath(REGISTRY_URL)) {
  return validateImplementationRegistry(JSON.parse(readFileSync(path, 'utf8')));
}

export const implementationRegistry = readImplementationRegistry();

export function implementationEntry(scope, id, registry = implementationRegistry) {
  return (registry[scope] || []).find((entry) => entry.id === id) || null;
}

export function somaImplementationStatus(registry = implementationRegistry) {
  const statuses = (registry.soma_variables || []).map((entry) => entry.implementation_status);
  if (statuses.length && statuses.every((status) => status === 'IMPLEMENTED')) return 'implemented';
  if (statuses.some((status) => status === 'IMPLEMENTED' || status === 'PROVISIONAL')) return 'provisional';
  return 'not_implemented';
}
