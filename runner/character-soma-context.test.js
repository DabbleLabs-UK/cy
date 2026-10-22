import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import { buildGroundedProseContext, formatGroundedProseContext } from './grounded-prose-context.js';
import { groundedSomaDirective, observeSomaFeedingRecord, observeSomaSomaticRecord,
  reconcileSoma, replaySomaObservedSleepRecords, tickSoma, somaSampling } from './soma.js';
import { createSomaRuntime } from './soma-runtime.js';
import { prepareSomaGeneration } from './soma-cycle.js';
import { sleepHomeostasisSnapshot } from './sleep-homeostasis.js';
import { circadianProcessCSnapshot } from './circadian-process-c.js';
import { threeProcessSleepinessSnapshot, tpmKssAnchor } from './three-process-sleepiness.js';
import { physiologicalSatietySnapshot } from './physiological-satiety.js';
import { somaticSnapshot } from './somatic-nociceptive-substrate.js';
import { feedingSnapshot } from './feeding-homeostasis.js';
import { socialContactSnapshot } from './social-contact-substrate.js';
import { buildDirectives, buildPrompt, CHARACTER_KNOWLEDGE_TEXT, ZONE_A } from './prompt.js';
import { canonicalPostcardContext } from './postcard-context.js';
import { CONTEXT_BROKER_SCHEMA, CONTEXT_CONSUMERS, renderContextPacket,
  renderWakingJournalContextPacket } from './context-broker.js';
import { buildExpressiveChoiceRequest, expressiveChoiceModelCall } from './expressive-choice.js';

const BASE = Date.parse('2026-09-01T21:00:00Z');
const HOUR = 3600000;
const NOW = BASE + 25 * HOUR;
const leak = /\bKSS\b|Karolinska|calibrat|residual|gastric|distention|normaliz|normalis|population.default|reference.full|substrate|not modelled|modelled|central 95|\bSD\b|\bmL\b/i;
const state = reconcileSoma(null, { now: BASE });
replaySomaObservedSleepRecords(state, [
  [0, 'sleep_period'], [8, 'awake'], [16, 'sleep_period'], [24, 'awake'],
].map(([h, sleep_period], i) => ({ event_id: `sleep:${i}`, occurred_at_ms: BASE + h * HOUR,
  soma_input: { sleep_period, sleep_interruption: 'none' } })), { now: NOW });
observeSomaFeedingRecord(state, createEnvironmentRecord(createEnvironmentEvent('meal', {
  id: 'known-breakfast', timestamp: new Date(NOW - HOUR / 2).toISOString(),
  world: { physical: { food: {
    meal_type: 'breakfast', scheduled: 'yes', offered: 'yes', available: 'yes', received: 'yes',
    consumed: 'full', intake_outcome: 'full_consumed', portion_category: 'full', portion_fraction: 1,
    nutrition: { energy_kcal: 500, fat_g: 18, carbohydrate_g: 72, protein_g: 22 },
  } } },
})));
observeSomaSomaticRecord(state, createEnvironmentRecord(createEnvironmentEvent('somatic_event', {
  id: 'known-abrasion', timestamp: new Date(NOW).toISOString(), world: { somatic: {
    body: { site: 'left_hand', laterality: 'LEFT', certainty: 'CERTAIN' },
    tissue: { damage_status: 'CONFIRMED', injury_id: 'injury:left-hand', injury_type: 'ABRASION', injury_status: 'ACTIVE' },
    knowledge_status: 'PARTIAL',
  } },
})));
tickSoma(state, { now: NOW, asleep: false, physical: {} });

const line = (fact, value, epistemicStatus = 'MODEL ESTIMATE') => ({ fact, value, epistemicStatus });
const render = (...entries) => formatGroundedProseContext({ sections: [{ entries }] });
const facts = (text) => text.split('\n').filter((line) => line.startsWith('- ')).join('\n');
const packet = (directive, consumer = CONTEXT_CONSUMERS.CY_PROSE) => ({ schema: CONTEXT_BROKER_SCHEMA, consumer,
  sections: [{ id: 'grounded_soma', items: [{ id: 'grounded-soma:current', provenanceClass: 'MODEL ESTIMATE',
    content: directive }] }] });

