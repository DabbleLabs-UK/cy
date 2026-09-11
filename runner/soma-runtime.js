// soma-runtime.js - fault boundary around Cy's provisional Soma engine.
//
// The runner must keep writing if persisted cognition is corrupt or a Soma
// operation throws. This adapter owns the live state reference, disables Soma
// on the first failure, and returns explicit unavailable snapshots plus neutral
// fallbacks. It never substitutes a fresh state that could look observed.

import * as defaultEngine from './soma.js';

const FALLBACK_ACTION = Object.freeze({
  name: 'observe',
  reason: 'Soma is unavailable; continue without a state-selected action',
  score: 0,
});

function cleanReason(error) {
  const message = error && error.message ? error.message : String(error || 'unknown Soma failure');
  return message.replace(/\s+/g, ' ').trim().slice(0, 180) || 'unknown Soma failure';
}

export function createSomaRuntime(rawState, {
  now = Date.now(),
  reconcileOptions = {},
  engine = defaultEngine,
  logger = console,
  onState = () => {},
  onFailure = () => {},
  initialFailure = null,
} = {}) {
  let state = null;
  let failure = null;

  function disable(operation, error) {
    if (failure) return;
    failure = { operation, reason: cleanReason(error), atMs: Date.now() };
    state = null;
    try {
      onState(null);
    } catch {
      // State publication is outside Soma and must not break the fallback.
    }
    if (logger && typeof logger.error === 'function') {
      logger.error(`[cy] Soma unavailable during ${operation}: ${failure.reason}`);
    }
    try {
      onFailure({ ...failure });
    } catch {
      // A reporting failure must not escape the fault boundary.
    }
  }

  function mutate(operation, fn) {
    if (failure || !state) return state;
    try {
      const next = fn(state);
      if (next && typeof next === 'object') state = next;
      onState(state);
      return state;
    } catch (error) {
      disable(operation, error);
      return null;
    }
  }

  try {
    if (initialFailure) throw new Error(String(initialFailure));
    if (rawState != null && (!rawState || typeof rawState !== 'object' || rawState.version !== engine.SOMA_VERSION)) {
      throw new Error('persisted Soma state has an unsupported or missing version');
    }
    state = engine.reconcileSoma(rawState, { now, ...reconcileOptions });
    if (!state || typeof state !== 'object') throw new Error('reconciliation returned no state');
    onState(state);
  } catch (error) {
    disable('load', error);
  }

  return {
    get available() {
      return !failure && !!state;
    },
    get state() {
      return state;
    },
    get failure() {
      return failure ? { ...failure } : null;
    },
    observe(observation, options) {
      return mutate('observation', (current) => engine.observeSoma(current, observation, options));
    },
    observeThreatLearningRecord(record) {
      let result = null;
      mutate('probabilistic threat learning', (current) => {
        result = engine.observeSomaThreatLearningRecord(current, record);
        return current;
      });
      return result;
    },
    observeCurrentDefensiveContextRecord(record) {
      let result = null;
      mutate('current defensive context', (current) => {
        result = engine.observeSomaCurrentDefensiveContextRecord(current, record);
        return current;
      });
      return result;
    },
    observeFeedingRecord(record) {
      let result = null;
      mutate('feeding and ingestion ledger', (current) => {
        result = engine.observeSomaFeedingRecord(current, record);
        return current;
      });
      return result;
    },
    observeControllabilityRecord(record) {
      let result = null;
      mutate('action-outcome contingency learning', (current) => {
        result = engine.observeSomaControllabilityRecord(current, record);
        return current;
      });
      return result;
    },
    observeSomaticRecord(record) {
      let result = null;
      mutate('somatic and noxious-input ledger', (current) => {
        result = engine.observeSomaSomaticRecord(current, record);
        return current;
      });
      return result;
    },
    observeSocialContactRecord(record) {
      let result = null;
      mutate('social contact and opportunity ledger', (current) => {
        result = engine.observeSomaSocialContactRecord(current, record);
        return current;
      });
      return result;
    },
    observeOutput(text, options) {
      return mutate('self-output feedback', (current) => engine.observeSomaOutput(current, text, options));
    },
    tick(options) {
      return mutate('tick', (current) => engine.tickSoma(current, options));
    },
    chooseAction(options) {
      if (failure || !state) return { ...FALLBACK_ACTION };
      try {
        return engine.chooseSomaAction(state, options);
      } catch (error) {
        disable('action selection', error);
        return { ...FALLBACK_ACTION };
      }
    },
    completeAction(name) {
      mutate('action completion', (current) => {
        engine.completeSomaAction(current, name);
        return current;
      });
    },
    provisionalMemoryCandidate() {
      if (failure || !state) return null;
      try {
        return engine.provisionalMemoryCandidate(state);
      } catch (error) {
        disable('provisional memory candidate', error);
        return null;
      }
    },
    recordExpressiveChoice(inspection, options) {
      return mutate('expressive choice record', (current) => (
        engine.recordExpressiveChoice(current, inspection, options)
      ));
    },
    directive() {
      if (failure || !state) return '';
      try {
        return engine.somaDirective(state);
      } catch (error) {
        disable('prompt context', error);
        return '';
      }
    },
    provisionalDirective() {
      if (failure || !state) return '';
      try {
        return engine.provisionalCognitiveDirective(state);
      } catch (error) {
        disable('provisional cognitive prompt context', error);
        return '';
      }
    },
    groundedDirective(options) {
      try {
        return engine.groundedSomaDirective(failure ? null : state, options);
      } catch (error) {
        disable('grounded Soma prompt context', error);
        try {
          return engine.groundedSomaDirective(null, options);
        } catch {
          return { context: null, directive: '' };
        }
      }
    },
    snapshot() {
      if (failure || !state) {
        return {
          version: null,
          status: 'unavailable',
          reason: failure ? failure.reason : 'Soma state is unavailable',
        };
      }
      try {
        return engine.somaSnapshot(state);
      } catch (error) {
        disable('snapshot', error);
        return { version: null, status: 'unavailable', reason: failure.reason };
      }
    },
  };
}

export { FALLBACK_ACTION };
