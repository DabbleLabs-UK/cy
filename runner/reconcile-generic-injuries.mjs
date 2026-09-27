// reconcile-generic-injuries.mjs
//
// One-shot, idempotent retirement of injuries created by the removed generic
// per-tick injury producer (Math.random() < 0.0006 -> the bare 'minor_injury'
// archetype, with zero grounding). Every entry it ever created has
// bodySite/laterality/injuryType/mechanism all UNKNOWN - since no other code
// path in the runner has ever set world.somatic facts, this signature is an
// exact, unambiguous fingerprint of the unsupported producer, not a heuristic.
//
// A retired entry is REMOVED from the current injuries{} ledger (so it no
// longer counts as an active injury) but every historical somatic event
// record in history[] is left completely untouched - the fact that the
// system once made this claim remains true and provenanced; only the CURRENT
// grounded-state claim ("this is presently an active injury") is withdrawn.
// stimuli{} is also untouched (the producer never populated it).
//
// A genuinely grounded injury (any real body site, laterality, injury type or
// mechanism) is NEVER touched, active or resolved, by this tool.
//
// Usage:
//   node reconcile-generic-injuries.mjs <path/to/vitals.json>            # dry-run (default)
//   node reconcile-generic-injuries.mjs <path/to/vitals.json> --apply    # write (backs up first)
//   node reconcile-generic-injuries.mjs <path/to/vitals.json> --apply --no-backup

import { cp, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadVitals, saveVitals } from './vitals.js';
import { createSomaticState } from './somatic-nociceptive-substrate.js';

// The exact fingerprint of an injury created by the removed generic producer:
// every descriptive field is UNKNOWN. Any real grounding on any one of these
// fields means this is not that producer's output, and must never be touched.
export function isUnsupportedGenericInjury(injury) {
  return !!injury
    && injury.bodySite === 'UNKNOWN'
    && injury.laterality === 'UNKNOWN'
    && injury.injuryType === 'UNKNOWN'
    && injury.mechanism === 'UNKNOWN';
}

// Classify every entry in the current injuries ledger. Returns
// { retire: [ids], keep: [{id, reason}] } - keep always includes a reason so
// a human reviewing a dry-run can see exactly why each survivor was spared.
export function classifyInjuries(somaticState) {
  const injuries = (somaticState && somaticState.injuries) || {};
  const retire = [];
  const keep = [];
  for (const [id, injury] of Object.entries(injuries)) {
    if (injury.status === 'RESOLVED') {
      keep.push({ id, reason: 'already resolved' });
    } else if (isUnsupportedGenericInjury(injury)) {
      retire.push(id);
    } else {
      keep.push({ id, reason: 'has real grounding (not the removed producer\'s signature)' });
    }
  }
  return { retire, keep };
}

// Removes the classified unsupported entries from the CURRENT injuries
// ledger only. stimuli and history are untouched. Idempotent: injuries
// already retired (absent) are simply not found again on a second run.
export function retireGenericInjuries(vitals, { classification } = {}) {
  const state = (vitals.cognition && vitals.cognition.somaticNociceptive) || createSomaticState();
  const plan = classification || classifyInjuries(state);
  for (const id of plan.retire) delete state.injuries[id];
  if (!vitals.cognition) vitals.cognition = {};
  vitals.cognition.somaticNociceptive = state;
  return plan;
}

async function main(argv) {
  const args = argv.slice(2);
  const path = args.find((a) => !a.startsWith('--'));
  const apply = args.includes('--apply');
  const backup = !args.includes('--no-backup');
  if (!path) {
    console.error('usage: node reconcile-generic-injuries.mjs <vitals.json> [--apply] [--no-backup]');
    process.exit(2);
  }

  const vitals = await loadVitals(path);
  const state = (vitals.cognition && vitals.cognition.somaticNociceptive) || createSomaticState();
  const plan = classifyInjuries(state);
  const historyLengthBefore = (state.history || []).length;
  const stimuliCountBefore = Object.keys(state.stimuli || {}).length;

  console.log(`# Generic injury reconciliation (${apply ? 'APPLY' : 'DRY-RUN'})`);
  console.log(`checkpoint: ${path}`);
  console.log(`  total injuries in ledger : ${Object.keys(state.injuries || {}).length}`);
  console.log(`  to retire (unsupported)  : ${plan.retire.length}`);
  for (const id of plan.retire) console.log(`    - ${id}`);
  console.log(`  to keep                  : ${plan.keep.length}`);
  for (const item of plan.keep) console.log(`    - ${item.id} (${item.reason})`);
  console.log(`  history entries (untouched, before and after): ${historyLengthBefore}`);
  console.log(`  stimuli entries (untouched, before and after): ${stimuliCountBefore}`);

  if (!apply) {
    console.log('  dry-run: no changes written. Re-run with --apply to persist.');
    return;
  }

  if (backup) {
    const stateDir = dirname(path);
    const backupDir = `${stateDir}.pre-generic-injury-reconcile.${Date.now()}`;
    await cp(stateDir, backupDir, { recursive: true });
    const info = await stat(backupDir);
    if (!info.isDirectory()) throw new Error(`backup did not produce a directory: ${backupDir}`);
    console.log(`  backup written: ${backupDir}`);
  }

  retireGenericInjuries(vitals, { classification: plan });
  await saveVitals(path, vitals);

  const historyAfter = (vitals.cognition.somaticNociceptive.history || []).length;
  const stimuliAfter = Object.keys(vitals.cognition.somaticNociceptive.stimuli || {}).length;
  if (historyAfter !== historyLengthBefore) throw new Error('history was modified - refusing to report success');
  if (stimuliAfter !== stimuliCountBefore) throw new Error('stimuli were modified - refusing to report success');
  console.log('  saved reconciled checkpoint. History and stimuli are unchanged (provenance preserved).');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] && process.argv[1].endsWith('reconcile-generic-injuries.mjs')) {
  main(process.argv).catch((error) => {
    console.error(error && error.stack || error);
    process.exit(1);
  });
}