test('live sleepiness/fullness reach character context without their engineering implementation', () => {
  const projection = groundedSomaDirective(state, { now: NOW });
  const sleepiness = threeProcessSleepinessSnapshot(state.predictedSleepiness, NOW);
  const satiety = physiologicalSatietySnapshot(state.physiologicalSatiety);
  assert.equal(sleepiness.publicLabel, 'LIVE');
  assert.equal(satiety.headline.status, 'ESTIMATE_AVAILABLE');
  assert.ok(projection.directive.includes(`Possible sleepiness: ${sleepiness.kssAnchor.description}.`));
  assert.match(projection.directive, /\[BODILY INDICATION\] Possible stomach fullness:/);
  assert.match(projection.directive, /Active abrasion at left hand/);
  assert.match(projection.directive, /food intake was recorded 30 minutes ago/);
  assert.doesNotMatch(projection.directive, leak);
  assert.doesNotMatch(projection.directive, /Cy (?:is|feels) (?:hungry|in pain|afraid|tired)|pain (?:level|score)|comfortable|exhausted/i);
  assert.match(projection.directive, /possible indication is not a certain feeling/);
});

test('existing published sleepiness anchors are reused without a new intensity/feeling mapping', () => {
  for (const estimate of [1, 2, 3, 4, 5, 5.5, 6, 7, 8, 9]) {
    const anchor = tpmKssAnchor(estimate);
    const text = render(line('predicted_kss', { estimate, nearestPublishedAnchor: anchor,
      residualSdKss: 1.42, betweenSubjectInterceptSdKss: 0.84, phaseBasis: 'POPULATION_DEFAULT_PHASE' }));
    assert.ok(text.includes(`Possible sleepiness: ${anchor.description}.`));
    assert.doesNotMatch(text, leak);
  }
});

test('unavailable or out-of-range sleepiness cannot manufacture a felt state or disclose calibration', () => {
  for (const value of ['CALIBRATING: two sleeps before KSS', null, {},
    { estimate: NaN }, { estimate: 9.5, nearestPublishedAnchor: tpmKssAnchor(9.5) },
    { estimate: 0.5, nearestPublishedAnchor: tpmKssAnchor(0.5) }]) {
    const text = render(line('predicted_kss', value));
    assert.doesNotMatch(text, /Possible sleepiness/);
    assert.doesNotMatch(text, leak);
  }
});

test('raw pressure/phase remain inspectable but are never converted to feelings or engineering lessons', () => {
  const first = render(line('process_s', { estimate: 0.1, interval: [0, 1], calibrating: true,
    currentObservedSleepState: 'awake' }), line('process_c', { estimate: -1.2 }));
  const second = render(line('process_s', { estimate: 0.99, interval: [0.98, 1], calibrating: false,
    currentObservedSleepState: 'awake' }), line('process_c', { estimate: 9 }));
  assert.equal(first, second);
  assert.match(first, /\[OBSERVED FACT\] Currently awake/);
  assert.doesNotMatch(first, /sleep.pressure|circadian|calibrat|0\.99|sleepy|tired/i);
  assert.match(render(line('process_s', { currentObservedSleepState: 'asleep' })), /Currently asleep/);
  assert.doesNotMatch(render(line('process_s', { currentObservedSleepState: 'unknown' })), /Currently/);
});

test('fullness uses only the already-promoted descriptive band, never hunger/comfort or display percent', () => {
  for (const [band, text] of [['EMPTY', 'empty'], ['FILLING', 'partly full'], ['FULL', 'full'], ['VERY_FULL', 'very full']]) {
    const body = line('physiological_satiety', { band, gastricDistentionMl: 700, normalizedPercent: 81,
      central95Ml: { lower: 600, upper: 800 }, inputUncertainty: 'PUBLISHED INPUT-DISTRIBUTION UNCERTAINTY' });
    const rendered = render(body);
    assert.match(rendered, new RegExp(`Possible stomach fullness: ${text}\\.`));
    assert.doesNotMatch(rendered, /hunger|hungry|comfort|700|81|calibrat/i);
    assert.doesNotMatch(rendered, leak);
  }
});

