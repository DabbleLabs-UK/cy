import assert from 'node:assert/strict';

import { ZONE_A, buildPrompt } from './prompt.js';

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
assert.match(picturePrompt, /begin by reacting to one concrete detail from their\nwords or picture/);
assert.match(picturePrompt, /a picture: a blue boat under a bridge/);

console.log('postcard-prompt.test.js: all checks passed');
