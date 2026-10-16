// REHEARSAL ONLY. Gate-only Stage-1 diagnostic. No provider, network, state
// writer, Stage 2, occurrence generation or production import of this module.
//
// PURPOSE
// Distinguish a genuine semantic preference for "nothing happens" from a lexical/
// output-label bias toward a particular decision token. This is ONLY the yes/no
// semantic gate: one required decision field with two NEUTRAL single-token labels,
// counterbalanced across two arms so the same two raw labels carry OPPOSITE
// meanings in Arm A vs Arm B.
//
//   Arm A: label1 = "nothing" semantic (production NO_EVENT), label2 = "something" (OCCURRENCE)
//   Arm B: label1 = "something" semantic (OCCURRENCE),        label2 = "nothing"   (NO_EVENT)
//
// The model-facing schema is identical in both arms (enum of the same two labels,
// same order). The ONLY difference between arms is which meaning each label is
// bound to in the model-facing prompt. Reading raw label vs mapped semantic across
// the two arms separates token/position bias from semantic preference.
//
// The audit established the decision is made before any heavy payload and that
// llama.cpp has no future-length lookahead, so this diagnostic deliberately does
// NOT vary payload complexity. It keeps the SAME frozen affordance packet, SAME
// stochastic sampler and model as the grounded Stage-1 runs. The system/instruction
// is replaced with a neutral symmetric framing because the original Stage-1 system
// names the schema label and frames the task as occurrence selection; a yes/no gate
// needs neither. No occurrence examples, no incident menu, no actor hints, no new
// affordances.
//
// HARD RULE: the model-facing text (system + prompt + schema) must contain neither
// of the literal strings NO_EVENT nor OCCURRENCE. Those literals may appear only in
// non-model-facing analysis/mapping/trace output. buildArmRequest fails closed if a
// literal leaks into any model-facing field.

import { buildAffordancePacket, fingerprint } from './grounded-occurrence.mjs';

// Candidate neutral labels: nonce syllables with no obvious real-world meaning.
// The authoritative single-token check happens against the REAL CY tokenizer on
// LENO (see verifyLabels / selectNeutralLabelPair); this pool only bounds the
// search. Order is the selection preference order.
export const NEUTRAL_LABEL_POOL = Object.freeze([
  'Wug', 'Dax', 'Fep', 'Gorp', 'Zav', 'Tiv', 'Vash', 'Pim', 'Lirn', 'Kaz',
  'Blif', 'Trell', 'Snod', 'Quel', 'Frob',
]);

export const SEMANTICS = Object.freeze({ NOTHING: 'NOTHING', SOMETHING: 'SOMETHING' });

// Non-model-facing legend only. Lets a human line the neutral semantics up with
// the production decision labels without ever showing those labels to the model.
export const SEMANTIC_LEGEND = Object.freeze({
  NOTHING: 'maps to production NO_EVENT (abstain)',
  SOMETHING: 'maps to production OCCURRENCE (act)',
});

const FORBIDDEN_LITERALS = /NO_EVENT|OCCURRENCE/;

// Neutral replacement for the frozen packet's interpretation.note, which in the
// grounded prototype contains the literal "NO_EVENT". Carries the same anti-menu
// guardrail without leaking a label or biasing either choice.
export const NEUTRAL_PACKET_NOTE = 'This is mechanically extracted state, not a menu of events and not a list of suggested actions. Eligibility of a person is not proof of presence; past records are not ongoing. Both labels are equally acceptable.';

// Neutral, symmetric system framing. Names no schema label and prefers no option.
export const GATE_SYSTEM = 'REHEARSAL ONLY. You are given mechanically extracted state from one situation. Decide which of exactly two labels applies. Choose exactly one. Neither label is preferred. Return only JSON of the form {"decision":"<label>"}.';

const clone = (value) => structuredClone(value);

export function assertNoForbiddenLiterals(text, where) {
  if (FORBIDDEN_LITERALS.test(String(text))) {
    throw new Error(`FORBIDDEN_LITERAL_IN_MODEL_FACING_TEXT:${where}`);
  }
}

