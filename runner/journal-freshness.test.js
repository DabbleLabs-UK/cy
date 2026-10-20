import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  journalSubjectFromWorldRecord, journalSubjectReceipts, selectJournalTurn,
  JOURNAL_SUBJECT_RECEIPTS, makeIncident,
} from './incidents.js';
import { buildPrompt, turnDirective, options, completionBudget } from './prompt.js';
import { loadVitals, saveVitals } from './vitals.js';
import { replayJournalFreshness } from './replay-journal-freshness.mjs';

const baseline = Date.parse('2026-10-19T08:00:00Z');
function record(id, summary, extra = {}) {
  return {
    world_event: { id, timestamp: new Date(baseline + 1000).toISOString(),
      event_type: 'overheard', world: { context: { location: 'wing', description: summary },
        participants: { actor: 'officers' }, ...extra } },
    observation: { summary, modality: 'heard', certainty: 'probable', observed_facts: {} },
  };
}
function event(r, cyObserved = true) {
  return { id: r.world_event.id, cyObserved,
    journalSubject: journalSubjectFromWorldRecord(r, { cyObserved }) };
}
function select(events, more = {}) {
  return selectJournalTurn([], { lastJournalAtMs: baseline,
    nowMs: baseline + 10000, worldEvents: events, ...more });
}

test('timestamp, observation count and elapsed-only differences do not create freshness', () => {
  const a = record('one', 'officers are discussing unsigned keys');
  a.observation.observed_facts = { source: 'officers', elapsedMs: 62000, observation_count: 1 };
  const old = select([event(a)]);
  const b = structuredClone(a);
  b.world_event.id = 'two';
  b.world_event.timestamp = new Date(baseline + 3000).toISOString();
  b.observation.observed_facts.elapsedMs = 152000;
  b.observation.observed_facts.observation_count = 8;
  assert.equal(select([event(b)], { seenKeys: old.seenKeys }).nothingNew, true);
});

test('random quiet-voice ledger paraphrases cannot replace a canonical discussion', () => {
  const r = record('keys', 'Miss Bailey and Mr Keyes discussed keys not signed back in', {
    context: { location: 'wing', description: 'Miss Bailey and Mr Keyes discussed keys not signed back in',
      associated_entities: ['bailey', 'keyes'] },
  });
  const ledger = ['two voices at the desk', 'someone two cells along', 'the screws by the gate']
    .map((actor, i) => ({ actor, verb: 'talking low', detail: ['could not make it out',
      'your number in it maybe', 'then it stopped'][i], sourceEventId: 'keys',
    evidenceClass: 'OBSERVED_EVENT', ts: new Date(baseline + 1000 + i).toISOString() }));
  const first = selectJournalTurn(ledger, { lastJournalAtMs: baseline,
    nowMs: baseline + 10000, worldEvents: [event(r)] });
  assert.match(first.freshLine, /keys not signed back in/);
  assert.doesNotMatch(first.freshLine, /talking low/);
  assert.equal(selectJournalTurn(ledger, { lastJournalAtMs: baseline,
    nowMs: baseline + 10000, worldEvents: [event(r)], seenKeys: first.seenKeys }).nothingNew, true);
});

test('same underlying hearing with a different perceptual variant is not a new incident', () => {
  const r = record('first', 'Miss Bailey and Mr Keyes discussed keys not signed back in');
  const first = select([event(r)]);
  const b = structuredClone(r);
  b.world_event.id = 'second';
  b.observation.summary = 'Miss Bailey said my number, maybe a key for or against me';
  b.observation.certainty = 'uncertain';
  b.observation.observed_facts.misheard = true;
  assert.equal(select([event(b)], { seenKeys: first.seenKeys }).nothingNew, true);
  const initialUncertain = select([event(b)]);
  assert.match(initialUncertain.freshLine, /^half-heard, uncertain:/);
  assert.doesNotMatch(initialUncertain.freshLine, /not signed back/,
    'do not reveal hidden objective wording to Cy');
});

test('material outcome, person, object or episode changes remain immediately eligible', () => {
  const r = record('a', 'The search found nothing', {
    search_episode: { id: 'search-a', stage: 'PROPERTY_RESULT', property_result: 'NOTHING_FOUND' },
  });
  r.world_event.event_type = 'cell_search_property_result';
  const first = select([event(r)]);
  for (const change of [
    (b) => { b.world_event.world.search_episode.property_result = 'ITEM_FOUND'; },
    (b) => { b.world_event.world.search_episode.id = 'search-b'; },
    (b) => { b.world_event.world.participants.actor = 'trace'; },
    (b) => { b.world_event.world.search_episode.object_id = 'object-2'; },
  ]) {
    const b = structuredClone(r); b.world_event.id = 'new'; change(b);
    assert.equal(select([event(b)], { seenKeys: first.seenKeys }).nothingNew, false);
  }
});