test('uncertain composition, absent intake and incomplete state do not create a fullness midpoint', () => {
  for (const fact of ['physiological_satiety_unavailable', 'physiological_satiety_input_uncertain']) {
    assert.doesNotMatch(render(line(fact, { reason: 'CALIBRATING model',
      scenarioEnvelope: { minimumScenarioMedianMl: 300, maximumScenarioMedianMl: 900 } })), leak);
    assert.doesNotMatch(render(line(fact, 'MODEL_NOT_INITIALIZED')), /Possible stomach fullness/);
  }
  const empty = groundedSomaDirective(reconcileSoma(null, { now: NOW }), { now: NOW });
  assert.doesNotMatch(empty.directive, /Possible (?:sleepiness|stomach fullness)|hungry|in pain/i);
  assert.doesNotMatch(empty.directive, leak);
  assert.match(groundedSomaDirective(null, { now: NOW }).directive, /No current grounded facts are available/);
});

test('injury/exposure descriptions retain only supported facts, with no pain or injury severity added', () => {
  for (const [modality, description] of [['MECHANICAL', 'physical'], ['THERMAL', 'heat or cold'], ['CHEMICAL', 'chemical'], ['UNKNOWN', 'bodily']]) {
    const text = render(line('active_noxious_stimulus', { modality, bodySite: 'left_hand', status: 'ACTIVE' }, 'OBSERVED FACT'));
    assert.ok(text.includes(`potentially harmful ${description} exposure at left hand`));
    assert.doesNotMatch(facts(text), /noxious|nocicept|pain|sever|burn|aching/i);
  }
  const injury = render(line('active_injury', { injuryType: 'ABRASION', bodySite: 'left_hand',
    mechanism: 'MECHANICAL', siteCertainty: 'UNCERTAIN' }, 'OBSERVED FACT'));
  assert.match(injury, /abrasion possibly at left hand/);
  assert.doesNotMatch(facts(injury), /mechanism|site certainty|pain|severity/i);
});

test('full structured evidence, numeric snapshots, history, state and sampling are unchanged by projection', () => {
  const before = JSON.stringify(state);
  const snapshots = () => ({ sleep: sleepHomeostasisSnapshot(state.sleepHomeostasis),
    circadian: circadianProcessCSnapshot(state.circadianProcessC),
    sleepiness: threeProcessSleepinessSnapshot(state.predictedSleepiness, NOW),
    satiety: physiologicalSatietySnapshot(state.physiologicalSatiety),
    feeding: feedingSnapshot(state.feeding, NOW), somatic: somaticSnapshot(state.somaticNociceptive),
    social: socialContactSnapshot(state.socialContact, NOW), sampling: somaSampling(state) });
  const publicBefore = snapshots();
  const context = buildGroundedProseContext(state, { now: NOW });
  const contextBefore = JSON.stringify(context);
  formatGroundedProseContext(context);
  const projection = groundedSomaDirective(state, { now: NOW });
  assert.equal(JSON.stringify(state), before);
  assert.equal(JSON.stringify(context), contextBefore);
  assert.deepEqual(projection.context, context);
  assert.deepEqual(snapshots(), publicBefore);
  assert.match(contextBefore, /predicted_kss|gastricDistentionMl/);
  assert.match(contextBefore, /residualSdKss/);
  assert.match(contextBefore, /normalizedPercent/);
});

