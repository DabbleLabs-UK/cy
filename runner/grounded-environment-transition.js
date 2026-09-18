// grounded-environment-transition.js - shared LIVE/REPLAY event transition seam.
//
// This module owns only the established grounded mutation order. It performs
// no persistence, clock reads, UI work, provider calls or world generation.

export const GROUNDED_ENVIRONMENT_TRANSITION_ORDER = Object.freeze([
  'feeding',
  'somatic_nociceptive',
  'social_contact',
  'action_outcome_contingency',
  'current_defensive_context',
  'threat_learning',
]);

export function observeEnvironmentRecord(soma, record) {
  if (!soma || !record) throw new TypeError('Soma target and environment record are required');
  return {
    feeding: soma.observeFeedingRecord(record),
    somatic_nociceptive: soma.observeSomaticRecord(record),
    social_contact: soma.observeSocialContactRecord(record),
    action_outcome_contingency: soma.observeControllabilityRecord(record),
    current_defensive_context: soma.observeCurrentDefensiveContextRecord(record),
    threat_learning: soma.observeThreatLearningRecord(record),
  };
}
