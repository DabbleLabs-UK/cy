// Exact reviewed location-only delta for earlier byte-pinning regressions.
// journal-cell-publication.test.js separately pins this against production.
export function beforeJournalCellPublication(source) {
  return source
    .replace("    // A prompt's CELL snapshot does not license later publication elsewhere.\n"
      + '    // Keep this journal-only; truthful inference/accounting still survives.\n'
      + '    function journalLocationResult(result) {\n'
      + "      if (mode !== 'journal' || vitals.locationRegime.current.id === LOCATIONS.CELL) return result;\n"
      + "      recordInferenceOutcome(result.requestId, 'rejected-journal-location');\n"
      + "      return { ...result, full: '', repeat: false, aborted: true,\n"
      + "        abortReason: 'JOURNAL_LOCATION_CHANGED', journalLocationRejected: true };\n"
      + '    }\n\n', '')
    .replace('journalLocationResult(await collectCandidateBody(candidatePrompt, { repair }, ac))',
      'await collectCandidateBody(candidatePrompt, { repair }, ac)')
    .replace('return journalLocationResult({ ...guarded, full: accounted.out, repeat: true });',
      'return { ...guarded, full: accounted.out, repeat: true };')
    .replace("      // No await between this live read and publishChunk's synchronous emit.\n"
      + '      const locationChecked = journalLocationResult(guarded);\n'
      + '      if (locationChecked.journalLocationRejected) {\n'
      + '        for (const result of attempts) await recordSpend(result.stats, mode, false);\n'
      + '        return locationChecked;\n'
      + '      }\n', '');
}
