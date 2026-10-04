import { abortWithReason, cancellationError } from './inference-cancellation.js';
import { isSleepWindow } from './prompt.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function effectiveAsleepForRegime(regime, mins) {
  if (regime === 'day') return false;
  if (regime === 'night') return true;
  return isSleepWindow(mins);
}

// A production runner must know the persisted override before its first
// sleep/location decision. Dry runs retain their historical auto default when
// there is no optional tempo.json file.
export async function loadInitialRegime(client, {
  wait = sleep, retryMs = 3000, log = console,
} = {}) {
  if (client.config.dryRun) {
    await client.pollTempo({ regimeOnly: true });
    return client.regime;
  }
  let failures = 0;
  while (!client.regimeLoaded) {
    await client.pollTempo({ regimeOnly: true });
    if (client.regimeLoaded) break;
    if (failures++ % 20 === 0) {
      log.warn('[cy] waiting for the persisted day/night regime before starting world time');
    }
    await wait(retryMs);
  }
  return client.regime;
}

// The same guard is used before a dream request, after its model/arbiter wait,
// after generation, and immediately before public emission. A later wake must
// discard the result, even if the provider completed despite cancellation.
export async function runDreamIfEligible({ isEligible, generate, publish }) {
  if (!isEligible()) return false;
  const result = await generate(isEligible);
  if (!isEligible()) return false;
  return publish(result, isEligible);
}

export function requireInferenceEligibility(isEligible, controller) {
  if (!isEligible || isEligible()) return;
  abortWithReason(controller, 'DREAM_WAKE');
  throw cancellationError(controller.signal);
}
