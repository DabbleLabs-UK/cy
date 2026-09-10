// A silence event describes a completed span. Its event timestamp is added by
// Client.enqueue after the wait, so viewers can safely treat that timestamp as
// the end of the span and derive the start by subtracting payload.seconds.
export async function recordCompletedSilence(seconds, { idle, emit, reason = '', now = Date.now } = {}) {
  if (typeof idle !== 'function') throw new TypeError('idle is required');
  if (typeof emit !== 'function') throw new TypeError('emit is required');

  const plannedSeconds = Math.max(0, Number(seconds) || 0);
  if (!plannedSeconds) return 0;

  const startedAt = Number(now());
  await idle(plannedSeconds * 1000);
  const elapsedSeconds = Math.max(0, Math.floor((Number(now()) - startedAt) / 1000));
  if (!elapsedSeconds) return 0;

  const payload = { seconds: elapsedSeconds };
  if (reason) payload.reason = String(reason);
  emit({ kind: 'silence', payload });
  return elapsedSeconds;
}
