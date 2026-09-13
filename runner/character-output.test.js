// character-output.test.js - waking Cy prose must never publish repair framing.

import assert from 'node:assert/strict';
import {
  CHARACTER_REPAIR_INSTRUCTION,
  characterRepairPrompt,
  generateWithCharacterRepair,
  validateCharacterCandidate,
} from './character-output.js';
import { stripAssistantContaminatedTail } from './warden.js';

let checks = 0;
const ok = (message) => { checks++; console.log('  ok - ' + message); };

const observedLeaks = [
  'Try again? Note: I have rewritten your response according to inmate Cy\'s tone.',
  "I'll rephrase your response into something fitting for inmate CY's tone.",
  'following the given instructions',
  'Changes included: rougher language',
  'I rephrased your response according to inmate CY\'s tone following all instructions provided in the context.',
  '* Avoiding capitalization\n* Fragmented sentences/phrases',
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
]) {
  assert.equal(validateCharacterCandidate(legitimate).ok, true, legitimate);
}
ok('ordinary prison uses of note, change, tone, response and here is remain valid');

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

console.log(`\n${checks} checks passed`);
