// awg-health.js - observability for the ambient world generator.
//
// The world generator can collapse onto its cheapest branch: self-contained
// EVENTs that open no thread, touch no object and resolve themselves. When that
// happens the persistent-simulation substrate (threads, objects, message
// lifecycle, custody) stops being exercised even though it remains available.
// Nothing about that collapse is visible from a single run, so this module
// summarises the recent AWG run ledger into a few blunt, rolling health numbers.
//
// It reads only `worldSimulation.recentRuns` (the bounded ledger the generator
// already keeps) and is a pure function: no model calls, no persistence, no
// mutation. It is safe to call anywhere, including a dry-run rehearsal harness.
//
// "Durable" means an accepted candidate that actually changed persistent world
// state: it opened/updated/resolved a thread, or created/transferred/changed an
// object. A self-resolving thread-NONE event with no object is NOT durable.

const isAccepted = (run) => run && run.validationStatus === 'ACCEPTED';

function candidateFamily(run) {
  const c = run && run.candidateOutput;
  return c && typeof c.eventFamily === 'string' ? c.eventFamily.toUpperCase() : null;
}

function candidateThreadAction(run) {
  const c = run && run.candidateOutput;
  const action = c && c.thread && typeof c.thread.action === 'string'
    ? c.thread.action.toUpperCase() : null;
  return action || (c && c.decision === 'CONTINUATION' ? 'UPDATE' : 'NONE');
}

function candidateObjectCount(run) {
  const c = run && run.candidateOutput;
  return Array.isArray(c && c.objects) ? c.objects.length : 0;
}

// Did this accepted run actually move persistent world state?
export function runChangedDurableState(run) {
  if (!isAccepted(run)) return false;
  const threadChanged = Array.isArray(run.threadChanges) && run.threadChanges.length > 0;
  const objectTouched = candidateObjectCount(run) > 0;
  return threadChanged || objectTouched;
}

// Accepted candidates participants (for concentration).
function candidateParticipants(run) {
  const c = run && run.candidateOutput;
  return Array.isArray(c && c.participants) ? c.participants.filter(Boolean) : [];
}

// Trailing run count, newest-first, of ACCEPTED candidates that changed no
// durable state, stopping at the first durable change. NO_EVENT / REJECTED /
// CANCELLED runs are transparent: they neither extend nor break the streak,
// because the question is "how many world events have we accepted since one
// last mattered", not "how many times did the scheduler fire".
export function noDurableChangeStreak(stateValue) {
  const runs = Array.isArray(stateValue && stateValue.recentRuns) ? stateValue.recentRuns : [];
  let streak = 0;
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const run = runs[i];
    if (!isAccepted(run)) continue;
    if (runChangedDurableState(run)) break;
    streak += 1;
  }
  return streak;
}

function topShare(counts) {
  const values = Object.values(counts);
  const total = values.reduce((sum, n) => sum + n, 0);
  if (!total) return { total: 0, topKey: null, topShare: 0 };
  let topKey = null;
  let top = 0;
  for (const [key, n] of Object.entries(counts)) {
    if (n > top) { top = n; topKey = key; }
  }
  return { total, topKey, topShare: top / total };
}

// A compact rolling health snapshot over the recent run ledger.
export function awgHealthReport(stateValue) {
  const runs = Array.isArray(stateValue && stateValue.recentRuns) ? stateValue.recentRuns : [];
  const accepted = runs.filter(isAccepted);
  const outcomeCounts = {};
  for (const run of runs) {
    const key = run && run.validationStatus ? run.validationStatus : 'UNKNOWN';
    outcomeCounts[key] = (outcomeCounts[key] || 0) + 1;
  }
  const familyCounts = {};
  const threadActionCounts = {};
  const participantCounts = {};
  let durable = 0;
  let objectBearing = 0;
  for (const run of accepted) {
    const family = candidateFamily(run) || 'UNKNOWN';
    familyCounts[family] = (familyCounts[family] || 0) + 1;
    const action = candidateThreadAction(run);
    threadActionCounts[action] = (threadActionCounts[action] || 0) + 1;
    for (const participant of candidateParticipants(run)) {
      participantCounts[participant] = (participantCounts[participant] || 0) + 1;
    }
    if (runChangedDurableState(run)) durable += 1;
    if (candidateObjectCount(run) > 0) objectBearing += 1;
  }
  const family = topShare(familyCounts);
  const participant = topShare(participantCounts);
  return {
    runs: runs.length,
    accepted: accepted.length,
    outcomeCounts,
    durableChangeRate: accepted.length ? durable / accepted.length : 0,
    durableChanges: durable,
    objectBearingAccepted: objectBearing,
    threadActionCounts,
    familyCounts,
    familyConcentration: family.topShare,
    topFamily: family.topKey,
    participantCounts,
    participantConcentration: participant.topShare,
    topParticipant: participant.topKey,
    noDurableChangeStreak: noDurableChangeStreak(stateValue),
  };
}
