// Exact diagnostic-only deltas, for earlier byte-pinning regression tests.
// The telemetry suite separately pins the whole runtime diff to these strings.
export function beforeJournalTerminationTelemetry(source) {
  return source
    .replace("import { recordJournalTerminationDiagnostic } from './journal-termination-telemetry.js';\n", '')
    .replace("        if (requestPurpose === 'journal') recordJournalTerminationDiagnostic(recordInferenceDiagnostic,\n          { id: lease.id, stats, provider: provider.id });\n", '')
    .replace('requireCompletion = false, retainTerminationSource = false', 'requireCompletion = false')
    .replace('      ...(retainTerminationSource ? { provider_finish_reason_reported: !!finishReason } : {}),\n', '')
    .replace("          retainTerminationSource: purpose === 'journal',\n", '');
}
