// shout.test.js - pure unit checks on the anger-driven capitalisation transform
// and the affect dynamics. No model, no network, no timers. Self-checking:
// throws (non-zero exit) on any failure.
//
//   node runner/shout.test.js

import assert from 'node:assert/strict';
import { shout, wordWeight, grudgeNames, updateAffect } from './shout.js';
import { angerSignals } from './introspect.js';

let n = 0;
const ok = (msg) => { n++; console.log('  ok - ' + msg); };

// a span's char range must cover only capitalised letters in the OUTPUT
const spansAreUpper = (out, spans) =>
  spans.every(([s, e]) => out.slice(s, e).replace(/[^A-Za-z]/g, '') === out.slice(s, e).replace(/[^A-Za-z]/g, '').toUpperCase());

// ---- 1. determinism: same input + ctx -> identical output (replay-faithful) ----
{
  const a = shout('you took my fucking tray again', { expressed: 0.6 });
  const b = shout('you took my fucking tray again', { expressed: 0.6 });
  assert.deepEqual(a, b, 'the transform is deterministic for a given input + ctx');
  ok('deterministic: identical input and ctx produce identical output');
}

// ---- 2. inverse: high despair flattens the page (all caps stripped) ----
{
  const r = shout('Some Text. Here It Is.', { expressed: 0.95, despair: 0.85 });
  assert.equal(r.flat, true, 'flat flag set');
  assert.equal(r.text, r.text.toLowerCase(), 'everything is lowercased');
  assert.equal(r.spans.length, 0, 'no shouted spans in flat mode');
  ok('inverse: high despair strips all capitals and sentence-initial caps');
}
{
  const r = shout('Some Text Here.', { expressed: 0.95, numbness: 0.75 });
  assert.equal(r.flat, true, 'numbness also flattens');
  ok('inverse: high numbness also flattens the page');
}

// ---- 3. baseline calm: nothing fires, the model's text passes through as-is ----
{
  const src = 'the quiet grey morning came round again';
  const r = shout(src, { expressed: 0.05, rng: () => 0.99 });
  assert.equal(r.text, src, 'calm text is returned unchanged');
  assert.equal(r.spans.length, 0, 'no spans at rest');
  ok('baseline: at low expressed with no seed the text is untouched');
}

// ---- 4. span sweep: emphasis spreads across the phrase, function words swept in ----
{
  // rng()=>0 makes every seed roll pass; the highest-weight word ('never') seeds.
  const r = shout('i never touched it', { expressed: 0.5, rng: () => 0 });
  assert.equal(r.text, 'I NEVER TOUCHED IT', 'the span sweeps the whole clause, not just the seed');
  assert.ok(r.spans.length >= 1, 'a span is recorded');
  assert.ok(spansAreUpper(r.text, r.spans), 'span ranges cover the capitalised letters');
  assert.deepEqual(r.spans[0], [0, r.text.length], 'the merged span covers the contiguous phrase');
  ok('span sweep: "I NEVER TOUCHED IT" - function words carried along');
}

// ---- 5. prosodic boundary: a span does not cross punctuation ----
{
  const r = shout('i never touched it, calm after that', { expressed: 0.5, rng: () => 0 });
  assert.ok(r.text.startsWith('I NEVER TOUCHED IT,'), 'the clause before the comma is shouted');
  assert.ok(/calm after that$/.test(r.text), 'text past the comma boundary is left untouched');
  ok('boundary: the span stops at the comma, later words stay lower-case');
}

// ---- 6. extreme: at the top of the range the span runs on and the last word doubles ----
{
  const r = shout('just fucking stop', { expressed: 0.96, rng: () => 0 });
  assert.equal(r.text, 'JUST FUCKING STOPPP', 'extreme runs to the end and letter-doubles the final word');
  ok('extreme: full run + letter-doubling (STOPPP)');
}

// ---- 7. word weights: profanity > threat > grudge name > negation > food > rest ----
{
  const gn = new Set(['bill']);
  assert.ok(wordWeight('fucking') > wordWeight('shiv'), 'profanity outweighs threat');
  assert.ok(wordWeight('shiv') > wordWeight('bill', { grudgeNames: gn }), 'threat outweighs a grudge name');
  assert.ok(wordWeight('bill', { grudgeNames: gn }) > wordWeight('never'), 'grudge name outweighs a negation');
  assert.ok(wordWeight('never') > wordWeight('egg', { hungerHigh: true }), 'negation outweighs a food word');
  assert.ok(wordWeight('egg', { hungerHigh: true }) > wordWeight('egg', { hungerHigh: false }), 'food only counts when hungry');
  assert.ok(wordWeight('table') <= 0.03, 'ordinary words are near zero');
  ok('word weights are ordered profanity > threat > grudge name > negation > food > rest');
}

// ---- 8. grudge names pulled live from the relations map above a threshold ----
{
  const g = grudgeNames({ bill: { grudge: 0.4 }, nick: { grudge: 0.1 } });
  assert.ok(g.has('bill'), 'a hardened grudge target is named');
  assert.ok(!g.has('nick'), 'a low grudge is not');
  ok('grudge names: live from relations, thresholded');
}

// ---- 9. affect dynamics: expressed TRAILS anger; rise is fast, fall much slower --
{
  // a spike: high recent-burst anger + a standing grudge raises anger, expressed lags
  const v = { mental: { anger: 0 }, expressed: 0, lastBurstAnger: 0.8, relations: { x: { grudge: 0.5 } } };
  updateAffect(v, { amp: 1 });
  assert.ok(v.mental.anger > 0, 'anger rises on a trigger');
  assert.ok(v.expressed < v.mental.anger, 'expressed trails behind the felt anger (the lag)');
  ok('lag: a trigger raises anger, expressed follows a beat behind');

  // rise magnitude vs fall magnitude over the same gap
  const up = { mental: { anger: 0 }, expressed: 0, lastBurstAnger: 1, relations: {} };
  updateAffect(up, { amp: 1 });
  const rise = up.mental.anger; // from 0 toward a high target

  const down = { mental: { anger: 0.8 }, expressed: 0.8, lastBurstAnger: 0, relations: {} };
  const before = down.mental.anger;
  const beforeExp = down.expressed;
  updateAffect(down, { amp: 1 });
  const angerFall = before - down.mental.anger;
  const expFall = beforeExp - down.expressed;
  assert.ok(rise > angerFall, 'anger rises faster than it falls');
  assert.ok(expFall < angerFall, 'expressed falls slower than anger (comedown outlasts the flare)');
  ok('asymmetry: fast rise, slow decay; expressed comedown is the slowest of all');
}

// ---- 10. anger signal reused from introspect drives the loop ----
{
  assert.ok(angerSignals('fucking hell, shut it, coming for you').intensity > 0.4, 'a swearing, threatening burst reads angry');
  assert.equal(angerSignals('the grey light on the wall').intensity, 0, 'a calm burst reads as no anger');
  ok('angerSignals: profanity/threat/imperative density -> a 0..1 intensity');
}

console.log(`\n${n} checks passed`);
