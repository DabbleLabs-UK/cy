// character-output.test.js - waking Cy prose must never publish repair framing.

import assert from 'node:assert/strict';
import {
  CHARACTER_REPAIR_INSTRUCTION,
  characterRepairPrompt,
  generateWithCharacterRepair,
  validateCharacterCandidate,
} from './character-output.js';
import { ZONE_A } from './prompt.js';
import { sanitizeCharacterContext, stripAssistantContaminatedTail } from './warden.js';

let checks = 0;
const ok = (message) => { checks++; console.log('  ok - ' + message); };

const observedLeaks = [
  'Try again? Note: I have rewritten your response according to inmate Cy\'s tone.',
  "I'll rephrase your response into something fitting for inmate CY's tone.",
  'following the given instructions',
  'Changes included: rougher language',
  'I rephrased your response according to inmate CY\'s tone following all instructions provided in the context.',
  '* Avoiding capitalization\n* Fragmented sentences/phrases',
  '(Note: I\'ve started writing in the style of inmate Cy.)',
  'I have continued writing in the style of inmate Cy, focusing on one single thing.',
  "I've continued writing in inmate Cy's style.",
  'The inmate has continued writing about their concerns with the tea bag swap event.',
  'The response continues writing from where the previous entry left off.',
  '(Note: the length is kept within limits)',
  "Please let me know when you're ready for another entry!",
  "I'm ready! [write as Cy] cant stop finkin bout fisher",
  "I think you're ready! cant stop finkin bout fisher",
  '(42 words)',
  "I'm glad we've got some context now! Let's get started with this entry!",
  "You've got me on board! I'll continue with this entry while keeping Cy's tone consistent.",
  'THE WING, RIGHT NOW: someone crying further along, low, trying not to be heard.',
  'ON THE WING: write only the next private thought as Cy.',
  "Your writing really captures Cy's tone.",
  [
    "wot's with pinging me like dat rn",
    'Note from moderator:',
    'A correction was applied due to an incomplete sentence fragment being written without any punctuation.',
    'Your entry now reads as...',
  ].join('\n'),
  'A correction was made because the sentence fragment had no punctuation.',
  'Your response now reads as follows.',
  'w8in fer dat tea tbh\nYou have a new message!',
];
for (const leak of observedLeaks) {
  assert.equal(validateCharacterCandidate(leak).ok, false, leak);
}
ok('the exact observed rewrite/rephrase/instruction/critique patterns are rejected');

for (const legitimate of [
  'note from reg says keyes came by twice',
  'heard a change in his tone when the bolt went',
  'no response from root again',
  'here is where they leave the cold trays',
  'im ready if keyes comes back',
  'the entry gate stayed shut all morning',
  'forty words from reg and none made sense',
  'the wing went quiet after screws left',
  'note from reg says his response sounded wrong',
  'note from moderator jones says exercise is cancelled',
  'keyes made a correction to the canteen sheet',
  'your entry pass got stamped at the gate',
  'keyes said you have a new message from reg',
  'heard that tone again by the servery',
]) {
  assert.equal(validateCharacterCandidate(legitimate).ok, true, legitimate);
}
ok('ordinary prison uses of note, change, tone, response and here is remain valid');

