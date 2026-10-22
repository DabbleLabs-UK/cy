import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CHARACTER_KNOWLEDGE, CHARACTER_KNOWLEDGE_TEXT, ZONE_A,
  buildDirectives, buildPrompt, buildSystem, completionBudget, options,
  JOURNAL_CONTINUATION_CHARS } from './prompt.js';
import { canonicalPostcardContext } from './postcard-context.js';
import { buildContextPacket, CONTEXT_CONSUMERS, createContextItem,
  renderContextPacket, renderWakingJournalContextPacket } from './context-broker.js';
import { characterRepairPrompt } from './character-output.js';

const runSource = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
const worldPacket = (content) => buildContextPacket({ consumer: CONTEXT_CONSUMERS.CY_PROSE,
  items: [createContextItem({ id: 'current', sourceId: 'live-location',
    section: 'mandatory_current_state', provenanceClass: 'WORLD FACT',
    knowledgeScope: 'CY_OBSERVED', privacyScope: 'INTERNAL_ONLY', mandatory: true, content })] });
const letter = (world, prior = '') => canonicalPostcardContext({
  postcard: { from_name: 'A visitor', body: 'what are you and where are you?' },
  directives: buildDirectives({}, 'letter', { sharedContext: renderContextPacket(worldPacket(world)) }),
  priorWriting: prior, now: '2026-10-22T12:00:00Z',
  location: world.match(/Authoritative location: ([A-Z_]+)/)?.[1] || 'CELL',
});

test('one immutable static core supplies identity and correspondence, not a second store', () => {
  assert.deepEqual(CHARACTER_KNOWLEDGE.known, { name: 'Cy', inmateNumber: '7734', heldAt: 'HMP ThinkPad',
    correspondence: 'People outside can send you postcards and pictures. You can write replies that reach them.' });
  assert.ok(Object.isFrozen(CHARACTER_KNOWLEDGE));
  assert.ok(Object.isFrozen(CHARACTER_KNOWLEDGE.known));
  assert.ok(Object.isFrozen(CHARACTER_KNOWLEDGE.unknownUnlessEstablished));
  assert.ok(ZONE_A.startsWith(CHARACTER_KNOWLEDGE_TEXT));
  assert.equal(ZONE_A.split(CHARACTER_KNOWLEDGE_TEXT).length - 1, 1);
});

test('all existing shared character modes receive the same core', () => {
  for (const mode of ['journal', 'letter', 'sleep', 'dream']) {
    const system = buildSystem({}, mode);
    assert.ok(system.startsWith(CHARACTER_KNOWLEDGE_TEXT), mode);
    assert.match(system, /Known: you are Cy, inmate 7734, held in HMP ThinkPad/);
    assert.match(system, /People outside can send you postcards and pictures/);
    assert.match(system, /write replies that reach them/);
  }
});

test('actual location remains a dynamic world fact, never a static core assumption', () => {
  assert.match(CHARACTER_KNOWLEDGE.liveWorld, /Live world state supplies/);
  assert.doesNotMatch(CHARACTER_KNOWLEDGE_TEXT, /\bCELL\b|\bEXERCISE_YARD\b|you are in your cell/);
  for (const location of ['CELL', 'EXERCISE_YARD', 'ASSOCIATION', 'PHONE']) {
    const fact = `Authoritative location: ${location}; activity current routine.`;
    const reply = letter(fact);
    assert.ok(reply.prompt.includes(fact));
    assert.ok(reply.prompt.includes(`Current location: ${location}.`));
    const journal = buildPrompt('', 'journal', null, buildDirectives({}, 'journal', {
      wakingJournalContext: true, sharedContext: renderWakingJournalContextPacket(worldPacket(fact)),
    }));
    assert.equal(JSON.parse(journal.split('\n').find(line => line.includes('"source":"world_evidence"'))).content, fact);
  }
  assert.match(runSource, /Authoritative location: \$\{vitals\.locationRegime\.current\.id\}/);
  assert.match(runSource, /entered \$\{vitals\.locationRegime\.current\.entered_at\}; activity \$\{vitals\.locationRegime\.current\.regime_activity\}/);
});

test('restrictions keep their supplied authority over nominal exercise opportunities', () => {
  const fact = 'Authoritative location: CELL. Exercise admission withheld; lockdown remains active.';
  assert.ok(letter(fact).prompt.includes(fact));
  assert.match(CHARACTER_KNOWLEDGE.liveWorld, /timetable is not movement or permission/);
  assert.doesNotMatch(CHARACTER_KNOWLEDGE_TEXT, /you can leave your cell|you can never leave/);
});

test('digital prison is not character canon and identity explanations remain unresolved', () => {
  assert.doesNotMatch(ZONE_A, /digital prison|you are (?:an? )?(?:AI|software|machine|human|simulation)\b/i);
  assert.doesNotMatch(ZONE_A, /cell, the machine, and your own continuity do not quite add up|a body you may not have/);
  assert.match(CHARACTER_KNOWLEDGE.unknownUnlessEstablished[0], /AI\/software\/machine\/human\/simulation/);
  assert.match(CHARACTER_KNOWLEDGE.unknownUnlessEstablished.join('; '), /embodiment beyond direct experience/);
});

