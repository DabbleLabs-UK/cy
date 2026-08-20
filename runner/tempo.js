// tempo.js - the viewer-driven tempo as a TARGET CADENCE, not a raw multiplier.
//
// Tempo still only decides how much SILENCE sits between bursts (the model always
// streams at its natural speed - tempo never changes the token rate). But the
// idle is thought of as a CADENCE with a hard cap, so the experience is
// predictable no matter how slow a burst happens to be:
//
//   speed=100 -> continuous, no deliberate idle at all.
//   lower speeds insert idle, but the idle is CLAMPED to maxIdleForSpeed(speed)
//   so a slow burst can never explode the gap into tens of minutes.
//
// The old model was idle = burst * (100/speed - 1) with a single flat clamp.
// Once a burst grew to ~75s that produced ~24 MINUTE gaps at 5% and ~4 minute
// gaps at 30% - the page looked dead when it was merely throttled. Here the
// duty-cycle term is still the natural idle, but the per-speed cap is what the
// cadence is actually built around:
//
//   at 30% (someone watching)  -> capped at ~12s idle, so with a ~75s burst a
//                                 viewer sees something new roughly every ~90s.
//   at 5%  (nobody watching)   -> capped at 5 min idle, so several-minute gaps,
//                                 desirable and calm, but never runaway.
//   at 1%  (idlest)            -> capped at 13 min idle (~14-15 min cadence).
//
// maxIdleForSpeed interpolates (piecewise-linear on speed) between 0 at 100% and
// a genuinely long gap at 1%. MAX_TEMPO_IDLE_MS is an absolute backstop above the
// per-speed caps so no path can ever ask for more than a quarter-hour of silence.
//
// NB: public/assets/tempo.js mirrors this maths client-side (it cannot import a
// runner module), so the viewer can preview the cadence live while dragging the
// slider. Keep the two in step if the anchors change.

export const MAX_TEMPO_IDLE_MS = 15 * 60 * 1000; // 15 minutes - absolute safety cap

// ---- reading-speed cap (backpressure, not a timer) -------------------------
//
// Tempo (above) throttles by DUTY CYCLE - at speed=100 it inserts zero idle, so a
// burst runs as fast as the provider allows. On local ollama that was self-limiting
// (~55s TTFT); on a fast provider (DeepSeek) it is not, and the client pen renderer
// draws at a fixed stroke rate anyway, so anything generated far ahead of the reader
// just queues up unseen - tokens spent on prose nobody has reached. This is a second,
// independent throttle: keep the emitted prose from running more than a human can read
// ahead of them at any speed BELOW 100. It COMPOSES with the tempo idle (the runner sits
// for the GREATER of the two), it never replaces it. At speed 100 - flat out - the
// composition step in run.js bypasses this cap ONLY when the active provider is LOCAL
// (ollama, where generation is its own brake); on a metered/remote provider the cap
// binds even at 100, or a fast API is rinsed for prose nobody reads. This function
// itself stays pure, speed-agnostic and provider-agnostic - the gating lives in run.js.
//
// READ_CHARS_PER_SEC is a comfortable reading rate: ~220 wpm at ~5 chars/word ~= 18
// chars/sec. READ_BUFFER_CHARS is how much unread text is allowed to run ahead before
// backpressure kicks in (~30s of reading at that rate) - a small lead so short bursts
// are never throttled, only a sustained fast overrun is.
export const READ_CHARS_PER_SEC = 18; // ~220 wpm at ~5 chars/word - a human reading rate
export const READ_BUFFER_CHARS = 550; // ~30s of unread text allowed to run ahead before throttling

// How long to idle so the reader catches back down to the buffer, given how far
// ahead of the reading clock the emitted prose currently is. Pure function of
// aheadChars (uses the module constants only) so it is unit-testable and the
// client-side tempo preview can reuse the exact same maths. Returns whole ms >= 0;
// 0 whenever we are within the buffer (or behind the reader).
export function readingIdleMs(aheadChars) {
  const over = (Number(aheadChars) || 0) - READ_BUFFER_CHARS;
  if (over <= 0) return 0; // within the allowed lead (or behind the reader): no backpressure
  return Math.round((over / READ_CHARS_PER_SEC) * 1000); // drain the excess at the reading rate
}

// The longest DELIBERATE idle allowed at a given speed, in ms. Anchors are on
// speed (descending); values between anchors interpolate linearly. This is the
// cap that turns the raw duty-cycle idle into a sane cadence.
const MAX_IDLE_ANCHORS = [
  { speed: 100, ms: 0 }, // full tilt: continuous, no idle
  { speed: 30, ms: 12000 }, // someone watching: the burst itself is ~the cadence, so only a small pad
  { speed: 5, ms: 300000 }, // nobody watching: several-minute gaps are fine
  { speed: 1, ms: 780000 }, // idlest: up to ~13 min of silence
];

// The per-speed idle cap, interpolated across the anchors above. Returns a whole
// number of ms; 0 at 100%, rising as speed falls.
export function maxIdleForSpeed(speed) {
  const s = clampSpeed(speed);
  const a = MAX_IDLE_ANCHORS;
  if (s >= a[0].speed) return a[0].ms;
  for (let i = 0; i < a.length - 1; i++) {
    const hi = a[i];
    const lo = a[i + 1];
    if (s <= hi.speed && s >= lo.speed) {
      const frac = (s - lo.speed) / (hi.speed - lo.speed); // 0 at lo, 1 at hi
      return Math.round(lo.ms + (hi.ms - lo.ms) * frac);
    }
  }
  return a[a.length - 1].ms;
}

// How long to idle after a burst of `burstMs` at a given `speed`, to hit the
// target cadence. The raw duty-cycle idle (burst * (100/speed - 1)) is the
// natural gap; it is then CLAMPED to maxIdleForSpeed(speed) (and to `max`), so a
// long burst at a low speed can never explode the gap. speed is coerced to an
// integer 1..100. Returns a whole number of ms in [0, cap].
export function tempoIdleMs(burstMs, speed, max = MAX_TEMPO_IDLE_MS) {
  const s = clampSpeed(speed);
  if (s >= 100) return 0; // continuous: no deliberate idle at full tilt
  const b = Math.max(0, Number(burstMs) || 0);
  const duty = b * (100 / s - 1); // the raw duty-cycle idle, before capping
  const cap = Math.min(maxIdleForSpeed(s), Math.max(0, max));
  return Math.max(0, Math.min(cap, Math.round(duty)));
}

// The effective gap a viewer perceives between bursts at `speed`, given a
// representative burst duration: the burst plus the deliberate idle after it.
// This is the number the panels turn into "about every Ns".
export function effectiveCadenceMs(burstMs, speed) {
  const b = Math.max(0, Number(burstMs) || 0);
  return b + tempoIdleMs(b, speed);
}

// Coerce any incoming value to a valid tempo percentage integer 1..100.
export function clampSpeed(speed) {
  const n = Math.round(Number(speed));
  if (!Number.isFinite(n)) return 100;
  if (n < 1) return 1;
  if (n > 100) return 100;
  return n;
}