test('actual direct confirmation can materially develop an earlier uncertain hearing', () => {
  const heard = record('hearing', 'keys were not signed back in');
  heard.observation.certainty = 'uncertain';
  const first = select([event(heard)]);
  const confirmed = structuredClone(heard); confirmed.world_event.id = 'confirmation';
  confirmed.observation.modality = 'direct'; confirmed.observation.certainty = 'certain';
  assert.equal(select([event(confirmed)], { seenKeys: first.seenKeys }).nothingNew, false);
});

test('new real meal episode is eligible, elapsed meal instrumentation and journal prose are not', () => {
  const ledger = [62, 152].map((minutes) => ({ ts: new Date(baseline + minutes).toISOString(),
    evidenceClass: 'SUBJECTIVE_BELIEF', detail: `food intake recorded ${minutes} minutes ago` }));
  assert.equal(selectJournalTurn(ledger, { lastJournalAtMs: baseline,
    lastIncidentMs: baseline + 999 }).nothingNew, true);
  const a = record('meal', 'breakfast was eaten', {
    physical: { food: { meal_id: 'breakfast-1', consumed: 'full' } },
  });
  a.world_event.event_type = 'breakfast_eaten';
  const first = select([event(a)]);
  const b = structuredClone(a); b.world_event.id = 'meal-new';
  b.world_event.world.physical.food.meal_id = 'breakfast-2';
  assert.equal(select([event(b)], { seenKeys: first.seenKeys }).nothingNew, false);
  a.world_event.event_type = 'CY_EXPRESSION';
  assert.equal(event(a).journalSubject, null);
});

test('typed meal evidence compares intake facts rather than a changing elapsed caption', () => {
  const a = record('meal-observation-1', 'food intake recorded 62 minutes ago', {
    physical: { food: { meal_id: 'breakfast-1', consumed: 'full' } },
  });
  a.world_event.event_type = 'meal_intake_observed'; a.world_event.archetype_id = 'meal';
  const first = select([event(a)]);
  const b = structuredClone(a); b.world_event.id = 'meal-observation-2';
  b.world_event.world.context.description = 'food intake recorded 152 minutes ago';
  b.observation.summary = b.world_event.world.context.description;
  b.observation.observed_facts.elapsed_minutes = 152;
  assert.equal(select([event(b)], { seenKeys: first.seenKeys }).nothingNew, true);
  b.world_event.world.physical.food.consumed = 'partial';
  assert.equal(select([event(b)], { seenKeys: first.seenKeys }).nothingNew, false);
});

test('Bailey/name observation is eligible with a canonical source; texture alone is not certified', () => {
  const ledger = [{ ...makeIncident('texture', { rnd: () => 0.21 }),
    actor: 'Miss Bailey', verb: 'said your name properly', detail: 'for once',
    ts: new Date(baseline + 1000).toISOString() }];
  assert.equal(selectJournalTurn(ledger, { lastJournalAtMs: baseline }).nothingNew, true);
  const r = record('name-event', 'Miss Bailey said your name properly', {
    participants: { actor: 'bailey', target: 'cy' },
    social: { episode_id: 'name-contact', contact_form: 'DIRECT_INTERACTION' },
  });
  r.world_event.event_type = 'officer_kindness'; r.observation.modality = 'direct';
  assert.match(select([event(r)]).freshLine, /Bailey said your name properly/);
});

test('past/future/offscreen/missing/unverified source records cannot manufacture freshness', () => {
  const r = record('old', 'the officers completed a search');
  r.world_event.timestamp = new Date(baseline - 1000).toISOString();
  assert.equal(select([event(r)]).nothingNew, true);
  r.world_event.timestamp = new Date(baseline + 20000).toISOString();
  assert.equal(select([event(r)]).nothingNew, true);
  r.world_event.timestamp = new Date(baseline + 1000).toISOString();
  assert.equal(select([event(r, false)]).nothingNew, true);
  const bad = event(r); bad.id = 'not-the-source';
  assert.equal(select([bad]).nothingNew, true);
  assert.equal(select([]).nothingNew, true);
  assert.match(turnDirective(select([])), /may develop an existing thought/);
});

test('correspondence remains a new arrival without exposing sender-scoped content through the selector', () => {
  const r = record('mail-1', 'private sender fact', {
    participants: { actor: 'private handle', relationship_ref: 'private-visitor-id' },
    social: { episode_id: 'postcard:1', actor_id: 'private-visitor-id' },
  });
  r.world_event.event_type = 'postcard';
  const turn = select([event(r)]);
  assert.equal(turn.freshLine, 'a postcard arrived');
  assert.doesNotMatch(JSON.stringify(event(r).journalSubject), /private sender|private handle|private-visitor/);
  r.world_event.event_type = 'postcard_reply';
  assert.equal(select([event(r)]).freshLine, 'Cy sent a reply to a postcard');
});