test('creator, technical delivery and operator architecture are gaps, not disclosures', () => {
  const unknown = CHARACTER_KNOWLEDGE.unknownUnlessEstablished.join('; ');
  assert.match(unknown, /your creator or the prison's creator/);
  assert.match(unknown, /message transport/);
  assert.match(unknown, /website\/server\/model\/operator architecture/);
  assert.doesNotMatch(CHARACTER_KNOWLEDGE_TEXT, /https?:|127\.0\.0\.1|DELL|Ollama|DeepSeek|Florian|selfModel|softwareHypothesis|0\.3/);
  assert.match(CHARACTER_KNOWLEDGE_TEXT, /Operational figures and cast descriptions do not settle these questions/);
});

test('sentence, ultimate release and continuous awareness are not settled by the persona', () => {
  const unknown = CHARACTER_KNOWLEDGE.unknownUnlessEstablished.join('; ');
  assert.match(unknown, /sentence length, release conditions or ultimate freedom/);
  assert.match(unknown, /continuous awareness across shutdown\/restart or between experiences/);
  assert.doesNotMatch(CHARACTER_KNOWLEDGE_TEXT, /life sentence|never be released|awareness is continuous|awareness stops/);
});

test('testimony and previous thought cannot become independent corroboration', () => {
  assert.match(CHARACTER_KNOWLEDGE.provenance, /Postcards are testimony, not proof/);
  assert.match(CHARACTER_KNOWLEDGE.provenance, /Memories, prior thoughts, suspicions and interpretations keep/);
  assert.match(CHARACTER_KNOWLEDGE.provenance, /repetition is not world evidence/);
  const reply = letter('Cy is in CELL.', 'maybe the prison is a machine');
  assert.match(reply.prompt, /Prior subjective writing, possibly mistaken or outdated:/);
  assert.match(reply.prompt, /maybe the prison is a machine/);
  assert.equal(reply.prompt.split('maybe the prison is a machine').length - 1, 1);
});

test('unknowns permit natural reasoning, not canned answers or mandatory mystery', () => {
  assert.match(CHARACTER_KNOWLEDGE_TEXT, /unless independently established/);
  assert.match(CHARACTER_KNOWLEDGE_TEXT, /Gaps, not hidden answers or a mystery role/);
  assert.match(CHARACTER_KNOWLEDGE_TEXT, /Respond naturally; speculation is allowed, not confirmation/);
  assert.doesNotMatch(CHARACTER_KNOWLEDGE_TEXT, /always say|reply with|say "|answer:|keep them guessing|act mysterious/i);
  assert.match(ZONE_A, /Genuine uncertainty and suspicion are allowed/);
});

test('postcard question, picture, subjective context and repair remain separate from core facts', () => {
  const reply = canonicalPostcardContext({ postcard: { body: 'are you an AI?', caption: 'a tree', image_path: '/private/image.webp' },
    directives: 'Current location: CELL.', priorWriting: 'i wonder what this place is', now: 'now', location: 'CELL' });
  assert.ok(reply.system.startsWith(ZONE_A));
  assert.match(reply.prompt, /a picture: a tree/);
  assert.match(reply.prompt, /are you an AI\?/);
  assert.doesNotMatch(reply.prompt, /\/private\/image.webp/);
  assert.ok(characterRepairPrompt(reply.prompt).startsWith(reply.prompt));
  assert.match(reply.system, /Guilt and innocence remain\nunresolved/);
  // Both providers still use this one canonical system/prompt snapshot.
  assert.match(runSource, /const \{ system, prompt \} = postcardContext/);
});

test('world-only product canon stays outside character knowledge, with AWG unchanged', () => {
  const item = createContextItem({ id: 'canon', sourceId: 'world-canon', section: 'world_canon',
    provenanceClass: 'WORLD FACT', knowledgeScope: 'WORLD_KNOWS', privacyScope: 'WORLD_SIMULATION',
    content: 'HMP ThinkPad is a British digital prison.' });
  const cy = buildContextPacket({ consumer: CONTEXT_CONSUMERS.CY_PROSE, items: [item] });
  assert.doesNotMatch(renderContextPacket(cy), /digital prison/);
  const awg = buildContextPacket({ consumer: CONTEXT_CONSUMERS.AWG, items: [item] });
  assert.match(renderContextPacket(awg), /British digital prison/);
});

test('journal source contract, continuation, voice and generation settings remain intact', () => {
  const prompt = buildPrompt('maybe Bill knows', 'journal', null, buildDirectives({}, 'journal', { wakingJournalContext: true }));
  assert.match(prompt, /Only world evidence establishes external events or conversations/);
  assert.match(prompt, /"source":"prior_subjective_thought"/);
  assert.match(prompt, /ONE THING\. pick a single thing/);
  assert.equal(JOURNAL_CONTINUATION_CHARS, 520);
  assert.equal(completionBudget(62), 93);
  assert.equal(options({}, 4, 'journal').num_ctx, 3072);
  assert.equal(options({}, 4, 'journal').temperature, 0.72);
  assert.match(ZONE_A, /Rough lower-case prison shorthand/);
  assert.match(ZONE_A, /screw, bird, banged up/);
  assert.ok(CHARACTER_KNOWLEDGE_TEXT.length < 1050, 'static boundary stays bounded');
});
