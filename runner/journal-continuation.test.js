import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CONTEXT_CONSUMERS,
  buildContextPacket,
  createContextItem,
  renderWakingJournalContextPacket,
  selectProseRecentExpression,
} from './context-broker.js';
import { buildPrompt, ZONE_A } from './prompt.js';
import { drawDecidePrompt } from './draw.js';

// Representative material and section mix from the natural 20:49-21:37
// context packets. The repeated Reg/Mark/Root claim was prior prose, while the
// current location, recent wing event and selected memory were separate sources.
const priorWriting = 'reg remembers everything. mark knew something about root.';
const worldObservation = 'Two voices stopped talking on the wing.';
const memory = 'Cy remembers an earlier search of his cell.';
const item = (id, section, provenanceClass, knowledgeScope, content) => createContextItem({
  id, sourceId: id, section, provenanceClass, knowledgeScope,
  privacyScope: 'INTERNAL_ONLY', content,
});

test('waking journal uses prior prose once as subjective continuation, never observed evidence', () => {
  assert.equal(selectProseRecentExpression(priorWriting, { wakingJournalContext: true }), '');
  const packet = buildContextPacket({
    consumer: CONTEXT_CONSUMERS.CY_PROSE,
    items: [
      item('location', 'mandatory_current_state', 'WORLD FACT', 'CY_OBSERVED', 'Cy is in CELL.'),
      item('wing', 'recent_events', 'OBSERVED BY CY', 'CY_OBSERVED', worldObservation),
      item('memory', 'autobiographical_memory', 'SUBJECTIVE MEMORY', 'CY_BELIEVES', memory),
    ],
  });
  const rendering = renderWakingJournalContextPacket(packet);
  const prompt = buildPrompt(priorWriting, 'journal', null, rendering);
  assert.equal(prompt.split(priorWriting).length - 1, 1);
  assert.match(prompt, /Earlier private writing by Cy \(subjective, may be mistaken or outdated/);
  assert.doesNotMatch(prompt, /recent expression:/);
  assert.doesNotMatch(prompt, /observed by cy: reg remembers everything/i);
  assert.match(prompt, /world fact: Cy is in CELL/);
  assert.match(prompt, /observed by cy: Two voices stopped talking on the wing/);
  assert.match(prompt, /subjective memory: Cy remembers an earlier search/);
  assert.match(rendering, /Source labels distinguish observations, memories and estimates/);
});

test('journal exclusion is wired after caller options; other expression paths retain context', () => {
  const runSource = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
  assert.match(runSource, /wakingJournalContext: true/);
  assert.match(runSource, /\.\.\.brokerOptions,\s*recentExpression: selectProseRecentExpression\(/);
  assert.match(runSource, /\{ wakingJournalContext: brokerOptions\.wakingJournalContext \}/);
  assert.match(runSource, /section: 'recent_expression',[\s\S]*?provenanceClass: 'SUBJECTIVE BELIEF', knowledgeScope: 'CY_BELIEVES'/);
  assert.equal(selectProseRecentExpression(priorWriting), priorWriting);
  assert.match(buildPrompt(priorWriting, 'postcard', { from_name: 'visitor', body: 'hello' }),
    /reg remembers everything/);
  assert.match(drawDecidePrompt(priorWriting, 'Draw one thing.'), /reg remembers everything/);
  assert.match(runSource, /recentExpressionText: contextText\(\)\.slice\(-640\)/);
});

test('fixed cast is standing description, not a fresh event; quality settings are unchanged', () => {
  assert.match(ZONE_A, /THE WING - standing descriptions of who is in here, not new events/);
  const runSource = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
  assert.match(runSource, /const tail = contextText\(\);\s*const prompt = buildPrompt\(tail, mode, null, directives\)/);
  assert.match(runSource, /if \(!r\.repeat\)/);
  assert.match(runSource, /recordExpressiveJournal\(vitals\.expressiveCadence/);
  assert.match(runSource, /wakingJournalContext: true/);
});
