// Exact separately tested yard-only delta for older runtime byte-pin fixtures.
export function beforeYardContactTurn(source) {
  return source.replace(/^[ \t]*\/\/ YARD TURN BEGIN: ([^\n]+)\n[\s\S]*?^[ \t]*\/\/ YARD TURN END: \1\n(?:\n)?/gm, '')
    .replace('  await checkpointMeals();\n  const tickTimer', '  await checkpointMeals();\n\n  const tickTimer')
    .replace('timestampMs(b.endTimestamp || b.startTimestamp) - timestampMs(a.endTimestamp || a.startTimestamp)\n      || resolvedYardTurn(b) - resolvedYardTurn(a)',
      'timestampMs(b.endTimestamp || b.startTimestamp) - timestampMs(a.endTimestamp || a.startTimestamp)')
    .replace("const cancellationScope = ['meal_choice', 'yard_contact_choice'].includes(purpose) ? null",
      "const cancellationScope = purpose === 'meal_choice' ? null")
    .replace("hostLease.release(['meal_choice', 'yard_contact_choice'].includes(purpose) ? { timeoutMs: 5000 } : undefined)",
      "hostLease.release(purpose === 'meal_choice' ? { timeoutMs: 5000 } : undefined)")
    .replace("const mealTransactionActive = ['meal_choice', 'yard_contact_choice'].includes(generationCancellation.active('visible')?.purpose);",
      "const mealTransactionActive = generationCancellation.active('visible')?.purpose === 'meal_choice';")
    .replace("!['ambient_world_generation', 'meal_choice', 'yard_contact_choice'].includes(activeInferencePurpose)",
      "!['ambient_world_generation', 'meal_choice'].includes(activeInferencePurpose)");
}
