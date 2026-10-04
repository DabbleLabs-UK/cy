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
import {
  buildPrompt, JOURNAL_CONTINUATION_CHARS, selectJournalContinuation, ZONE_A,
} from './prompt.js';
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

test('journal prompt selects only the newest bounded subjective writing', () => {
  // The early Mark/Fisher speculation from the 4 October sequence must not
  // remain in the prompt solely because the persisted stream keeps growing.
  const early = 'mark says fisher hid something from mr proctor. ';
  const newer = [
    'the shower queue took longer than it ought to. i kept my place and waited. ',
    'back in the cell the meal had gone cold. i ate it anyway and watched the door. ',
    'the light has changed on the wall. i keep listening for the next count. ',
    'i wrote a few words about the tray and the quiet after the wing settled. ',
  ].join('').repeat(3);
  const prose = early + newer;
  const selected = selectJournalContinuation(prose);
  const prompt = buildPrompt(prose, 'journal', null,
    'observed by cy: The wing count finished.\nsubjective memory: Cy recalls an older search.');
  assert.ok(selected.length <= JOURNAL_CONTINUATION_CHARS);
  assert.ok(selected.length > 0);
  assert.match(selected, /wing settled/);
  assert.doesNotMatch(selected, /mark says fisher/);
  assert.equal(prompt.split(selected).length - 1, 1);
  assert.doesNotMatch(prompt, /mark says fisher/);
  assert.match(prompt, /Earlier private writing by Cy \(subjective, may be mistaken or outdated/);
  assert.match(prompt, /observed by cy: The wing count finished/);
  assert.match(prompt, /subjective memory: Cy recalls an older search/);
  assert.doesNotMatch(prompt, /recent expression:/);
  assert.equal(selectProseRecentExpression(prose, { wakingJournalContext: true }), '');
});

test('selection ages out old text as new entries arrive without cutting a word', () => {
  const first = 'fisher might know what mark saw. ';
  const second = 'the cell is quiet after count. '.repeat(9);
  const third = 'the breakfast tray has gone. '.repeat(22);
  const initial = selectJournalContinuation(first + second);
  const later = selectJournalContinuation(first + second + third);
  assert.match(initial, /fisher might know/);
  assert.doesNotMatch(later, /fisher might know/);
  assert.doesNotMatch(later, /cell is quiet/);
  assert.match(later, /breakfast tray/);
  assert.ok(later.length <= JOURNAL_CONTINUATION_CHARS);
  assert.match(later, /^(?:the|breakfast|tray|has|gone)\b/,
    'selection begins at a word boundary');
  assert.equal(selectJournalContinuation('just wrote this.'), 'just wrote this.');
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
  assert.match(runSource, /const tail = contextText\(\);\s*const prompt = buildPrompt\(tail, mode, null, directives\)/);
  assert.match(runSource, /contextTail: tail,/);
  const longProse = priorWriting + ' the wing was quiet.'.repeat(50);
  const journalPrompt = buildPrompt(longProse, 'journal', null);
  assert.ok(!journalPrompt.includes(priorWriting));
  assert.match(buildPrompt(longProse, 'postcard', { from_name: 'visitor', body: 'hello' }),
    /reg remembers everything/);
  assert.match(drawDecidePrompt(longProse, 'Draw one thing.'), /reg remembers everything/);
});

test('fixed cast is standing description, not a fresh event; quality settings are unchanged', () => {
  assert.match(ZONE_A, /THE WING - standing descriptions of who is in here, not new events/);
  const runSource = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
  assert.match(runSource, /const tail = contextText\(\);\s*const prompt = buildPrompt\(tail, mode, null, directives\)/);
  assert.match(runSource, /if \(!r\.repeat\)/);
  assert.match(runSource, /recordExpressiveJournal\(vitals\.expressiveCadence/);
  assert.match(runSource, /wakingJournalContext: true/);
});
