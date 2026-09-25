import { FISHER_MESSAGE_OBJECT_FIXTURES } from './fixtures/fisher-message-objects-20260925.js';
import { planLegacyMessageReconciliation } from './message-object-lifecycle.js';

const plans = planLegacyMessageReconciliation(FISHER_MESSAGE_OBJECT_FIXTURES);
for (const plan of plans) {
  const target = plan.targetObjectId ? ` -> ${plan.targetObjectId}` : '';
  process.stdout.write(`${plan.objectId}: ${plan.classification}${target}\n`);
  process.stdout.write(`  ${plan.reasons.join(', ')}\n`);
  if (plan.proposedMessage) {
    process.stdout.write(`  lifecycle=${plan.proposedMessage.lifecycleState}; read=${plan.proposedMessage.readState}; receiptObservedByCy=${plan.proposedMessage.receiptObservedByCy}; thread=${plan.proposedMessage.threadId || 'none'}\n`);
  }
}
