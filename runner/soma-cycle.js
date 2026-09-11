// soma-cycle.js - the pre-language boundary shared by live generation paths.
// Every relevant generation calls this after lived inputs have been observed and
// before a prompt is built, so action selection and compact context are from the
// same Soma state transition.

export function prepareSomaGeneration(soma, options = {}) {
  const { inputs = null, ...actionOptions } = options;
  if (inputs) soma.tick(inputs);
  const action = soma.chooseAction(actionOptions);
  const grounded = soma.groundedDirective({ now: actionOptions.now });
  const provisionalDirective = soma.provisionalDirective();
  return {
    action,
    groundedContext: grounded.context,
    groundedDirective: grounded.directive,
    provisionalDirective,
    // Compatibility alias for inspectors/tests that have not moved to the
    // explicitly named provisional field yet.
    directive: provisionalDirective,
  };
}
