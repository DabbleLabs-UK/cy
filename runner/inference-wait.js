// Content-free timing for the stages before a CY model request begins.
// The shared arbiter reports queue duration, but not the identities of the
// leases that occupied the host while this request waited.

export function inferenceWorkload(purpose) {
  if (purpose === 'journal') return 'CY_JOURNAL';
  if (purpose === 'expressive_choice') return 'CY_CHOOSER';
  if (purpose === 'ambient_world_generation') return 'CY_AWG';
  if (purpose === 'memory_surfacing' || purpose === 'memory_formation') return 'CY_MEMORY';
  return 'CY_OTHER';
}

function observedArbiterWorkload(owner) {
  if (!owner) return null;
  if (owner.client === 'feddit') return 'FEDDIT';
  if (owner.client === 'cy') return inferenceWorkload(owner.purpose);
  return 'OTHER_SHARED';
}

export class InferenceWaitTrace {
  constructor(purpose, { now = Date.now } = {}) {
    this.purpose = purpose || 'unknown';
    this.now = now;
    this.requestedAtMs = now();
    this.tempoIdleMs = 0;
    this.coordinatorWaitMs = 0;
    this.arbiterWaitMs = 0;
  }

  async measure(field, action) {
    if (!['tempoIdleMs', 'coordinatorWaitMs', 'arbiterWaitMs'].includes(field)) {
      throw new Error(`unknown inference wait stage: ${field}`);
    }
    const startedAtMs = this.now();
    try {
      return await action();
    } finally {
      this[field] += Math.max(0, this.now() - startedAtMs);
    }
  }

  snapshot({ modelStartedAtMs = null, arbiterGrant = null, status = 'started' } = {}) {
    const finishedAtMs = modelStartedAtMs ?? this.now();
    const total = Math.max(0, finishedAtMs - this.requestedAtMs);
    const serverWait = Number(arbiterGrant && arbiterGrant.waitMs);
    return {
      purpose: this.purpose,
      workload: inferenceWorkload(this.purpose),
      status,
      request_queued_at: new Date(this.requestedAtMs).toISOString(),
      model_started_at: modelStartedAtMs === null ? null : new Date(modelStartedAtMs).toISOString(),
      total_pre_model_ms: total,
      tempo_idle_ms: this.tempoIdleMs,
      coordinator_wait_ms: this.coordinatorWaitMs,
      arbiter_wait_ms: this.arbiterWaitMs,
      arbiter_server_wait_ms: arbiterGrant && Number.isFinite(serverWait)
        ? Math.max(0, serverWait) : null,
      other_setup_ms: Math.max(0, total - this.tempoIdleMs
        - this.coordinatorWaitMs - this.arbiterWaitMs),
      arbiter_active_at_request: observedArbiterWorkload(
        arbiterGrant && arbiterGrant.ownerAtRequest),
      arbiter_active_snapshot_status: arbiterGrant && arbiterGrant.ownerAtRequest
        ? 'OBSERVED_AT_REQUEST_NOT_WHOLE_WAIT' : 'UNAVAILABLE_OR_IDLE',
      blocking_workload: null,
      blocking_workload_status: 'NOT_REPORTED_BY_ARBITER',
    };
  }
}
