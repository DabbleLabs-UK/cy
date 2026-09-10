// soma-cycle.js - the pre-language boundary shared by live generation paths.
// Every relevant generation calls this after lived inputs have been observed and
// before a prompt is built, so action selection and compact context are from the
// same Soma state transition.

export function prepareSomaGeneration(soma, options = {}) {
  const { inputs = null, ...actionOptions } = options;
  if (inputs) soma.tick(inputs);
  const action = soma.chooseAction(actionOptions);
  return {
    action,
    directive: soma.directive(),
  };
}
