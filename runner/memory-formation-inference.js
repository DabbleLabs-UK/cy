// Sender formation admission/accounting only. Canonical retrieval, prompts,
// parsing and transactional application remain in the existing memory runtime.
import { deepseekFormationRequest } from './provider.js';
import { options } from './prompt.js';

const REASONS = new Set(['disabled', 'off', 'credentials_missing', 'provider_unavailable', 'rate_limit',
  'timeout', 'cancelled', 'transport_failure', 'provider_error', 'budget_unavailable', 'accounting_unavailable',
  'already_reserved', 'concurrency_full', 'cloud_disabled', 'reservation_not_granted', 'invalid_request',
  'model_mismatch', 'claim_not_active', 'local_busy',
  'hour_request_cap', 'day_request_cap', 'month_request_cap', 'hour_spend_cap', 'day_spend_cap', 'month_spend_cap']);
function safeReason(value, fallback = 'provider_error') { return REASONS.has(value) ? value : fallback; }
function safeModel(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:/ -]{1,160}$/.test(value) ? value : null;
}

export class MemoryFormationInferenceError extends Error {
  constructor(reason, metadata = {}) {
    const safe = safeReason(reason);
    super(`sender memory inference ${safe}`);
    this.name = 'MemoryFormationInferenceError';
    this.memoryFailureReason = safe;
    this.reason = safe;
    Object.assign(this, metadata);
  }
}

export function formationInputTokenBound(requestBody) {
  // Include schema, tool description, all roles and UTF-8 bytes, not merely
  // visible source text. The extra allowance covers provider framing overhead.
  return Buffer.byteLength(JSON.stringify(requestBody), 'utf8') + 4096;
}

function measuredUsage(stats) {
  if (!stats || stats.usage_reported === false) return null;
  const usage = stats.usage;
  if (!usage || !Number.isInteger(usage.prompt_tokens) || usage.prompt_tokens < 0
      || !Number.isInteger(usage.completion_tokens) || usage.completion_tokens < 0) return null;
  const cached = usage.cached_tokens ?? 0;
  if (!Number.isInteger(cached) || cached < 0 || cached > usage.prompt_tokens) return null;
  return { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, cached_tokens: cached };
}

export class MemoryFormationInference {
  constructor(config, { fetchImpl = fetch } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
    this.mode = 'DEEPSEEK'; // Diagnostic hint only; every request asks the server.
    this.seenReservations = new Set();
  }

  async post(action, data) {
    const response = await this.fetch(`${this.config.apiBase}/api/memory-formation-inference.php`, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'X-Cy-Key': this.config.ingestKey },
      body: JSON.stringify({ action, ...data }), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('memory formation accounting unavailable');
    const result = await response.json();
    if (result?.ok !== true) throw new Error('memory formation accounting unavailable');
    return result;
  }

