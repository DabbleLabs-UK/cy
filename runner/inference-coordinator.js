// Serialize model requests and derive inference telemetry from the request that
// actually owns the provider slot. Ollama currently runs one useful slot for Cy;
// admitting overlapping HTTP requests only queues work inside llama-server and
// lets a completed foreground request falsely publish IDLE while hidden work is
// still consuming CPU.

function abortError() {
  return new DOMException('inference request aborted while queued', 'AbortError');
}

export class InferenceCoordinator {
  constructor({ onPhase = () => {}, onEvent = () => {}, now = () => Date.now() } = {}) {
    this.onPhase = onPhase;
    this.onEvent = onEvent;
    this.now = now;
    this.owner = null;
    this.queue = [];
    this.sequence = 0;
    this.phase = 'idle';
  }

  async acquire(meta = {}, signal = null) {
    if (signal && signal.aborted) throw abortError();
    const queuedAtMs = this.now();
    return new Promise((resolve, reject) => {
      const { deferStart = false, ...requestMeta } = meta;
      const waiter = {
        id: `infer-${++this.sequence}`,
        meta: requestMeta,
        deferStart: !!deferStart,
        signal,
        queuedAtMs,
        resolve,
        reject,
        onAbort: null,
      };
      waiter.onAbort = () => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
        reject(abortError());
      };
      if (signal) signal.addEventListener('abort', waiter.onAbort, { once: true });

      // Foreground requests overtake queued background work. The active owner is
      // never displaced here; the caller's existing AbortController performs the
      // deliberate foreground pre-emption and releases the slot cleanly.
      if (waiter.meta.background) this.queue.push(waiter);
      else {
        const firstBackground = this.queue.findIndex((item) => item.meta.background);
        if (firstBackground < 0) this.queue.push(waiter);
        else this.queue.splice(firstBackground, 0, waiter);
      }
      this.drain();
    });
  }

  drain() {
    if (this.owner) return;
    let waiter = this.queue.shift();
    while (waiter && waiter.signal && waiter.signal.aborted) {
      waiter.signal.removeEventListener('abort', waiter.onAbort);
      waiter.reject(abortError());
      waiter = this.queue.shift();
    }
    if (!waiter) return;
    if (waiter.signal) waiter.signal.removeEventListener('abort', waiter.onAbort);
    const ownerAcquiredAtMs = this.now();
    const record = {
      id: waiter.id,
      ...waiter.meta,
      queued_at: new Date(waiter.queuedAtMs).toISOString(),
      queue_ms: Math.max(0, ownerAcquiredAtMs - waiter.queuedAtMs),
    };
    this.owner = {
      id: waiter.id,
      phase: 'idle',
      ownerAcquiredAtMs,
      startedAtMs: null,
      record,
    };

    const begin = (phase = waiter.meta.phase || 'eval') => {
      if (finished || !this.owner || this.owner.id !== waiter.id) return null;
      if (this.owner.startedAtMs !== null) return this.owner.startedAtMs;
      const startedAtMs = this.now();
      this.owner.startedAtMs = startedAtMs;
      this.owner.phase = phase;
      record.started_at = new Date(startedAtMs).toISOString();
      record.pacing_ms = Math.max(0, startedAtMs - ownerAcquiredAtMs);
      this.setPhase(phase);
      this.onEvent({ event: 'start', ...record });
      return startedAtMs;
    };

    let finished = false;
    if (!waiter.deferStart) begin();
    else this.setPhase('idle');
    waiter.resolve({
      id: waiter.id,
      begin,
      setPhase: (phase) => {
        if (finished || !this.owner || this.owner.id !== waiter.id) return;
        if (this.owner.startedAtMs === null) begin(phase);
        this.owner.phase = phase;
        this.setPhase(phase);
      },
      finish: (detail = {}) => {
        if (finished) return;
        finished = true;
        const endedAtMs = this.now();
        if (this.owner && this.owner.startedAtMs !== null) {
          this.onEvent({
            event: 'end',
            ...record,
            ended_at: new Date(endedAtMs).toISOString(),
            duration_ms: Math.max(0, endedAtMs - this.owner.startedAtMs),
            ...detail,
          });
        } else {
          this.onEvent({
            event: 'cancelled',
            ...record,
            ended_at: new Date(endedAtMs).toISOString(),
            ...detail,
          });
        }
        if (this.owner && this.owner.id === waiter.id) this.owner = null;
        if (this.queue.length) this.drain();
        else this.setPhase('idle');
      },
    });
  }

  setPhase(phase) {
    if (phase === this.phase) return;
    this.phase = phase;
    this.onPhase(phase);
  }
}