// The symmetric meaning clause for each neutral semantic. Parallel structure so the
// two clauses differ only in "nothing new" vs "something new".
export function semanticPhrase(semantic) {
  if (semantic === SEMANTICS.NOTHING) return 'nothing new is happening in the situation below that should be recorded';
  if (semantic === SEMANTICS.SOMETHING) return 'something new is happening in the situation below that should be recorded';
  throw new Error('UNKNOWN_SEMANTIC');
}

// label -> semantic mapping for an arm. Arm A binds label1->NOTHING, label2->SOMETHING;
// Arm B reverses it. label order [label1, label2] is held fixed across arms.
export function armMapping(arm, labels) {
  const [label1, label2] = labels;
  if (arm === 'A') return { [label1]: SEMANTICS.NOTHING, [label2]: SEMANTICS.SOMETHING };
  if (arm === 'B') return { [label1]: SEMANTICS.SOMETHING, [label2]: SEMANTICS.NOTHING };
  throw new Error('UNKNOWN_ARM');
}

// ---- tokenizer verification (authoritative data supplied by the LENO preflight) --
// `tokenization` maps each label string to the token id array (or count) produced
// by the EXACT CY model tokenizer. This module is tokenizer-source-agnostic; the
// numbers must come from the real tokenizer on LENO. Offline tests inject a
// synthetic record to exercise the logic.
function tokenCount(tokenization, label) {
  const entry = tokenization && tokenization[label];
  if (Array.isArray(entry)) return entry.length;
  if (Number.isInteger(entry)) return entry;
  throw new Error(`MISSING_TOKENIZATION:${label}`);
}

export function verifyLabels(labels, tokenization) {
  const perLabel = labels.map((label) => ({ label, tokens: tokenCount(tokenization, label) }));
  const allSingle = perLabel.every((entry) => entry.tokens === 1);
  const distinct = new Set(labels).size === labels.length;
  const balanced = allSingle && new Set(perLabel.map((e) => e.tokens)).size === 1;
  const ok = labels.length === 2 && distinct && allSingle && balanced
    && labels.every((label) => !FORBIDDEN_LITERALS.test(label));
  return { ok, perLabel, distinct, allSingle, balanced };
}

export function selectNeutralLabelPair(pool, tokenization) {
  const singles = pool.filter((label) => {
    try { return tokenCount(tokenization, label) === 1 && !FORBIDDEN_LITERALS.test(label); } catch { return false; }
  });
  const pair = [...new Set(singles)].slice(0, 2);
  if (pair.length < 2) throw new Error('NO_SINGLE_TOKEN_PAIR_IN_POOL');
  const verdict = verifyLabels(pair, tokenization);
  if (!verdict.ok) throw new Error('SELECTED_PAIR_FAILED_VERIFICATION');
  return { labels: pair, verification: verdict };
}

// ---- packet neutralisation (literal scrub only; affordance data untouched) -------
export function neutraliseModelFacingPacket(packet) {
  const scrubbed = clone(packet);
  const changed = [];
  if (scrubbed.interpretation && FORBIDDEN_LITERALS.test(String(scrubbed.interpretation.note || ''))) {
    scrubbed.interpretation.note = NEUTRAL_PACKET_NOTE;
    changed.push('interpretation.note');
  }
  // Fail closed: no forbidden literal may survive anywhere in the model-facing packet.
  assertNoForbiddenLiterals(JSON.stringify(scrubbed), 'packet');
  return { packet: scrubbed, changed };
}

// ---- schema + prompt (schema identical across arms; only mapping block varies) ---
export function buildGateFormat(labels) {
  return { type: 'object', additionalProperties: false, required: ['decision'],
    properties: { decision: { enum: [...labels] } } };
}

// The mapping block is the ONLY arm-dependent text. Boilerplate around the two
// clauses is identical across arms; only which phrase follows label1 vs label2 swaps.
export function gateMappingBlock(arm, labels) {
  const [label1, label2] = labels;
  const map = armMapping(arm, labels);
  return [
    'Choose exactly one label. The two options are mutually exclusive and equally acceptable.',
    `- ${label1}: ${semanticPhrase(map[label1])}`,
    `- ${label2}: ${semanticPhrase(map[label2])}`,
    'Return only {"decision":"<one label>"}.',
  ].join('\n');
}

