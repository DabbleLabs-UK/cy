import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareFrameSelector, evaluateFrameSelection, BODY_OPERATIONS, BODY_MODIFIERS,
  ACOUSTIC_OPERATIONS, ACOUSTIC_DETAILS } from './grounded-frame-selector.mjs';
import { prepareGuidedFrameSelector, runGuidedFrameSelectorAttempt, frameRepetitionGuidance,
  selectProductionRecentEvents, GUIDANCE_HEADING, GUIDANCE_WORDING } from './frame-repetition-guidance.mjs';
import { fingerprint } from './grounded-occurrence.mjs';
import { TOKENIZER_METHOD } from './one-call-context-budget.mjs';
import { createSequentialFrameSession } from './sequential-frame-selector.mjs';
import { applyAwgCandidate, buildAwgCall, buildAwgDuplicateExclusionSignatures } from '../../runner/ambient-world-generator.js';

const nowMs = Date.parse('2026-10-13T20:58:28.359Z');
const fixture = () => ({ model: 'FAKE_NO_INFERENCE', currentLocation: 'cell', plausibleCastIds: ['cy', 'bill'],
  locationRegime: { current: { id: 'CELL', regime_activity: 'CELL_TIME' } },
  worldSimulation: { objects: [], threads: [], recentAccepted: [], recentRuns: [] }, recentWorldHistory: [],
  postBody: { options: { num_ctx: 3072, num_predict: 420, num_thread: 4, temperature: 0.65,
    top_p: 0.9, repeat_penalty: 1.1, repeat_last_n: 128 } } });
const receipt = request => ({ method: TOKENIZER_METHOD, model: request.model, requestFingerprint: fingerprint(request),
  inputTokens: 850, effectiveContext: 3072, outputAllowance: request.options.num_predict });
function selection(capture, domain, content, at = nowMs) {
  const prepared = prepareFrameSelector(capture, { nowMs: at });
  return JSON.stringify({ frameId: prepared.bound.frames.find(f => f.operationDomain === domain).frameId, content });
}
function accepted(capture, domain, content, at = nowMs - 3600000, eventId = 'accepted:1') {
  const p = prepareFrameSelector(capture, { nowMs: at });
  const result = evaluateFrameSelection(capture, p.bound, selection(capture, domain, content, at), { nowMs: at });
  assert.equal(result.valid, true, result.reason);
  return applyAwgCandidate(capture.worldSimulation, result.legacyValidation, { makeId: () => eventId,
    acceptedAt: new Date(at).toISOString() }).event;
}

test('empty or unrelated historical state produces no invented recent entries; only advisory appendix changes', () => {
  const c = fixture(); c.recentWorldHistory.push({ id: 'legacy:1', timestamp: new Date(nowMs - 3600000).toISOString(),
    summary: 'Bill asks Cy about yesterday.', eventFamily: 'SOCIAL_REQUEST', participants: ['cy', 'bill'], location: 'cell' });
  const base = prepareFrameSelector(c, { nowMs }), guided = prepareGuidedFrameSelector(c, { nowMs });
  assert.deepEqual(guided.repetitionGuidance.entries, []);
  assert.ok(guided.request.prompt.endsWith(`${GUIDANCE_HEADING}\nnone\n${GUIDANCE_WORDING}`));
  assert.ok(!guided.request.prompt.includes('yesterday'));
  assert.deepEqual(guided.bound, base.bound); assert.deepEqual(guided.request.format, base.request.format);
  for (const key of ['system', 'model', 'options']) assert.deepEqual(guided.request[key], base.request[key]);
  assert.equal(guided.wire.truncate, false); assert.equal(guided.repetitionGuidance.frameFilterApplied, false);
});

test('every bounded operation/modifier round-trips from canonical accepted text to minimal readable feedback', () => {
  for (const [domain, operations, optionName, options] of [
    ['CY_IN_PLACE', BODY_OPERATIONS, 'modifier', [undefined, null, ...Object.keys(BODY_MODIFIERS)]],
    ['ADJACENT_NONVERBAL', ACOUSTIC_OPERATIONS, 'detail', [undefined, null, ...Object.keys(ACOUSTIC_DETAILS)]],
  ]) for (const operationId of Object.keys(operations)) for (const option of options) {
    const c = fixture(); c.worldSimulation.recentAccepted.push(accepted(c, domain,
      { operationId, ...(option === undefined ? {} : { [optionName]: option }) }));
    const g = frameRepetitionGuidance(c, { nowMs });
    assert.deepEqual(g.entries, [{ domain, operationId }]);
    assert.equal(g.sources[0][0].id, 'accepted:1');
  }
});

