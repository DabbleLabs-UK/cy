// Offline projection, not a repair tool. Every original semantic assertion is
// retained or reported as a projection conflict; no winning identity is chosen.
import { prepareSemanticCore, evaluateSemanticCore } from './semantic-core.mjs';

export function projectLegacy(p, packet) {
  const conflicts = [];
  const roles = p.actors.filter(id => id !== 'cy').map(entityId => ({ entityId, role: 'ACTOR' }));
  const cyActs = /\bCy\s+(?!hears?\b|listens?\b|sees?\b|observes?\b|directly\b)[a-z]+/i.test(p.occurrence.summary);
  if (cyActs) roles.unshift({ entityId: 'cy', role: 'ACTOR' });
  for (const entry of p.occurrence.presence) if (entry.actorId !== 'cy' && !p.actors.includes(entry.actorId))
    conflicts.push(`PRESENCE_IDENTITY_CONFLICT:${entry.actorId}`);
  if (p.target && !roles.some(r => r.entityId === p.target.id)) {
    if (p.target.kind === 'ACTOR' && !p.actors.includes(p.target.id)) conflicts.push(`TARGET_IDENTITY_CONFLICT:${p.target.id}`);
    roles.push({ entityId: p.target.id, role: 'TARGET' });
  }
  const access = p.observation.access, origin = p.occurrence.originLocation;
  let accessFrameId = null;
  if (access === 'CY_DIRECT' && origin === packet.current.location) accessFrameId = 'CURRENT_DIRECT';
  if (access === 'WORLD_ONLY' && origin === packet.current.location) accessFrameId = 'WORLD_CURRENT';
  if (access === 'CY_PARTIAL_HEARD' && origin === 'landing') accessFrameId = p.occurrence.presence.some(e => e.actorId !== 'cy')
    ? 'ADJACENT_SELF_IDENTIFIED' : 'ADJACENT_UNIDENTIFIED';
  if (!accessFrameId) conflicts.push(`ACCESS_ORIGIN_NOT_UNIQUELY_REPRESENTABLE:${access}:${origin}`);
  if (p.effects.length) conflicts.push('NONEMPTY_EFFECT_REQUIRES_UNAMBIGUOUS_SEMANTIC_SELECTION');
  return { core: { roles, occurrence: p.occurrence.summary, accessFrameId, effectChoiceId: null },
    conflicts, constraints: [p.observation.summary],
    unchangedOccurrence: p.occurrence.summary, unchangedObservation: p.observation.summary };
}

export function replayLegacy(capture, nowMs, rows) {
  const { packet } = prepareSemanticCore(capture, { nowMs });
  return rows.filter(r => r.evaluation?.parsed).map(row => {
    const projected = projectLegacy(row.evaluation.parsed, packet);
    const checked = evaluateSemanticCore(capture, packet, JSON.stringify(projected.core), { nowMs, constraints: projected.constraints });
    const evaluation = projected.conflicts.length ? { ...checked, valid: false, outcome: 'PROJECTION_REJECTED',
      reason: projected.conflicts.join(';'), decoderReason: checked.reason || null, applied: false } : checked;
    return { index: row.index, previousReason: row.reason, ...projected, evaluation,
      reconstructionAttempted: true, acceptanceChanged: Boolean(evaluation.valid), textChanged: false, inferenceExecuted: false };
  });
}
