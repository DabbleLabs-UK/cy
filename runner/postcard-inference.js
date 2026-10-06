// Postcard-only admission and accounting. The server owns reservations and reply
// identity; an ambiguous response never authorizes another paid request.
import { validateCharacterCandidate } from './character-output.js';
import { normalizeWakingProse } from './warden.js';

export function postcardInputTokenBound(system, prompt) {
  // A token cannot require less than one UTF-8 byte. Include role/template
  // overhead rather than using an optimistic English characters/token ratio.
  return Buffer.byteLength(String(system || '') + String(prompt || ''), 'utf8') + 256;
}

export function validatePostcardCandidate(raw) {
  const original = validateCharacterCandidate(raw);
  if (!String(raw || '').trim() || !normalizeWakingProse(raw).trim()) {
    return { ok: false, reasons: ['empty postcard reply'] };
  }
  return original.ok ? validateCharacterCandidate(normalizeWakingProse(raw)) : original;
}

export function postcardMayFallback(result) {
  if (result.postcardAmbiguous) return false;
  if (!result.error || result.characterDiscarded || result.characterValidation?.repairAttempted) return false;
  if (!result.accountingError) return true;
  // Explicit admission denial is different from an ambiguous acknowledgement.
  return /^(?:cloud_disabled|local_selected|concurrency_full|(?:hour|day|month)_(?:request|spend)_cap)$/.test(result.holdReason || '');
}

// A repair interrupted by the world is still an interruption, even if the
// character boundary also marks that unfinished repair as discarded.
export function postcardFailureClass(result = {}) {
  const admissionHold = /^(?:cloud_disabled|local_selected|concurrency_full|(?:hour|day|month)_(?:request|spend)_cap)$/.test(result.holdReason || '');
  if (result.postcardAmbiguous || (result.accountingError && !admissionHold)) return 'ambiguous';
  if (result.aborted || result.error || result.holdReason) return 'temporary';
  return result.characterDiscarded || result.refused ? 'quality' : 'temporary';
}

export function postcardAttemptStatus(result, { provider, dispatched }) {
  if (!dispatched) return 'not_sent';
  if (provider === 'deepseek' && (result.aborted || result.error)
      && !result.definitiveProviderRejection) return 'unknown';
  if (result.aborted) return 'aborted';
  if (result.error) return 'provider_error';
  if (result.refused) return 'refused';
  return validatePostcardCandidate(result.candidate || '').ok ? 'generated' : 'validation_rejected';
}

export class PostcardInference {
  constructor(config, { fetchImpl = fetch } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async post(action, data) {
    const response = await this.fetch(`${this.config.apiBase}/api/postcard-inference.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Cy-Key': this.config.ingestKey },
      body: JSON.stringify({ action, ...data }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`postcard accounting HTTP ${response.status}`);
    const result = await response.json();
    if (!result || result.ok !== true) throw new Error('postcard accounting unavailable');
    return result;
  }

  async route(pc, providers) {
    if (this.config.dryRun) return { execute: true, provider: 'ollama', route: 'LOCAL', reason: 'dry_run' };
    return this.post('route', {
      postcard_id: pc.id,
      claim_generation: pc.claim_generation,
      cloud_available: providers.deepseek.available(), cloud_healthy: true,
      model: providers.deepseek.model, local_model: providers.ollama.modelFor('postcard'),
    });
  }

  turn(pc, route) { return new PostcardInferenceTurn(this, pc.id, route, pc.claim_generation); }
}

export class PostcardInferenceTurn {
  constructor(client, postcardId, route, claimGeneration) {
    this.client = client;
    this.postcardId = postcardId;
    this.route = route;
    this.reservation = null;
    this.started = 0;
    this.claimGeneration = claimGeneration;
    this.dispatched = false;
    this.ambiguous = false;
  }

  async beforeRequest({ system, prompt, opts, repair, provider }) {
    if (this.client.config.dryRun) return;
    if (!Number.isInteger(opts.num_predict) || opts.num_predict < 1 || opts.num_predict > 4096) {
      throw new Error('postcard output bound required');
    }
    const reservation = await this.client.post('reserve', {
      postcard_id: this.postcardId, provider: provider.id,
      claim_generation: this.claimGeneration,
      model: provider.modelFor('postcard'), attempt: repair ? 'repair' : 'initial',
      input_tokens: postcardInputTokenBound(system, prompt), max_output_tokens: opts.num_predict,
    });
    if (!reservation.execute) {
      const error = new Error('postcard request held');
      error.postcardHold = reservation.reason || 'reservation_not_granted';
      throw error;
    }
    this.reservation = reservation;
    this.started = Date.now();
    this.dispatched = false;
  }

  markDispatched() { this.dispatched = true; }

  async afterCandidate(result) {
    if (!this.reservation || this.client.config.dryRun) return;
    const reservation = this.reservation;
    const status = postcardAttemptStatus(result, {
      provider: this.route.provider, dispatched: this.dispatched,
    });
    if (status === 'unknown') {
      this.ambiguous = true;
      result.postcardAmbiguous = true;
    }
    const validation = validatePostcardCandidate(result.candidate || '');
    const stats = result.stats;
    const usage = status === 'not_sent' ? { prompt_tokens: 0, completion_tokens: 0 }
      : stats && stats.usage_reported !== false && (stats.usage || (Number.isFinite(stats.prompt_eval_count)
      && Number.isFinite(stats.eval_count) ? {
        prompt_tokens: stats.prompt_eval_count, completion_tokens: stats.eval_count,
      } : null));
    const settled = await this.client.post('settle', {
      request_id: reservation.request_id,
      status,
      definitive_provider_rejection: result.definitiveProviderRejection === true,
      usage: usage || null,
      latency_ms: Math.max(0, Date.now() - this.started),
      validation_failure: validation.ok ? null : validation.reasons.join('; ').slice(0, 240),
      provider_error: result.error ? 'transport_or_http_error' : null,
    });
    // Use the reservation's authoritative price calculation for the existing
    // meter too; never combine this feature with the old runner price table.
    if (stats && settled.cost_gbp != null && settled.cost_usd != null) {
      stats.cost = { gbp: settled.cost_gbp, usd: settled.cost_usd };
    }
    this.reservation = null;
  }

  async fallback(reason) {
    if (this.route.route !== 'AUTO' || this.route.provider !== 'deepseek') return false;
    if (this.ambiguous) return false;
    const result = await this.client.post('fallback', {
      postcard_id: this.postcardId, claim_generation: this.claimGeneration, reason,
    });
    if (!result.execute) return false;
    this.route = { ...this.route, provider: 'ollama' };
    return true;
  }

  async outcome(status, reason = null) {
    if (this.client.config.dryRun) return;
    const result = await this.client.post('outcome', {
      postcard_id: this.postcardId, claim_generation: this.claimGeneration, status, reason,
    });
    if (result.execute !== true) throw new Error('postcard outcome not accepted');
    return result;
  }
}
