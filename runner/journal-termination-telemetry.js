import { journalTerminationEvidence } from './character-output.js';

// Diagnostic only: never infer a finish reason from token counts or prose.
export function journalTerminationClass(stats, provider) {
  if (!stats || stats.done !== true) return 'unknown';
  if (provider !== 'ollama' && provider !== 'deepseek') return 'unknown';
  const nativeReason = provider === 'ollama' ? stats.done_reason : stats.finish_reason;
  if (typeof nativeReason !== 'string' || !nativeReason.trim()) return 'unknown';
  // The legacy DeepSeek adapter supplies a fallback stop. It is not evidence
  // that the provider actually reported normal completion.
  if (provider === 'deepseek' && stats.provider_finish_reason_reported !== true) return 'unknown';
  const { reason, explicitLength } = journalTerminationEvidence(stats);
  if (reason !== nativeReason.trim().toLowerCase()) return 'unknown';
  if (explicitLength) return 'length';
  if (reason === 'stop') return 'stop';
  if (provider === 'deepseek' && ['content_filter', 'tool_calls', 'insufficient_system_resource'].includes(reason)) return 'other';
  return 'unknown';
}

// Reuse the private request ledger, with no candidate, prompt or raw payload.
// Both synchronous sinks and asynchronous persistence failures are best-effort.
export function recordJournalTerminationDiagnostic(record, { id, stats, provider }) {
  try {
    const result = record({ event: 'journal-termination', id,
      at: new Date().toISOString(), termination: journalTerminationClass(stats, provider) });
    Promise.resolve(result).catch(() => {});
  } catch { /* Diagnostics must never alter generation or publication. */ }
}
