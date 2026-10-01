// soma-cycle.js - the pre-language boundary shared by live generation paths.
// Every relevant generation calls this after lived inputs have been observed and
// before a prompt is built. Only grounded context crosses the live boundary.
// Legacy provisional retrieval remains available through explicit Soma runtime
// diagnostic methods, not as part of every live generation.

export function prepareSomaGeneration(soma, options = {}) {
  const { inputs = null, now = Date.now() } = options;
  if (inputs) soma.tick(inputs);
  const grounded = soma.groundedDirective({ now });
  return {
    groundedContext: grounded.context,
    groundedDirective: grounded.directive,
  };
}
