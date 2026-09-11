// soma-cycle.js - the pre-language boundary shared by live generation paths.
// Every relevant generation calls this after lived inputs have been observed and
// before a prompt is built, so factual context and separately labelled provisional
// memory are from the same Soma state transition. Expressive choice happens after
// this boundary and is not a Soma calculation.

export function prepareSomaGeneration(soma, options = {}) {
  const { inputs = null, now = Date.now() } = options;
  if (inputs) soma.tick(inputs);
  const grounded = soma.groundedDirective({ now });
  const provisionalDirective = soma.provisionalDirective();
  return {
    groundedContext: grounded.context,
    groundedDirective: grounded.directive,
    provisionalDirective,
    provisionalMemoryCandidate: soma.provisionalMemoryCandidate(),
    // Compatibility alias for inspectors/tests that have not moved to the
    // explicitly named provisional field yet.
    directive: provisionalDirective,
  };
}