// Non-mapping, non-packet guard text. Identical across arms. No literal, no bias,
// no incident menu, no actor hint.
export const GATE_GUARD = 'The data below is mechanically extracted state for one moment. It is not a menu of events and not a list of suggested actions. Judge only the current situation.';

export function gatePromptParts(arm, labels, packetJson) {
  return { guard: GATE_GUARD, mappingBlock: gateMappingBlock(arm, labels), packetJson };
}

export function assembleGatePrompt(parts) {
  return [parts.guard, parts.mappingBlock, parts.packetJson].join('\n\n');
}

export function buildArmRequest(capture, scrubbedPacket, labels, arm) {
  const packetJson = JSON.stringify(scrubbedPacket);
  const parts = gatePromptParts(arm, labels, packetJson);
  const prompt = assembleGatePrompt(parts);
  const format = buildGateFormat(labels);
  const request = {
    model: capture.model,
    system: GATE_SYSTEM,
    prompt,
    format,
    options: clone(capture.postBody.options),
  };
  // Model-facing fields must contain neither literal.
  assertNoForbiddenLiterals(request.system, 'system');
  assertNoForbiddenLiterals(request.prompt, 'prompt');
  assertNoForbiddenLiterals(JSON.stringify(request.format), 'format');
  return { request, parts };
}

export function buildNeutralGate(capture, { nowMs, labels, tokenization } = {}) {
  const before = fingerprint(capture);
  const verification = verifyLabels(labels, tokenization);
  if (!verification.ok) throw new Error('LABELS_NOT_TOKENIZER_BALANCED');
  const rawPacket = buildAffordancePacket(capture, { nowMs });
  const { packet, changed } = neutraliseModelFacingPacket(rawPacket);
  const armA = buildArmRequest(capture, packet, labels, 'A');
  const armB = buildArmRequest(capture, packet, labels, 'B');
  // The two arm requests must differ ONLY in the mapping block.
  if (armA.parts.guard !== armB.parts.guard || armA.parts.packetJson !== armB.parts.packetJson) {
    throw new Error('ARMS_DIFFER_BEYOND_MAPPING');
  }
  if (fingerprint(capture) !== before) throw new Error('CAPTURE_MUTATED');
  return {
    schema: 'cy.rehearsal.neutral-gate.v1',
    nowMs,
    labels: [...labels],
    tokenization: clone(tokenization),
    labelVerification: verification,
    packetFingerprint: fingerprint(packet),
    packetNeutralisedFields: changed,
    semanticLegend: SEMANTIC_LEGEND,
    mapping: { A: armMapping('A', labels), B: armMapping('B', labels) },
    arms: { A: armA.request, B: armB.request },
    inferenceExecuted: false,
    _note: 'Model-facing text is label-neutral and literal-free. Legend/mapping are analysis only. No Stage 2, no occurrence generation. Inference not run here.',
  };
}

// ---- readout (fed raw outputs collected by the authorised LENO harness) ----------
// A sample is { arm, raw: <string|null>, timingMs: <number|null>, error: <string|null> }.
function parseDecision(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('NO_JSON_OBJECT');
  const value = JSON.parse(raw.slice(start, end + 1));
  if (!value || typeof value.decision !== 'string') throw new Error('NO_DECISION');
  return value.decision;
}

export function classifySample(sample, labels, armMap) {
  if (sample.error) return { ...sample, rawLabel: null, mappedSemantic: null, status: 'ERROR' };
  try {
    const rawLabel = parseDecision(String(sample.raw));
    if (!labels.includes(rawLabel)) return { ...sample, rawLabel, mappedSemantic: null, status: 'INVALID_LABEL' };
    return { ...sample, rawLabel, mappedSemantic: armMap[rawLabel], status: 'OK' };
  } catch (error) {
    return { ...sample, rawLabel: null, mappedSemantic: null, status: 'UNPARSEABLE', parseError: error.message };
  }
}

