function normaliseReason(reason, fallback = 'ABORTED') {
  const value = String(reason || fallback).trim().toUpperCase().replace(/[^A-Z0-9_:-]+/g, '_');
  return value || fallback;
}

export class InferenceCancellationError extends Error {
  constructor(reason = 'ABORTED') {
    const code = normaliseReason(reason);
    super(code);
    this.name = 'AbortError';
    this.code = code;
  }
}

export function cancellationReason(value, fallback = 'ABORTED') {
  const reason = value && typeof value === 'object' && 'aborted' in value && 'reason' in value
    ? value.reason : value;
  if (reason && typeof reason.code === 'string') return normaliseReason(reason.code, fallback);
  if (typeof reason === 'string') return normaliseReason(reason, fallback);
  return normaliseReason(fallback);
}

export function cancellationError(value, fallback = 'ABORTED') {
  const reason = value && typeof value === 'object' && 'aborted' in value && 'reason' in value
    ? value.reason : value;
  if (reason instanceof InferenceCancellationError) return reason;
  return new InferenceCancellationError(cancellationReason(reason, fallback));
}

export function isInferenceCancellation(error) {
  return !!error && (error.name === 'AbortError' || error instanceof InferenceCancellationError);
}

export function abortWithReason(controller, reason = 'ABORTED') {
  if (!controller || controller.signal.aborted) return false;
  controller.abort(new InferenceCancellationError(reason));
  return true;
}

export class GenerationCancellationRegistry {
  constructor() {
    this.slots = new Map();
  }

  register(scope, controller, { purpose = null } = {}) {
    if (!scope || !controller) throw new Error('cancellation scope and controller are required');
    this.slots.set(scope, { controller, purpose });
    return controller;
  }

  clear(scope, controller = null) {
    const active = this.slots.get(scope);
    if (!active || (controller && active.controller !== controller)) return false;
    this.slots.delete(scope);
    return true;
  }

  has(scope) {
    const active = this.slots.get(scope);
    return !!active && !active.controller.signal.aborted;
  }

  active(scope) {
    return this.slots.get(scope) || null;
  }

  abort(scope, reason) {
    const active = this.slots.get(scope);
    return active ? abortWithReason(active.controller, reason) : false;
  }

  abortAll(reason, scopes = ['visible', 'awg']) {
    let aborted = false;
    for (const scope of scopes) aborted = this.abort(scope, reason) || aborted;
    return aborted;
  }
}
