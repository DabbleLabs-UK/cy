// reconcile-instrumental-round-robin-contamination.mjs
//
// One-shot, idempotent retirement of action-outcome-contingency (learned
// controllability) entries fabricated by instrumental-agency.js's engineering
// round-robin instrumental incidents (officer_order, cell_search_handover,
// inmate_check_in, inmate_social_approach, inmate_provocation). Those
// incidents presented authored alternative actions, selected one using
// engineering round-robin state (INSTRUMENTAL_ACTION_SELECTION =
// ENGINEERING_ROUND_ROBIN_NOT_PSYCHOLOGICAL, not a Cy/model chooser), and
// asserted the selected branch as an EXECUTED action_opportunity -
// misrepresenting an engineering branch as an enacted choice. The now-fixed
// producer no longer asserts world.action_opportunity for these incidents at
// all; this tool retires the evidence it already produced before the fix.
//
// Every instrumental-derived contextId has the stable shape
// '<contextFamily>:<contextType>:<actorKey>', where contextType is one of
// the five values instrumentalOpportunityDefinitions() actually declares.
// This is an exact, unambiguous fingerprint: confirmed empirically against
// production data that, after the prior meal-action-outcome reconciliation,
// every single remaining pairs/opportunityHistory/history entry matched one
// of these five contextType values with zero unexplained entries - i.e.
// there is currently no OTHER producer of action-outcome-contingency
// evidence in this codebase at all (matching the audit finding that no
// genuine Cy/model chooser exists yet).
//
// A retired entry is REMOVED from the current pairs{}/opportunities{}
// ledgers, opportunityHistory[], resolvedOpportunityIds[] and history[]. This
// tool does not touch the underlying world-event/incident history, defensive
// context, threat learning, social contact or feeding state at all - only
// the controllability substrate's fabricated derived evidence is corrected.
// If a future genuine agent/model chooser populates world.action_opportunity
// with a DIFFERENT contextType, its evidence is left completely untouched.
//
// Usage:
//   node reconcile-instrumental-round-robin-contamination.mjs <path/to/vitals.json>            # dry-run (default)
//   node reconcile-instrumental-round-robin-contamination.mjs <path/to/vitals.json> --apply    # write (backs up first)
//   node reconcile-instrumental-round-robin-contamination.mjs <path/to/vitals.json> --apply --no-backup

import { cp, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadVitals, saveVitals } from './vitals.js';
import { createControllabilityState } from './action-outcome-contingency.js';
import { instrumentalOpportunityDefinitions } from './instrumental-agency.js';

const ROUND_ROBIN_CONTEXT_TYPES = new Set(instrumentalOpportunityDefinitions().map((def) => def.contextType));

export function isRoundRobinContextId(contextId) {
  if (typeof contextId !== 'string') return false;
  const parts = contextId.split(':');
  return parts.length === 3 && ROUND_ROBIN_CONTEXT_TYPES.has(parts[1]);
}

export function isRoundRobinOpportunityId(opportunityId) {
  // Instrumental opportunity IDs are 'instrumental:<uuid>' with no context
  // information of their own; opportunityHistory/resolvedOpportunityIds
  // entries are classified by their paired contextId instead (see below).
  return typeof opportunityId === 'string' && opportunityId.startsWith('instrumental:');
}

// Classifies the full controllability ledger. Returns the ids/keys to retire
// from each collection, never mutating anything.
export function classifyInstrumentalControllability(state) {
  const pairs = (state && state.pairs) || {};
  const opportunities = (state && state.opportunities) || {};
  const opportunityHistory = (state && state.opportunityHistory) || [];
  const resolvedOpportunityIds = (state && state.resolvedOpportunityIds) || [];
  const history = (state && state.history) || [];

  const retirePairKeys = Object.keys(pairs).filter((key) => isRoundRobinContextId(pairs[key].contextId));

  // opportunityHistory/opportunities/resolvedOpportunityIds don't carry a
  // stable per-opportunity contextType prefix on the opportunityId itself
  // (unlike meal:<mealId>), so classify by the paired contextId instead -
  // the same contextId shape every one of these opportunities always has.
  const retireOpportunityIds = Object.keys(opportunities)
    .filter((id) => isRoundRobinContextId(opportunities[id].contextId));
  const retireOpportunityHistoryCount = opportunityHistory
    .filter((item) => isRoundRobinContextId(item.contextId)).length;
  const roundRobinOpportunityIdSet = new Set(
    opportunityHistory.filter((item) => isRoundRobinContextId(item.contextId)).map((item) => item.opportunityId),
  );
  const retireResolvedIds = resolvedOpportunityIds.filter((id) => roundRobinOpportunityIdSet.has(id));
  const retireHistoryCount = history.filter((item) => isRoundRobinContextId(item.contextId)).length;

  return {
    retirePairKeys,
    retireOpportunityIds,
    retireOpportunityHistoryCount,
    roundRobinOpportunityIdSet,
    retireResolvedIds,
    retireHistoryCount,
    keptPairCount: Object.keys(pairs).length - retirePairKeys.length,
    keptOpportunityHistoryCount: opportunityHistory.length - retireOpportunityHistoryCount,
    keptHistoryCount: history.length - retireHistoryCount,
  };
}

