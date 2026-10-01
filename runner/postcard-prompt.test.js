import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ZONE_A, buildDirectives, buildPrompt, completionBudget, completionDirective } from './prompt.js';
import { sanitizeCharacterContext, stripMalformedProseControls } from './warden.js';

assert.match(
  ZONE_A,
  /Address a real person only when\ntheir postcard is explicitly in front of you/,
  'the permanent persona explicitly permits addressing a real postcard sender',
);
assert.doesNotMatch(
  ZONE_A,
  /Never become an assistant, address a user/,
  'the old blanket ban no longer contradicts postcard replies',
);

const question = "what's your favourite colour?";
const questionPrompt = buildPrompt('tray cold again.', 'postcard', {
  from_name: 'Jody',
  body: question,
}, 'visitor context');

const messageAt = questionPrompt.indexOf(question);
const replyRuleAt = questionPrompt.indexOf('THIS IS THE REPLY');
assert.ok(messageAt >= 0, 'the sender question is present verbatim');
assert.ok(replyRuleAt > messageAt, 'the grounding rule sits after the postcard and close to generation');
assert.match(questionPrompt, /Begin with a direct answer to a question they\nasked/);
assert.match(questionPrompt, /After that clear connection you may wander, associate, joke, resist/);
assert.ok(
  questionPrompt.trim().endsWith('[you turn the card over and write back:]'),
  'the model is cued to write a reply rather than resume private thought',
);

const picturePrompt = buildPrompt('', 'postcard', {
  from_name: 'Mae',
  body: '',
  image_path: '/uploads/postcard.webp',
  caption: 'a blue boat under a bridge',
});
assert.match(picturePrompt, /react to one concrete detail from their words or picture/);
assert.match(picturePrompt, /a picture: a blue boat under a bridge/);

for (const body of ['hola', 'holaaaaa', 'hello', 'hey', 'alright?']) {
  const prompt = buildPrompt('', 'postcard', { from_name: 'Mae', body });
  assert.ok(prompt.includes(`[on the other side, in their hand:] "${body}"`), body);
  assert.match(prompt, /If it is just a greeting or social opening, answer that naturally/);
  assert.match(prompt, /Do not demand a question or invent a detail/);
}
const statementPrompt = buildPrompt('', 'postcard', { from_name: 'Mae', body: 'the rain has stopped' });
assert.match(statementPrompt, /react to one concrete detail from their words or picture/);
assert.match(questionPrompt, /Begin with a direct answer to a question they\nasked/);

const priorCorrespondence = sanitizeCharacterContext('last card said the tea was cold |}| and bill kept the book');
const memoryDirective = stripMalformedProseControls('i remember the book |} from yesterday');
const grounded = buildDirectives({}, 'postcard', {
  sharedContext: `RECENT CY EXPRESSION: ${priorCorrespondence}\nAUTOBIOGRAPHICAL MEMORY: ${memoryDirective}\nGROUNDED SOMA: sleep pressure live`,
});
const correspondencePrompt = buildPrompt(priorCorrespondence, 'postcard', {
  from_name: 'Mae', body: 'hello again - how is the book?',
}, grounded);
assert.doesNotMatch(correspondencePrompt, /\|\}/);
assert.match(correspondencePrompt, /bill kept the book/);
assert.match(correspondencePrompt, /i remember the book/);
assert.match(correspondencePrompt, /GROUNDED SOMA: sleep pressure live/);
assert.match(correspondencePrompt, /hello again - how is the book\?/);
const runSource = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
assert.match(runSource, /recentExpression: contextText\(\)\.slice\(-640\)/);
assert.match(runSource, /content: stripMalformedProseControls\(memory\.content \|\| memory\.publicSummary\)/);
assert.match(runSource, /autobiographicalMemory: stripMalformedProseControls\(memory\.directive\)/);
assert.match(runSource, /emit\(\{ kind: 'postcard_out', payload:/);

const length = completionDirective(45);
assert.match(length, /about 31 words/);
assert.equal(completionBudget(45), 69, 'the hard ceiling leaves room to end naturally');
assert.match(buildDirectives({}, 'journal', { length }), /stop on your own before the hard limit/);

console.log('postcard-prompt.test.js: all checks passed');