  async generate({ job, call, signal = call?.signal, providers, localGenerate }) {
    const configuredModel = safeModel(this.config.deepseek?.model);
    const localModel = safeModel(providers.ollama?.modelFor('memory_formation'));
    const metadata = { mode: this.mode, provider: this.mode === 'LOCAL' ? 'ollama' : 'deepseek',
      configuredModel, actualModel: null, requestId: null };
    if (this.config.dryRun) throw new MemoryFormationInferenceError('disabled', {
      ...metadata, mode: 'OFF', provider: null,
    });
    if (!['POSTCARD', 'CY_REPLY'].includes(job?.source?.sourceType) || !job.source.subjectVisitorId
        || job.source.sourceVisibility !== 'SENDER_RECALLABLE' || !configuredModel
        || !job.id || !job.claim_token || typeof call?.system !== 'string' || typeof call?.prompt !== 'string') {
      throw new MemoryFormationInferenceError('invalid_request', metadata);
    }
    const opts = options({}, this.config.threads, 'journal', call.options);
    let requestBody;
    try { requestBody = deepseekFormationRequest({ ...call, opts, model: configuredModel }); }
    catch { throw new MemoryFormationInferenceError('invalid_request', metadata); }
    let reservation;
    try {
      reservation = await this.post('reserve', {
        job_id: Number(job.id), claim_token: job.claim_token,
        input_tokens: formationInputTokenBound(requestBody), max_output_tokens: 260,
        cloud_available: typeof providers.deepseek?.formationGenerate === 'function' && providers.deepseek.available(),
        configured_model: configuredModel, local_model: localModel,
      });
    } catch { throw new MemoryFormationInferenceError('budget_unavailable', metadata); }
    if (['DEEPSEEK', 'LOCAL', 'OFF'].includes(reservation.mode)) this.mode = reservation.mode;
    Object.assign(metadata, { mode: reservation.mode || this.mode, provider: reservation.provider || null,
      configuredModel: safeModel(reservation.configured_model) || configuredModel,
      requestId: reservation.request_id || null });
    if (reservation.execute !== true || !metadata.requestId) {
      throw new MemoryFormationInferenceError(safeReason(reservation.reason, 'reservation_not_granted'), metadata);
    }
    if (this.seenReservations.has(metadata.requestId)) {
      throw new MemoryFormationInferenceError('already_reserved', metadata);
    }
    // The server is the durable replay authority. This bounded local guard also
    // prevents accidental repeated dispatch within the same runner lifetime.
    this.seenReservations.add(metadata.requestId);
    if (this.seenReservations.size > 4096) this.seenReservations.delete(this.seenReservations.values().next().value);
    const started = Date.now();
    let generated, failure = null;
    try {
      if (signal?.aborted) throw new MemoryFormationInferenceError('cancelled', metadata);
      if (metadata.mode === 'LOCAL' && metadata.provider === 'ollama') {
        if (typeof localGenerate !== 'function') throw new MemoryFormationInferenceError('provider_unavailable', metadata);
        const local = await localGenerate({ ...call, senderFormationLocal: true });
        generated = typeof local === 'string' ? { text: local, model: localModel } : local;
      } else if (metadata.mode === 'DEEPSEEK' && metadata.provider === 'deepseek') {
        if (!providers.deepseek.available()) throw new MemoryFormationInferenceError('credentials_missing', metadata);
        if (metadata.configuredModel !== configuredModel) throw new MemoryFormationInferenceError('provider_error', metadata);
        generated = await providers.deepseek.formationGenerate({ ...call, opts, signal, model: configuredModel });
      } else throw new MemoryFormationInferenceError('provider_error', metadata);
      if (!generated || generated.ok === false || typeof generated.text !== 'string') {
        throw new MemoryFormationInferenceError(safeReason(generated?.reason), metadata);
      }
      metadata.actualModel = safeModel(generated.model);
      if (signal?.aborted) throw new MemoryFormationInferenceError('cancelled', metadata);
    } catch (error) {
      const reason = error.memoryFailureReason || (error.name === 'TimeoutError' ? 'timeout'
        : signal?.aborted || error.name === 'AbortError' ? 'cancelled' : 'transport_failure');
      failure = new MemoryFormationInferenceError(reason, metadata);
    }
    const usage = measuredUsage(generated?.stats);
    let settled;
    try {
      settled = await this.post('settle', { request_id: metadata.requestId, job_id: Number(job.id),
        claim_token: job.claim_token, actual_model: metadata.actualModel,
        status: failure ? failure.reason === 'cancelled' ? 'cancelled' : 'failed' : 'generated',
        reason: failure?.reason || 'generated', usage, latency_ms: Math.max(0, Date.now() - started) });
    } catch { throw new MemoryFormationInferenceError('accounting_unavailable', metadata); }
    if (failure) throw failure;
    if (generated.stats && settled.cost_gbp != null && settled.cost_usd != null) {
      generated.stats.cost = { gbp: settled.cost_gbp, usd: settled.cost_usd };
    }
    return { text: generated.text, ...metadata, stats: generated.stats || null };
  }
}