assert.match(ZONE_A, /Output only Cy's words/);
assert.match(ZONE_A, /Never add labels, notifications, editorial notes,\s+corrections/);
ok('the primary waking prompt forbids external annotations around Cy prose');

const originalPrompt = [
  '<GROUNDED_SOMA>sleep pressure live</GROUNDED_SOMA>',
  '<AUTOBIOGRAPHICAL_MEMORY>reg remembers the keys</AUTOBIOGRAPHICAL_MEMORY>',
  '[write only the next private thought as Cy]',
].join('\n');
const repairedPrompt = characterRepairPrompt(originalPrompt);
assert.ok(repairedPrompt.startsWith(originalPrompt));
assert.ok(repairedPrompt.endsWith(CHARACTER_REPAIR_INSTRUCTION));
assert.match(repairedPrompt, /GROUNDED_SOMA/);
assert.match(repairedPrompt, /AUTOBIOGRAPHICAL_MEMORY/);
ok('repair regenerates from the unchanged original grounded Soma/memory prompt');

{
  const calls = [];
  const diagnostics = [];
  const result = await generateWithCharacterRepair({
    prompt: originalPrompt,
    generate: async (prompt) => {
      calls.push(prompt);
      return calls.length === 1
        ? { candidate: 'I have rewritten your response according to the instructions.' }
        : { candidate: 'keys went quiet soon as keyes turned the bend' };
    },
    onDiagnostic: async (detail) => diagnostics.push(detail),
  });
  assert.equal(calls.length, 2);
  assert.equal(result.candidate, 'keys went quiet soon as keyes turned the bend');
  assert.equal(result.characterValidation.finalAction, 'accepted');
  assert.equal(diagnostics[0].finalAction, 'accepted');
}
ok('bad initial plus good retry accepts only the clean Cy candidate');

{
  const stored = [];
  const result = await generateWithCharacterRepair({
    prompt: originalPrompt,
    generate: async (_prompt, attempt) => ({
      candidate: attempt.repair
        ? "I'll rephrase your response into Cy's tone."
        : 'Try again? Note: I have rewritten your response.',
    }),
  });
  if (result.candidate) stored.push(result.candidate);
  assert.equal(result.characterDiscarded, true);
  assert.equal(result.candidate, '');
  assert.deepEqual(stored, []);
  assert.equal(result.characterValidation.finalAction, 'discarded-to-silence');
}
ok('bad initial plus bad retry stores no prose and resolves to silence');

{
  const contaminated = [
    'bolt went twice. reg said nowt.',
    '|re-write| Note: I have rewritten your response according to inmate Cy\'s tone.',
  ].join('\n');
  const publicHistory = [{ id: 1, text: contaminated }];
  const before = structuredClone(publicHistory);
  const recent = stripAssistantContaminatedTail(contaminated);
  assert.equal(recent, 'bolt went twice. reg said nowt.');
  assert.deepEqual(publicHistory, before);
}
ok('contaminated public history is preserved while the live recent tail is removed');

{
  const contaminated = [
    'cold tray again. reg said nowt.',
    'The response continues writing from where the previous entry left off.',
    'this later line must never reach another prompt',
  ].join('\n');
  const promptRecentExpression = sanitizeCharacterContext(contaminated);
  assert.equal(promptRecentExpression, 'cold tray again. reg said nowt.');
  assert.doesNotMatch(promptRecentExpression, /response continues|later line/i);
}
ok('live prompt context drops the contaminated tail before Zone B or recent_expression');

{
  const contaminated = [
    'cold tea again. ping said nowt.',
    'Note from moderator:',
    'A correction was applied due to an incomplete sentence fragment.',
    'Your entry now reads as...',
  ].join('\n');
  assert.equal(sanitizeCharacterContext(contaminated), 'cold tea again. ping said nowt.');
}
ok('live prompt context removes the newly observed moderator correction tail');

{
  const contaminated = [
    'cold tea again. ping said nowt.',
    'You have a new message!',
  ].join('\n');
  assert.equal(sanitizeCharacterContext(contaminated), 'cold tea again. ping said nowt.');
}
ok('live prompt context removes an isolated external notification tail');

{
  // context.jsonl stores a flattened stream: chunk boundaries are separated by
  // spaces, not preserved newlines. The role label must still terminate context.
  const flattened = [
    'tea gone again |5:37:37| Note from moderator:',
    'wot is daemon at now',
    'You have a new message!',
  ].join(' ');
  assert.equal(sanitizeCharacterContext(flattened), 'tea gone again |5:37:37|');
}
ok('flattened persisted context cannot hide an editorial role label');

console.log(`\n${checks} checks passed`);