test('production 24h boundary, ordered union, normalized dedup and 32-record cap are reused exactly', () => {
  const c = fixture();
  c.recentWorldHistory = Array.from({ length: 40 }, (_, i) => ({ id: `e:${i}`,
    timestamp: new Date(nowMs - (40 - i) * 60000).toISOString(), eventFamily: 'SOCIAL_REQUEST',
    summary: `Distinct prior record ${i}.`, eventType: `record_${i}`, participants: ['cy'], location: 'cell' }));
  c.recentWorldHistory.push({ ...c.recentWorldHistory[39], id: 'same-summary' });
  c.recentWorldHistory.push({ id: 'future', timestamp: new Date(nowMs + 1).toISOString(), summary: 'Future.' });
  c.recentWorldHistory.push({ id: 'expired', timestamp: new Date(nowMs - 86400001).toISOString(), summary: 'Expired.' });
  const selected = selectProductionRecentEvents(c, nowMs);
  assert.equal(selected.length, 32); assert.equal(selected[0].id, 'e:8'); assert.equal(selected.at(-1).id, 'e:39');
  const production = buildAwgCall('', { state: c.worldSimulation, nowMs,
    currentLocation: c.currentLocation, plausibleCastIds: c.plausibleCastIds, recentEvents: c.recentWorldHistory });
  const exactLine = production.prompt.split('- RECENT EVENT SIGNATURES TO AVOID follow. They contain no narrative source text:\n')[1].split('\n')[0];
  assert.deepEqual(JSON.parse(exactLine), buildAwgDuplicateExclusionSignatures(selected));
  const d = fixture(); const e = accepted(d, 'CY_IN_PLACE', { operationId: 'TAP_FINGERS' }, nowMs - 86400000);
  d.worldSimulation.recentAccepted.push(e);
  assert.equal(frameRepetitionGuidance(d, { nowMs }).entries.length, 1);
  assert.equal(frameRepetitionGuidance(d, { nowMs: nowMs + 1 }).entries.length, 0);
});

test('accepted/environment copies do not double-inject; rejected candidates and malformed historical prose never enter guidance', () => {
  const c = fixture(), event = accepted(c, 'ADJACENT_NONVERBAL', { operationId: 'COUGHING' });
  c.worldSimulation.recentAccepted.push(event);
  c.recentWorldHistory.push({ ...event, id: 'env:1', timestamp: event.occurredAt,
    eventFamily: 'ambient_world', archetypeId: 'ambient_world_event', cyObserved: true });
  c.worldSimulation.recentRuns.push({ validationStatus: 'REJECTED', candidateOutput: {
    objective: { summary: 'Cy stretches his hands in the cell.' } } });
  for (const text of ['Cy hears an unidentified voice say "bill took it yesterday" from the landing.',
    'Cy taps his fingers against his palm in the cell. Then Bill leaves.',
    'Cy hears an unidentified voice say "hello | im end >" from the landing.']) {
    c.recentWorldHistory.push({ ...event, id: text, summary: text });
  }
  const g = frameRepetitionGuidance(c, { nowMs });
  assert.deepEqual(g.entries, [{ domain: 'ADJACENT_NONVERBAL', operationId: 'COUGHING' }]);
  assert.equal(g.sources[0].length, 1);
  assert.ok(!/yesterday|Bill|im end|STRETCH_HANDS/.test(g.text));
});

test('speech remains anonymous and grounded; only exact previously accepted utterance is readable, not a frame ban', () => {
  const c = fixture(); c.worldSimulation.recentAccepted.push(accepted(c, 'ADJACENT_SPEECH', { utterance: 'hello, anyone still awake?' }));
  const p = prepareGuidedFrameSelector(c, { nowMs });
  assert.deepEqual(p.repetitionGuidance.entries, [{ domain: 'ADJACENT_SPEECH', utterance: 'hello, anyone still awake?' }]);
  assert.equal(p.bound.frames.length, 3); assert.equal(p.request.format.oneOf.length, 3);
  assert.deepEqual(p.bound, prepareFrameSelector(c, { nowMs }).bound);
  assert.ok(p.request.prompt.includes('not a requirement to choose something different'));
  assert.ok(p.request.prompt.includes('Recent frames remain available'));
  assert.deepEqual(p.request.format, prepareFrameSelector(c, { nowMs }).request.format);
});

