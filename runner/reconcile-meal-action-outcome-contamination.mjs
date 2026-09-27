// reconcile-meal-action-outcome-contamination.mjs
//
// One-shot, idempotent retirement of action-outcome-contingency (learned
// controllability) entries fabricated by the now-fixed scheduled-meal
// producer (environment.js's chooseMealEvent). That producer rolled a random
// meal outcome (eaten/partial/missed/refused) FIRST, then relabelled the
// outcome as an apparent EXECUTED accept_meal/refuse_meal action_opportunity
// - reversing causality. action-outcome-contingency.js then learned an
// action-conditioned Beta posterior from it, manufacturing evidence such as
// "accepting the meal prevents deprivation" even though the outcome existed
// before the label.
//
// Every meal-derived entry carries a stable, exact, unambiguous fingerprint:
// its opportunityId is 'meal:<mealId>' and its contextId is 'meal:<label>'.
// No other producer in the codebase has ever used a 'meal:' prefix for
// either identity - the only other opportunity producer is
// instrumental-agency.js, whose contextId shape is always
// '<contextFamily>:<contextType>:<actorKey>' (custody:*, social:*), never
// 'meal:*'. This is confirmed empirically against production data: every
// single pairs/history/opportunityHistory entry with a 'meal:'-prefixed
// context or opportunity ID is unambiguously meal-derived, and no genuine
// instrumental entry has ever used that prefix.
//
// A retired entry is REMOVED from the current pairs{}/opportunities{}
// ledgers, opportunityHistory[] and resolvedOpportunityIds[], and from the
// history[] trial-update log. This tool does not touch feeding-homeostasis
// or physiological-satiety state at all - the original meal/world facts and
// their own history remain completely untouched; only the action-outcome
// substrate's fabricated derived evidence is corrected.
//
// Usage:
//   node reconcile-meal-action-outcome-contamination.mjs <path/to/vitals.json>            # dry-run (default)
//   node reconcile-meal-action-outcome-contamination.mjs <path/to/vitals.json> --apply    # write (backs up first)
//   node reconcile-meal-action-outcome-contamination.mjs <path/to/vitals.json> --apply --no-backup

import { cp, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadVitals, saveVitals } from './vitals.js';
import { createControllabilityState } from './action-outcome-contingency.js';

const MEAL_PREFIX = 'meal:';

export function isMealDerivedContextId(contextId) {
  return typeof contextId === 'string' && contextId.startsWith(MEAL_PREFIX);
}

export function isMealDerivedOpportunityId(opportunityId) {
  return typeof opportunityId === 'string' && opportunityId.startsWith(MEAL_PREFIX);
}

// Classifies the full controllability ledger. Returns the ids/keys to retire
// from each collection, never mutating anything.
export function classifyControllability(state) {
  const pairs = (state && state.pairs) || {};
  const opportunities = (state && state.opportunities) || {};
  const opportunityHistory = (state && state.opportunityHistory) || [];
  const resolvedOpportunityIds = (state && state.resolvedOpportunityIds) || [];
  const history = (state && state.history) || [];

  const retirePairKeys = Object.keys(pairs).filter((key) => isMealDerivedContextId(pairs[key].contextId));
  const retireOpportunityIds = Object.keys(opportunities)
    .filter((id) => isMealDerivedOpportunityId(opportunities[id].opportunityId));
  const retireOpportunityHistoryCount = opportunityHistory
    .filter((item) => isMealDerivedOpportunityId(item.opportunityId)).length;
  const retireResolvedIds = resolvedOpportunityIds.filter(isMealDerivedOpportunityId);
  const retireHistoryCount = history.filter((item) => isMealDerivedContextId(item.contextId)).length;

  return {
    retirePairKeys,
    retireOpportunityIds,
    retireOpportunityHistoryCount,
    retireResolvedIds,
    retireHistoryCount,
    keptPairCount: Object.keys(pairs).length - retirePairKeys.length,
    keptOpportunityHistoryCount: opportunityHistory.length - retireOpportunityHistoryCount,
    keptHistoryCount: history.length - retireHistoryCount,
  };
}

// Applies the classification to the CURRENT state only. Idempotent: entries
// already retired (absent) are simply not found again on a second run.
export function retireMealActionOutcomeContamination(vitals, { classification } = {}) {
  const state = (vitals.cognition && vitals.cognition.learnedControllability) || createControllabilityState();
  const plan = classification || classifyControllability(state);

  const retirePairKeySet = new Set(plan.retirePairKeys);
  for (const key of retirePairKeySet) delete state.pairs[key];

  const retireOpportunityIdSet = new Set(plan.retireOpportunityIds);
  for (const id of retireOpportunityIdSet) delete state.opportunities[id];

  state.opportunityHistory = state.opportunityHistory.filter(
    (item) => !isMealDerivedOpportunityId(item.opportunityId),
  );
  state.resolvedOpportunityIds = state.resolvedOpportunityIds.filter(
    (id) => !isMealDerivedOpportunityId(id),
  );
  state.history = state.history.filter((item) => !isMealDerivedContextId(item.contextId));

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
    console.error('usage: node reconcile-meal-action-outcome-contamination.mjs <vitals.json> [--apply] [--no-backup]');
    process.exit(2);
  }

  const vitals = await loadVitals(path);
  const state = (vitals.cognition && vitals.cognition.learnedControllability) || createControllabilityState();
  const plan = classifyControllability(state);

  console.log(`# Meal action-outcome contamination reconciliation (${apply ? 'APPLY' : 'DRY-RUN'})`);
  console.log(`checkpoint: ${path}`);
  console.log(`  total pairs               : ${Object.keys(state.pairs || {}).length}`);
  console.log(`  meal-derived pairs to retire: ${plan.retirePairKeys.length}`);
  for (const key of plan.retirePairKeys) console.log(`    - ${key}`);
  console.log(`  genuine pairs kept        : ${plan.keptPairCount}`);
  console.log(`  total opportunityHistory  : ${(state.opportunityHistory || []).length}`);
  console.log(`  meal-derived to retire    : ${plan.retireOpportunityHistoryCount}`);
  console.log(`  genuine kept              : ${plan.keptOpportunityHistoryCount}`);
  console.log(`  total trial-update history: ${(state.history || []).length}`);
  console.log(`  meal-derived to retire    : ${plan.retireHistoryCount}`);
  console.log(`  genuine kept              : ${plan.keptHistoryCount}`);
  console.log(`  meal-derived resolvedOpportunityIds to retire: ${plan.retireResolvedIds.length}`);
  console.log(`  meal-derived current (unresolved) opportunities to retire: ${plan.retireOpportunityIds.length}`);

  if (!apply) {
    console.log('  dry-run: no changes written. Re-run with --apply to persist.');
    return;
  }

  if (backup) {
    const stateDir = dirname(path);
    const backupDir = `${stateDir}.pre-meal-action-outcome-reconcile.${Date.now()}`;
    await cp(stateDir, backupDir, { recursive: true });
    const info = await stat(backupDir);
    if (!info.isDirectory()) throw new Error(`backup did not produce a directory: ${backupDir}`);
    console.log(`  backup written: ${backupDir}`);
  }

  retireMealActionOutcomeContamination(vitals, { classification: plan });
  await saveVitals(path, vitals);
  console.log('  saved reconciled checkpoint. feeding-homeostasis and physiological-satiety are untouched.');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] && process.argv[1].endsWith('reconcile-meal-action-outcome-contamination.mjs')) {
  main(process.argv).catch((error) => {
    console.error(error && error.stack || error);
    process.exit(1);
  });
}
