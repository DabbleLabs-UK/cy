// tempo.js - the viewer-driven generation duty cycle.
//
// Tempo decides how much deliberate SILENCE follows each completed generation.
// The model always streams at its natural speed; tempo does not alter token rate.
// For a target duty percentage s and a measured generation duration b:
//
//   idle = b * (100 / s - 1)
//   actual duty = b / (b + idle) = s / 100
//
// Do not cap that idle by speed. The former cap turned a displayed 31% setting
// into roughly 94% for a three-minute local generation, making the control, cost
// estimate, and power trace contradict one another. Long low-duty waits remain
// interruptible by new mail, owner notices, shutdown, and a tempo change.
//
// NB: public/assets/tempo.js mirrors this maths client-side (it cannot import a
// runner module), so the viewer can preview the cadence live while dragging the
// slider. Keep the two in step if the equation changes.

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

// How long to idle after a burst of `burstMs` at a given `speed`, to hit the
// requested duty cycle exactly. speed is coerced to an integer 1..100. Returns
// a whole number of milliseconds >= 0.
export function tempoIdleMs(burstMs, speed) {
  const s = clampSpeed(speed);
  if (s >= 100) return 0; // continuous: no deliberate idle at full tilt
  const b = Math.max(0, Number(burstMs) || 0);
  return Math.max(0, Math.round(b * (100 / s - 1)));
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

// Remaining quiet after another intentional quiet interval has already followed
// a measured inference burst (for example a model-selected silence). This lets
// that real quiet count toward tempo without letting the inference branch skip
// its duty-cycle obligation entirely.
export function remainingTempoIdleMs(burstMs, speed, quietAlreadyMs = 0) {
  return Math.max(0, tempoIdleMs(burstMs, speed) - Math.max(0, Number(quietAlreadyMs) || 0));
}

// Tempo is a machine-duty control, so one logical Cy cycle must not hide several
// back-to-back model requests inside a single long busy block. Record the most
// recently completed provider request and make the next one pay that request's
// remaining quiet first. The cycle tail uses the same remainder, so this moves
// quiet between calls without charging it twice.
export class InferenceTempoPacer {
  constructor() {
    this.last = null;
  }

  record(startedAtMs, endedAtMs) {
    if (startedAtMs === null || startedAtMs === undefined
      || endedAtMs === null || endedAtMs === undefined) return;
    const start = Number(startedAtMs);
    const end = Number(endedAtMs);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return;
    this.last = { endedAtMs: end, busyMs: Math.max(0, end - start) };
  }

  remaining(nowMs, speed) {
    if (!this.last) return 0;
    const elapsedQuietMs = Math.max(0, Number(nowMs) - this.last.endedAtMs);
    return remainingTempoIdleMs(this.last.busyMs, speed, elapsedQuietMs);
  }
}

// Background model work must not indiscriminately fill deliberate quiet. Memory
// formation/surfacing waits until the reservation ends. AWG is the single narrow
// exception: the journal scheduler may offer it a one-shot token for the quiet
// interval that was intentionally designed to host an ambient-world opportunity.
// This is scheduling only; it neither changes model content nor treats hidden
// work as part of Cy's visible duty percentage.
export class BackgroundTempoGate {
  constructor() {
    this.notBeforeMs = 0;
    this.awgReservationSequence = 0;
    this.awgReservation = null;
  }

  reserveVisibleIdle(idleMs, nowMs) {
    const now = Number(nowMs) || 0;
    const until = now + Math.max(0, Number(idleMs) || 0);
    this.notBeforeMs = Math.max(this.notBeforeMs, until);
    this.awgReservation = null;
    return this.notBeforeMs;
  }

  // A normal visible inference cycle deliberately creates a quiet interval.
  // AWG may consume that same interval only when its caller explicitly offers
  // this one-shot token. Other background work remains blocked by canStart().
  // This keeps the quiet period as the scheduling boundary without making it
  // self-contradictory for the one subsystem it was intended to host.
  reserveVisibleIdleForAwg(idleMs, nowMs) {
    const now = Number(nowMs) || 0;
    const reservedUntilMs = this.reserveVisibleIdle(idleMs, now);
    const reservation = Object.freeze({
      kind: 'AWG_VISIBLE_IDLE',
      id: ++this.awgReservationSequence,
      offeredAtMs: now,
      reservedUntilMs,
    });
    this.awgReservation = { ...reservation, claimed: false };
    return reservation;
  }

  claimAwgReservation(reservation, nowMs) {
    const now = Number(nowMs) || 0;
    const active = this.awgReservation;
    if (!reservation || reservation.kind !== 'AWG_VISIBLE_IDLE' || !active) return false;
    if (reservation.id !== active.id || active.claimed) return false;
    if (now < active.offeredAtMs || now >= active.reservedUntilMs) return false;
    active.claimed = true;
    return true;
  }

  recordBackgroundWork(startedAtMs, endedAtMs, speed) {
    const end = Math.max(Number(startedAtMs) || 0, Number(endedAtMs) || 0);
    const start = Math.min(Number(startedAtMs) || end, end);
    const until = end + tempoIdleMs(end - start, speed);
    this.notBeforeMs = Math.max(this.notBeforeMs, until);
    this.awgReservation = null;
    return this.notBeforeMs;
  }

  canStart(nowMs) {
    return (Number(nowMs) || 0) >= this.notBeforeMs;
  }

  waitMs(nowMs) {
    return Math.max(0, this.notBeforeMs - (Number(nowMs) || 0));
  }

  onTempoChange(previousSpeed, nextSpeed) {
    // A user who explicitly speeds Cy up should not have to wait for an old
    // slower reservation. Lowering the speed preserves the existing quiet.
    if (clampSpeed(nextSpeed) > clampSpeed(previousSpeed)) this.notBeforeMs = 0;
    if (clampSpeed(nextSpeed) !== clampSpeed(previousSpeed)) this.awgReservation = null;
  }
}