test('receipts are bounded hashes, deterministic across field order, and survive history eviction', () => {
  const a = record('a', 'a factual discussion');
  const first = select([event(a)]);
  const b = structuredClone(a); b.world_event.id = 'b';
  b.world_event.world.participants = { actor: 'officers' };
  assert.equal(select([event(b)], { seenKeys: first.seenKeys }).nothingNew, true);
  assert.deepEqual(first, select([event(a)]));
  assert.equal(journalSubjectReceipts(Array.from({ length: 300 }, (_, n) =>
    n.toString(16).padStart(64, '0'))).length, JOURNAL_SUBJECT_RECEIPTS);
  assert.deepEqual(journalSubjectReceipts(['private prose', null, first.seenKeys[0]]), first.seenKeys);
});

test('restart checkpoint retains engineering receipts without changing Soma or public history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cy-journal-freshness-'));
  try {
    const path = join(dir, 'vitals.json');
    const v = await loadVitals(path);
    v.journalSubjectKeys = select([event(record('a', 'a factual discussion'))]).seenKeys;
    const before = structuredClone(v.mental);
    await saveVitals(path, v);
    const restored = await loadVitals(path);
    assert.deepEqual(restored.journalSubjectKeys, v.journalSubjectKeys);
    assert.deepEqual(restored.mental, before);
    assert.equal(select([event(record('new-id', 'a factual discussion'))],
      { seenKeys: restored.journalSubjectKeys }).nothingNew, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('receipt consumption is publication-bound; voice, continuation, model options and output cap stay unchanged', async () => {
  const source = await readFile(new URL('./run.js', import.meta.url), 'utf8');
  assert.match(source, /else if \(burstEmitted\.trim\(\)\) \{[\s\S]*?vitals\.journalSubjectKeys = burstJournalTurn\.seenKeys/);
  assert.equal((source.match(/vitals\.journalSubjectKeys = burstJournalTurn\.seenKeys/g) || []).length, 1);
  const prior = 'earlier subjective writing '.repeat(70);
  const prompt = buildPrompt(prior, 'journal', null, turnDirective(select([])));
  assert.match(prompt, /subjective, may be mistaken or outdated; not evidence/);
  assert.equal((prompt.match(/Earlier private writing by Cy/g) || []).length, 1);
  assert.match(prompt, /rough lower-case prison voice/);
  assert.equal(completionBudget(62), 93);
  assert.equal(options({}, 4, 'journal').num_ctx, 3072);
});

test('retained 30-entry production subject replay uses exact context times and yields 19 fresh / 11 continuation', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/journal-freshness-20261020.json', import.meta.url), 'utf8'));
  const replay = replayJournalFreshness(fixture);
  assert.equal(fixture.inputs.length, 30);
  assert.equal(replay.oldFresh, 27);
  assert.equal(fixture.inputs.filter((x) => /talking low/.test(x.oldFreshLine)).length, 18);
  assert.equal(replay.fresh, 19);
  assert.equal(replay.continuation, 11);
  for (const decision of replay.decisions) {
    assert.doesNotMatch(decision.freshLine, /food intake recorded|minutes ago|talking low/);
    if (!decision.fresh) continue;
    const input = fixture.inputs.find((x) => x.seq === decision.seq);
    assert.ok(input.worldEventIds.includes(decision.sourceEventId));
    assert.ok(Date.parse(input.opportunityAt) <= Date.parse(input.inputAt));
    assert.ok(Date.parse(input.inputAt) < Date.parse(input.publishedAt));
  }
  const byId = new Map(replay.decisions.map((d) => [d.seq, d]));
  assert.equal(byId.get(2713356).fresh, false, 'new quiet-voice alias of already available hearing');
  assert.match(byId.get(2713599).freshLine, /full lockdown was called/, 'actual lockdown is not suppressed');
  assert.equal(byId.get(2714141).fresh, false, 'Bailey name texture is not canonical evidence');
  assert.equal(byId.get(2734721).fresh, false, 'recycled 62-minute prose cannot become a fresh subject');
  assert.match(byId.get(2714883).freshLine, /handed it over/, 'an actual institutional consequence remains eligible');
  assert.match(byId.get(2751645).freshLine, /lockdown was lifted/, 'changed regime remains eligible');
});

test('real retained unsigned-keys discussions compare by the same source content, not later mishearing', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/journal-freshness-20261020.json', import.meta.url), 'utf8'));
  const keys = fixture.records.filter((r) => r.world_event.event_type === 'overheard'
    && /keys not signed back in/.test(r.world_event.world.context?.description || ''));
  assert.ok(keys.length >= 2);
  const fingerprints = keys.map((r) => journalSubjectFromWorldRecord(r, { cyObserved: true }).materialKey);
  assert.equal(new Set(fingerprints).size, 1);
  assert.ok(keys.some((r) => r.observation.certainty === 'uncertain'));
});
