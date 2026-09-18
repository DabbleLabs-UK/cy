// timeline-model.js - pure, DOM-free helpers shared by the workbench viewer
// and its Node test. No math beyond ordinal row lookup and template strings;
// every fact rendered comes straight from a replay report field.

export const ROWS = ['THREAT_ONGOING', 'THREAT_IMMINENT', 'ANTICIPATING', 'QUIET', 'UNKNOWN'];

export function rowIndex(statusValue) {
  const index = ROWS.indexOf(statusValue);
  return index === -1 ? ROWS.length - 1 : index;
}

export function findTransitionFor(report, point) {
  if (!point || point.kind !== 'EVENT') return null;
  return report.transitions.find((t) => t.sourceEventId === point.sourceEventId
    && t.timestampMs === point.timestampMs) || null;
}

export function precedingEventLabel(trajectory, index, timeFmt) {
  for (let i = index - 1; i >= 0; i -= 1) {
    const p = trajectory[i];
    if (p.kind === 'EVENT') return `#${p.sequence} ${p.eventType} at ${timeFmt(p.timestampMs)}`;
    if (p.kind === 'INITIAL') return 'the start of the replay window';
  }
  return 'the start of the replay window';
}

export function describeConcern(concern) {
  if (!concern) return 'no active concern is recorded';
  const parts = [`an active ${concern.outcomeClass} concern is ${concern.temporalStatus}`];
  if (concern.objectiveControllability && concern.objectiveControllability !== 'UNKNOWN') {
    parts.push(`objective control is ${concern.objectiveControllability}`);
  }
  if (concern.worldAmbiguity && concern.worldAmbiguity !== 'UNKNOWN') {
    parts.push(`world ambiguity is ${concern.worldAmbiguity}`);
  }
  return parts.join('; ');
}

export function describeTransition(point, beforeStatus, afterStatus, concern, precedingLabel) {
  if (point.kind === 'SAMPLE') {
    return `No event applies here; this is a time sample reading the state held since ${precedingLabel}. `
      + `Anxiety remains ${afterStatus} because ${describeConcern(concern)}.`;
  }
  if (beforeStatus === afterStatus) {
    return `Anxiety remains ${afterStatus} after this event, because ${describeConcern(concern)}.`;
  }
  if (afterStatus === 'QUIET') {
    return 'Anxiety returned to QUIET because no defensive context remains active (the concern resolved or closed).';
  }
  return `Anxiety became ${afterStatus} because ${describeConcern(concern)}.`;
}

// Given a replay report's trajectory (already chronological), build the
// step-after (x, rowIndex) polyline vertices a renderer draws between. This
// is pure layout math over data the report already contains - it fabricates
// no new value and reads only timestampMs and snapshot.anxiety.status.
export function stepVertices(trajectory) {
  if (!trajectory.length) return [];
  const vertices = [{ timestampMs: trajectory[0].timestampMs, row: rowIndex(trajectory[0].snapshot.anxiety.status) }];
  for (let i = 1; i < trajectory.length; i += 1) {
    const prevRow = rowIndex(trajectory[i - 1].snapshot.anxiety.status);
    const curRow = rowIndex(trajectory[i].snapshot.anxiety.status);
    const t = trajectory[i].timestampMs;
    vertices.push({ timestampMs: t, row: prevRow });
    vertices.push({ timestampMs: t, row: curRow });
  }
  return vertices;
}
