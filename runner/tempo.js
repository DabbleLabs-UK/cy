// tempo.js - the duty-cycle timing for viewer-driven tempo.
//
// Tempo is a DUTY CYCLE, not a token-rate change: the model always streams at its
// natural speed; tempo only decides how much SILENCE sits between bursts. After a
// burst of wall-clock duration B, wait B * (100/speed - 1) before the next one:
//
//   speed=100 -> factor 0   -> no wait (continuous, the old behaviour)
//   speed=50  -> factor 1    -> wait as long as the burst took (50% duty)
//   speed=25  -> factor 3    -> wait 3x the burst (25% duty)
//   speed=5   -> factor 19   -> wait 19x the burst (nobody watching)
//
// This is NOT the narrative "silence" event (Cy choosing to stop); it is the
// machine being throttled, so run.js emits no silence event around it.
//
// The wait is clamped to MAX_TEMPO_IDLE_MS so a long burst at a low speed cannot
// produce an absurd multi-minute gap.

export const MAX_TEMPO_IDLE_MS = 120000; // 2 minutes

// How long to idle after a burst of `burstMs` to hit a `speed`% duty cycle.
// speed is coerced to an integer 1..100. Returns a whole number of ms in
// [0, max].
export function tempoIdleMs(burstMs, speed, max = MAX_TEMPO_IDLE_MS) {
  const s = clampSpeed(speed);
  if (s >= 100) return 0;
  const b = Math.max(0, Number(burstMs) || 0);
  const raw = b * (100 / s - 1);
  return Math.max(0, Math.min(max, Math.round(raw)));
}

// Coerce any incoming value to a valid tempo percentage integer 1..100.
export function clampSpeed(speed) {
  const n = Math.round(Number(speed));
  if (!Number.isFinite(n)) return 100;
  if (n < 1) return 1;
  if (n > 100) return 100;
  return n;
}