// Applies the classification to the CURRENT state only. Idempotent: entries
// already retired (absent) are simply not found again on a second run.
export function retireInstrumentalRoundRobinContamination(vitals, { classification } = {}) {
  const state = (vitals.cognition && vitals.cognition.learnedControllability) || createControllabilityState();
  const plan = classification || classifyInstrumentalControllability(state);

  for (const key of plan.retirePairKeys) delete state.pairs[key];
  for (const id of plan.retireOpportunityIds) delete state.opportunities[id];

  state.opportunityHistory = state.opportunityHistory.filter(
    (item) => !isRoundRobinContextId(item.contextId),
  );
  const retireIdSet = new Set(plan.retireResolvedIds);
  state.resolvedOpportunityIds = state.resolvedOpportunityIds.filter((id) => !retireIdSet.has(id));
  state.history = state.history.filter((item) => !isRoundRobinContextId(item.contextId));

  if (!vitals.cognition) vitals.cognition = {};
  vitals.cognition.learnedControllability = state;
  return plan;
}

async function main(argv) {
  const args = argv.slice(2);
  const path = args.find((a) => !a.startsWith('--'));
  const apply = args.includes('--apply');
  const backup = !args.includes('--no-backup');
  if (!path) {
    console.error('usage: node reconcile-instrumental-round-robin-contamination.mjs <vitals.json> [--apply] [--no-backup]');
    process.exit(2);
  }

  const vitals = await loadVitals(path);
  const state = (vitals.cognition && vitals.cognition.learnedControllability) || createControllabilityState();
  const plan = classifyInstrumentalControllability(state);

  console.log(`# Instrumental round-robin contamination reconciliation (${apply ? 'APPLY' : 'DRY-RUN'})`);
  console.log(`checkpoint: ${path}`);
  console.log(`  round-robin context types: ${[...ROUND_ROBIN_CONTEXT_TYPES].join(', ')}`);
  console.log(`  total pairs                : ${Object.keys(state.pairs || {}).length}`);
  console.log(`  round-robin-derived to retire: ${plan.retirePairKeys.length}`);
  console.log(`  genuine pairs kept         : ${plan.keptPairCount}`);
  if (plan.keptPairCount > 0) {
    console.log('  kept pair contextIds:');
    for (const key of Object.keys(state.pairs || {})) {
      if (!isRoundRobinContextId(state.pairs[key].contextId)) console.log(`    - ${key}`);
    }
  }
  console.log(`  total opportunityHistory   : ${(state.opportunityHistory || []).length}`);
  console.log(`  round-robin-derived to retire: ${plan.retireOpportunityHistoryCount}`);
  console.log(`  genuine kept               : ${plan.keptOpportunityHistoryCount}`);
  console.log(`  total trial-update history : ${(state.history || []).length}`);
  console.log(`  round-robin-derived to retire: ${plan.retireHistoryCount}`);
  console.log(`  genuine kept               : ${plan.keptHistoryCount}`);
  console.log(`  round-robin resolvedOpportunityIds to retire: ${plan.retireResolvedIds.length}`);
  console.log(`  round-robin current (unresolved) opportunities to retire: ${plan.retireOpportunityIds.length}`);

  if (!apply) {
    console.log('  dry-run: no changes written. Re-run with --apply to persist.');
    return;
  }

  if (backup) {
    const stateDir = dirname(path);
    const backupDir = `${stateDir}.pre-instrumental-round-robin-reconcile.${Date.now()}`;
    await cp(stateDir, backupDir, { recursive: true });
    const info = await stat(backupDir);
    if (!info.isDirectory()) throw new Error(`backup did not produce a directory: ${backupDir}`);
    console.log(`  backup written: ${backupDir}`);
  }

  retireInstrumentalRoundRobinContamination(vitals, { classification: plan });
  await saveVitals(path, vitals);
  console.log('  saved reconciled checkpoint. World-event/incident history is untouched.');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] && process.argv[1].endsWith('reconcile-instrumental-round-robin-contamination.mjs')) {
  main(process.argv).catch((error) => {
    console.error(error && error.stack || error);
    process.exit(1);
  });
}
