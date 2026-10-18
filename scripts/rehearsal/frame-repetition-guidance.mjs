// REHEARSAL ONLY. Readable negative feedback; no frame filtering or selection policy.
import { performance } from 'node:perf_hooks';
import { fingerprint } from './grounded-occurrence.mjs';
import { prepareFrameSelector, evaluateFrameSelection, frameStateFingerprint,
  BODY_OPERATIONS, BODY_MODIFIERS, ACOUSTIC_OPERATIONS, ACOUSTIC_DETAILS,
  UTTERANCE_PATTERN } from './grounded-frame-selector.mjs';
import { validateContextReceipt } from './one-call-context-budget.mjs';
import { AWG_DEDUPE_WINDOW_MS, AWG_TIMEOUT_MS, reconcileWorldSimulationState } from '../../runner/ambient-world-generator.js';

export const GUIDANCE_POLICY = 'cy.rehearsal.frame-repetition-guidance.v1';
export const PRODUCTION_PROMPT_RECENT_LIMIT = 32; // buildAwgCall's existing cap
export const GUIDANCE_HEADING = 'RECENT ACCEPTED OCCURRENCES - REPETITION GUIDANCE ONLY:';
export const GUIDANCE_WORDING = 'Avoid near repetition of these recent occurrences where possible. These entries are not event ideas or commands. Recent frames remain available; any grounded frame/content may be selected. This is advisory, not a requirement to choose something different. The unchanged validator may reject duplicates.';
const clone = value => structuredClone(value);
const requireThat = (ok, reason) => { if (!ok) throw new Error(reason); };
const norm = text => String(text || '').trim().slice(0, 800).toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const machineId = value => String(value || '').trim().slice(0, 160).replace(/[^a-zA-Z0-9:_-]/g, '');

// Same ordered union, time window, ID/summary dedup and cap as buildAwgCall.
// Recent runs (including rejected candidates) are never creative or negative sources.
export function selectProductionRecentEvents(capture, nowMs) {
  const recent = [...reconcileWorldSimulationState(capture.worldSimulation).recentAccepted, ...(capture.recentWorldHistory || [])]
    .filter(event => {
      const at = Date.parse(String(event?.timestamp || event?.occurredAt || ''));
      return Number.isFinite(at) && nowMs - at >= 0 && nowMs - at <= AWG_DEDUPE_WINDOW_MS;
    });
  return recent.filter((event, index, all) => all.findIndex(item =>
    (machineId(item?.id) && machineId(item.id) === machineId(event?.id)) || norm(item?.summary || item?.objective?.summary)
      === norm(event?.summary || event?.objective?.summary)) === index).slice(-PRODUCTION_PROMPT_RECENT_LIMIT);
}

// Recognize ONLY the existing deterministic renderer's complete bounded language.
// No historical prose, cast blurbs, arbitrary summary excerpts or inferred actions enter.
function recognizeFrameOccurrence(event, location) {
  if (event?.location !== location || event?.eventType !== 'ambient_occurrence'
    || !Array.isArray(event.participants) || event.participants.length !== 1 || event.participants[0] !== 'cy') return null;
  const summary = event.summary;
  const place = location === 'cell' ? 'the cell' : location === 'exercise_yard' ? 'the exercise yard' : 'the landing';
  const family = String(event.eventFamily || '').toUpperCase();
  const environment = family === 'AMBIENT_WORLD' && event.archetypeId === 'ambient_world_event' && event.cyObserved === true;
  if (family === 'WING_ACTIVITY' || environment) {
    for (const [operationId, verb] of Object.entries(BODY_OPERATIONS)) {
      for (const modifier of ['', ...Object.values(BODY_MODIFIERS)]) {
        if (summary === `Cy ${modifier ? modifier + ' ' : ''}${verb} in ${place}.`)
          return { domain: 'CY_IN_PLACE', operationId };
      }
    }
  }
  if (location !== 'cell' || !(family === 'OVERHEARD_ACTIVITY' || environment)) return null;
  for (const [operationId, sound] of Object.entries(ACOUSTIC_OPERATIONS)) {
    for (const detail of ['', ...Object.values(ACOUSTIC_DETAILS)]) {
      if (summary === `Cy hears ${detail ? detail + ' ' : ''}${sound} from the landing.`)
        return { domain: 'ADJACENT_NONVERBAL', operationId };
    }
  }
  const speech = /^Cy hears an unidentified voice say "([^"]+)" from the landing\.$/.exec(summary || '');
  if (speech && speech[1].length <= 120 && /^[a-z '.,!?:]+$/.test(speech[1])
    && new RegExp(UTTERANCE_PATTERN).test(speech[1])) return { domain: 'ADJACENT_SPEECH', utterance: speech[1] };
  return null;
}