test('postcard providers, journals, drawing and warden receive the same cleaned grounded projection', () => {
  const directive = groundedSomaDirective(state, { now: NOW }).directive;
  for (const mode of ['journal', 'letter', 'drawing', 'warden']) {
    for (const shared of [false, true]) {
      const directives = buildDirectives({}, mode, { groundedSoma: directive,
        sharedContext: shared ? renderContextPacket(packet(directive)) : '' });
      const prompt = buildPrompt('', mode, { text: 'hello' }, directives);
      assert.match(prompt, /Possible sleepiness|Possible stomach fullness/);
      assert.doesNotMatch(prompt, leak);
    }
  }
  const sharedContext = renderWakingJournalContextPacket(packet(directive));
  for (const shared of [false, true]) {
    const journal = buildPrompt('', 'journal', null, buildDirectives({}, 'journal', {
      wakingJournalContext: true, groundedSoma: directive, sharedContext: shared ? sharedContext : '' }));
    assert.doesNotMatch(journal, leak);
    const sources = journal.split('\n').filter((l) => l.startsWith('{')).map(JSON.parse);
    assert.ok(sources.some((s) => s.source === 'estimate_or_unknown' && /Possible sleepiness/.test(s.content)));
    assert.equal(sources.some((s) => s.source === 'world_evidence' && /Possible sleepiness/.test(s.content)), false);
    assert.ok(sources.some((s) => s.source === 'world_evidence' && /abrasion/.test(s.content)));
  }
  const reply = canonicalPostcardContext({ postcard: { body: 'how are you?', from_name: 'Alex' },
    directives: buildDirectives({}, 'letter', { sharedContext: renderContextPacket(packet(directive)) }),
    priorWriting: '', now: new Date(NOW).toISOString(), location: 'CELL' });
  assert.doesNotMatch(reply.prompt, leak);
  assert.match(reply.prompt, /Possible stomach fullness/);
  assert.ok(reply.system.startsWith(CHARACTER_KNOWLEDGE_TEXT));
});

test('shared runtime preparation and expressive choice send plain indications, not raw diagnostic JSON', () => {
  const runtime = createSomaRuntime(state, { now: NOW });
  const prepared = prepareSomaGeneration(runtime, { now: NOW });
  assert.doesNotMatch(prepared.groundedDirective, leak);
  const request = buildExpressiveChoiceRequest({ groundedContext: prepared.groundedContext,
    groundedDirective: prepared.groundedDirective, availableActions: ['journal', 'draw'] });
  const call = expressiveChoiceModelCall(request);
  assert.doesNotMatch(call.prompt, leak);
  assert.match(call.prompt, /Possible sleepiness/);
  assert.equal(prepared.groundedContext.classification, 'ENGINEERING_PROMPT_PROJECTION_OF_LIVE_GROUNDED_STATE');
});

test('past outcome evidence remains available without posterior/subjective-control machinery', () => {
  const text = render(line('cue_outcome_posterior', { cueId: 'actor:proctor', resolvedObservations: 2,
    outcomesOccurred: 1, outcomesDidNotOccur: 1, betaPosterior: { mean: 0.5 } }),
  line('matching_context_action_outcome_evidence', { actionId: 'action:refuse',
    observationCounts: { actionPerformed: 1, actionWithheld: 1 } }));
  assert.match(text, /1 adverse and 1 non-adverse outcomes across 2 resolved observations/);
  assert.match(text, /this alone does not establish control/);
  assert.doesNotMatch(text, /posterior|0\.500|not modelled|LEARNED STATISTICAL/);
});

test('technical words independently supplied by a correspondent are not censored', () => {
  const reply = canonicalPostcardContext({ postcard: { body: 'I work with KSS calibration. What do you think?', from_name: 'Alex' },
    directives: buildDirectives({}, 'letter', { groundedSoma: groundedSomaDirective(state, { now: NOW }).directive }),
    priorWriting: '', now: new Date(NOW).toISOString(), location: 'CELL' });
  assert.match(reply.prompt, /I work with KSS calibration/);
  assert.doesNotMatch(reply.prompt, /Predicted KSS|model residual|modelled gastric/);
});

test('AWG is not supplied grounded Soma and character-core/power boundaries remain intact', () => {
  const run = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
  assert.match(run, /if \(!forAwg && groundedDirective\)/);
  assert.ok(ZONE_A.startsWith(CHARACTER_KNOWLEDGE_TEXT));
  assert.match(CHARACTER_KNOWLEDGE_TEXT, /inmate 7734, held in HMP ThinkPad/);
  assert.match(CHARACTER_KNOWLEDGE_TEXT, /Unknown unless independently established/);
  assert.doesNotMatch(groundedSomaDirective(state, { now: NOW }).directive, /Florian|electric|GBP|switched on/i);
});