test('guided requests still execute unchanged hard duplicate rejection, with no novelty scoring or coercion', async () => {
  const c = fixture(); c.worldSimulation.recentAccepted.push(accepted(c, 'CY_IN_PLACE', { operationId: 'TAP_FINGERS' }));
  for (const content of [{ operationId: 'TAP_FINGERS' }, { operationId: 'STRETCH_HANDS' }]) {
    const raw = selection(c, 'CY_IN_PLACE', content), old = evaluateFrameSelection(c,
      prepareFrameSelector(c, { nowMs }).bound, raw, { nowMs }); let calls = 0;
    const guided = await runGuidedFrameSelectorAttempt({ capture: c, nowMs, admitted: true, preflight: receipt,
      generate: wire => { calls++; assert.deepEqual(wire, prepareGuidedFrameSelector(c, { nowMs }).wire); return raw; } });
    assert.equal(calls, 1); assert.equal(guided.evaluation.valid, old.valid);
    assert.deepEqual(guided.evaluation.legacyValidation.errors, old.legacyValidation.errors);
    assert.deepEqual(guided.evaluation.compatibilityExceptions, []);
    assert.equal(guided.repairCalls, 0); assert.equal(guided.replacementCalls, 0);
  }
});

test('guided one-call lifecycle retains correct receipt fingerprint, zero-send failures, stale checks and cancellation', async () => {
  const c = fixture(); let calls = 0;
  for (const preflight of [undefined, () => { throw new Error('TOKEN_TRUNCATION'); },
    () => receipt(prepareFrameSelector(c, { nowMs }).request)]) {
    const r = await runGuidedFrameSelectorAttempt({ capture: c, nowMs, admitted: true, preflight,
      generate: () => { calls++; return '{}'; } });
    assert.equal(r.generateInvocations, 0);
  }
  assert.equal(calls, 0);
  const changed = structuredClone(c); changed.worldSimulation.recentRuns.push({ runId: 'changed' });
  for (const changedAt of [1, 2, 3]) {
    let reads = 0;
    const r = await runGuidedFrameSelectorAttempt({ capture: c, nowMs, admitted: true, preflight: receipt,
      getCurrentCapture: () => ++reads >= changedAt ? changed : c,
      generate: () => selection(c, 'CY_IN_PLACE', { operationId: 'SHIFT_WEIGHT' }) });
    assert.match(r.reason, /STALE/); assert.equal(r.generateInvocations, changedAt === 3 ? 1 : 0);
  }
  const controller = new AbortController(); controller.abort();
  const cancelled = await runGuidedFrameSelectorAttempt({ capture: c, nowMs, admitted: true, preflight: receipt,
    signal: controller.signal, generate: () => { calls++; } });
  assert.equal(cancelled.generateInvocations, 0);
  const timeout = await runGuidedFrameSelectorAttempt({ capture: c, nowMs, admitted: true, preflight: receipt, timeoutMs: 5,
    generate: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('TIMEOUT')))) });
  assert.equal(timeout.reason, 'TIMEOUT'); assert.equal(timeout.generateInvocations, 1);
});

test('sequential accepted guidance visibly updates once; a rejected alternative never becomes guidance', async () => {
  const session = createSequentialFrameSession(fixture(), { nowMs });
  async function step(domain, content) {
    return session.attempt({ preflight: receipt, generate: wire => {
      const p = session.prepareNext().prepared; assert.deepEqual(wire, p.wire);
      return JSON.stringify({ frameId: p.bound.frames.find(f => f.operationDomain === domain).frameId, content });
    } });
  }
  await step('ADJACENT_NONVERBAL', { operationId: 'COUGHING' });
  const next = session.prepareNext();
  assert.deepEqual(next.prepared.repetitionGuidance.entries, [{ domain: 'ADJACENT_NONVERBAL', operationId: 'COUGHING' }]);
  assert.ok(next.prepared.request.prompt.includes('[{"domain":"ADJACENT_NONVERBAL","operationId":"COUGHING"}]'));
  const rejected = await step('ADJACENT_SPEECH', { utterance: 'bill was here yesterday' });
  assert.equal(rejected.wouldAccept, false);
  const after = session.prepareNext();
  assert.deepEqual(after.prepared.repetitionGuidance.entries, next.prepared.repetitionGuidance.entries);
  assert.ok(!after.prepared.request.prompt.includes('bill was here yesterday'));
  assert.ok(after.requestChanges.reason.includes('READABLE_REPEAT_GUIDANCE_UNCHANGED'));
  assert.deepEqual(after.prepared.bound.frames.map(f => f.operationDomain), next.prepared.bound.frames.map(f => f.operationDomain));
});