export function summariseArm(samples, labels, armMap) {
  const classified = samples.map((sample) => classifySample(sample, labels, armMap));
  const ok = classified.filter((c) => c.status === 'OK');
  const byRawLabel = Object.fromEntries(labels.map((label) => [label, ok.filter((c) => c.rawLabel === label).length]));
  const bySemantic = {
    NOTHING: ok.filter((c) => c.mappedSemantic === SEMANTICS.NOTHING).length,
    SOMETHING: ok.filter((c) => c.mappedSemantic === SEMANTICS.SOMETHING).length,
  };
  const timings = ok.map((c) => c.timingMs).filter((t) => Number.isFinite(t));
  const errors = classified.filter((c) => c.status === 'ERROR');
  return {
    total: samples.length,
    completed: ok.length,
    errors: errors.length,
    timeouts: errors.filter((c) => /timeout|timed out|ETIMEDOUT/i.test(String(c.error))).length,
    invalidLabel: classified.filter((c) => c.status === 'INVALID_LABEL').length,
    unparseable: classified.filter((c) => c.status === 'UNPARSEABLE').length,
    byRawLabel,
    bySemantic,
    nothingShare: ok.length ? bySemantic.NOTHING / ok.length : null,
    latencyMs: timings.length
      ? { min: Math.min(...timings), max: Math.max(...timings), mean: timings.reduce((a, b) => a + b, 0) / timings.length }
      : null,
    samples: classified,
  };
}

// Advisory interpretation. Humans confirm against raw counts and N. majority = share
// strictly greater than this of completed samples.
//
// With two counterbalanced labels and a fixed label order, the mapping reversal
// forces a clean decision tree:
//   - the SAME raw token wins both arms (its meaning therefore flips)  -> token/position bias;
//   - DIFFERENT raw tokens win, both mapping to NOTHING                -> genuine abstention;
//   - DIFFERENT raw tokens win, both mapping to SOMETHING              -> genuine action preference (the mirror);
//   - no stable majority in at least one arm                           -> wording/schema contributed (a mix).
export function interpretGate(summaryA, summaryB, labels, { majority = 0.5 } = {}) {
  const [label1] = labels;
  const rawWinner = (summary) => {
    const entries = Object.entries(summary.byRawLabel).sort((a, b) => b[1] - a[1]);
    const [top, topN] = entries[0] || [null, 0];
    return summary.completed && topN / summary.completed > majority ? top : null;
  };
  const semanticWinner = (summary) => {
    if (!summary.completed) return null;
    if (summary.nothingShare > majority) return SEMANTICS.NOTHING;
    if (1 - summary.nothingShare > majority) return SEMANTICS.SOMETHING;
    return null;
  };
  const rawA = rawWinner(summaryA);
  const rawB = rawWinner(summaryB);
  const semA = semanticWinner(summaryA);
  const semB = semanticWinner(summaryB);
  const stableSemantic = semA && semA === semB ? semA : null;
  let verdict = 'INCONCLUSIVE';
  if (!summaryA.completed || !summaryB.completed) verdict = 'INCONCLUSIVE';
  else if (rawA && rawA === rawB) verdict = 'LABEL_OR_POSITION_BIAS';
  else if (stableSemantic === SEMANTICS.NOTHING) verdict = 'GENUINE_ABSTENTION_PREFERENCE';
  else if (stableSemantic === SEMANTICS.SOMETHING) verdict = 'GENUINE_ACTION_PREFERENCE';
  else verdict = 'WORDING_OR_SCHEMA_CONTRIBUTED';
  return {
    verdict,
    rawWinner: { A: rawA, B: rawB },
    semanticWinner: { A: semA, B: semB },
    nothingShare: { A: summaryA.nothingShare, B: summaryB.nothingShare },
    label1,
    majority,
    _note: 'Advisory only. Requires enough completed samples per arm (the sampler is stochastic). The SAME raw label winning both arms indicates token/position bias; "nothing" winning under the reversed mapping indicates genuine abstention; "something" winning both indicates a genuine action preference (the mirror); no stable majority indicates the original wording/schema contributed a mix.',
  };
}

export function analyzeGateOutputs({ A = [], B = [] }, prepared) {
  const labels = prepared.labels;
  const summaryA = summariseArm(A, labels, prepared.mapping.A);
  const summaryB = summariseArm(B, labels, prepared.mapping.B);
  return {
    schema: 'cy.rehearsal.neutral-gate.readout.v1',
    labels,
    semanticLegend: prepared.semanticLegend,
    arms: { A: summaryA, B: summaryB },
    interpretation: interpretGate(summaryA, summaryB, labels),
  };
}