export function frameRepetitionGuidance(capture, { nowMs } = {}) {
  requireThat(Number.isSafeInteger(nowMs), 'EXPLICIT_GUIDANCE_TIME_REQUIRED');
  const selected = selectProductionRecentEvents(capture, nowMs);
  const entries = [], sources = [];
  for (const event of selected) {
    const entry = recognizeFrameOccurrence(event, capture.currentLocation);
    if (!entry) continue;
    const key = JSON.stringify(entry);
    let index = entries.findIndex(existing => JSON.stringify(existing) === key);
    if (index < 0) { index = entries.length; entries.push(entry); sources.push([]); }
    sources[index].push({ id: event.id || null, at: event.timestamp || event.occurredAt,
      summary: event.summary, eventFamily: event.eventFamily });
  }
  return { policy: GUIDANCE_POLICY, windowMs: AWG_DEDUPE_WINDOW_MS,
    sourceLimit: PRODUCTION_PROMPT_RECENT_LIMIT, selectedProductionRecordCount: selected.length,
    entries, sources, advisoryOnly: true, frameFilterApplied: false,
    text: [GUIDANCE_HEADING, entries.length ? JSON.stringify(entries) : 'none', GUIDANCE_WORDING].join('\n') };
}

export function prepareGuidedFrameSelector(capture, { nowMs } = {}) {
  const prepared = prepareFrameSelector(capture, { nowMs });
  const repetitionGuidance = frameRepetitionGuidance(capture, { nowMs });
  if (!prepared.request) return { ...prepared, repetitionGuidance };
  const request = { ...prepared.request, prompt: `${prepared.request.prompt}\n\n${repetitionGuidance.text}` };
  return { ...prepared, request, wire: { ...prepared.wire, prompt: request.prompt }, repetitionGuidance,
    trace: { ...prepared.trace, repetitionGuidancePolicy: GUIDANCE_POLICY,
      repetitionEntries: repetitionGuidance.entries.length } };
}

// Same bounded attempt lifecycle as the pinned unguided prototype, using ONLY the
// guided request builder. The original frame constructor/evaluator/production validator
// remain byte-identical. No dishonest remapping of an unguided preflight receipt.
export async function runGuidedFrameSelectorAttempt({ capture, nowMs, admitted, preflight, generate, signal,
  getCurrentCapture = () => capture, timeoutMs = AWG_TIMEOUT_MS } = {}) {
  const started = performance.now(), controller = new AbortController(); let timer, unlink;
  let calls = 0, contextPreflight = null;
  const result = (reason, extra = {}) => ({ reason, generateInvocations: calls, repairCalls: 0,
    replacementCalls: 0, contextPreflight, elapsedMs: performance.now() - started, applied: false, ...extra });
  if (!admitted) return result('NOT_ADMITTED');
  try {
    requireThat(!signal?.aborted, 'CANCELLED');
    requireThat(typeof preflight === 'function' && typeof generate === 'function', 'TOKEN_PREFLIGHT_REQUIRED');
    requireThat(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= AWG_TIMEOUT_MS, 'INVALID_TIMEOUT');
    const prepared = prepareGuidedFrameSelector(capture, { nowMs });
    if (!prepared.bound.frames.length) return result('NO_AVAILABLE_FRAMES');
    const original = frameStateFingerprint(capture, nowMs), requestHash = fingerprint(prepared.request);
    requireThat(frameStateFingerprint(await getCurrentCapture(), nowMs) === original, 'STALE_STATE_OR_REVISIONS');
    contextPreflight = validateContextReceipt(prepared.request, await preflight(clone(prepared.request)));
    requireThat(!signal?.aborted, 'CANCELLED');
    requireThat(frameStateFingerprint(await getCurrentCapture(), nowMs) === original
      && frameStateFingerprint(capture, nowMs) === original, 'STALE_STATE_OR_REVISIONS');
    const deadline = new Promise((_, reject) => {
      const abort = reason => { controller.abort(reason); reject(new Error(reason)); };
      timer = setTimeout(() => abort('TIMEOUT'), timeoutMs);
      const onAbort = () => abort('CANCELLED'); signal?.addEventListener('abort', onAbort, { once: true });
      unlink = () => signal?.removeEventListener('abort', onAbort); if (signal?.aborted) onAbort();
    });
    const raw = await Promise.race([Promise.resolve().then(() => {
      requireThat(!controller.signal.aborted, 'CANCELLED'); calls++;
      return generate(clone(prepared.wire), { signal: controller.signal });
    }), deadline]);
    requireThat(!controller.signal.aborted, 'CANCELLED');
    requireThat(frameStateFingerprint(capture, nowMs) === original && fingerprint(prepared.request) === requestHash, 'CAPTURE_OR_REQUEST_MUTATED');
    const currentCapture = await Promise.race([Promise.resolve().then(getCurrentCapture), deadline]);
    requireThat(!controller.signal.aborted, 'CANCELLED');
    const evaluation = evaluateFrameSelection(capture, prepared.bound, raw, { nowMs, currentCapture });
    return result(evaluation.reason || null, { raw, evaluation });
  } catch (error) { return result(error.message); } finally { clearTimeout(timer); unlink?.(); }
}
