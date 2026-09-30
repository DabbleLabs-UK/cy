import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const runner = await readFile(new URL('./run.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/assets/app.js', import.meta.url), 'utf8');

test('the scheduler uses the persisted location for genuine routine outcomes and search stages', () => {
  const scheduled = runner.slice(runner.indexOf('function fireScheduled('), runner.indexOf('// ---- deterministic environment scheduler'));
  assert.match(scheduled, /slot\.kind === 'routine' && !canStartScheduledRoutine\(vitals\.locationRegime, clock\.date, slot\.routine\)/);
  assert.match(scheduled, /materialiseScheduledEvent\(slot, Math\.random, \{ mealId \}\)/);
  assert.match(scheduled, /startScheduledRoutineEpisode\(vitals\.locationRegime/);
  assert.match(scheduled, /if \(started\.started\) \{[\s\S]*?captureEpisodeEvent\(started\.event/);
  const tick = runner.slice(runner.indexOf('function scheduler(now)'), runner.indexOf('// ---- vitals tick every tickMs'));
  assert.ok(tick.indexOf('processLocationRegime(now, date, mins, asleep)') < tick.indexOf('advanceCellSearch(now)'));
  assert.match(tick, /if \(vitals\.locationRegime\.current\.id !== LOCATIONS\.CELL\) return;/);
});

test('world episode changes flush urgently and AWG defers without consuming a slot', () => {
  const episode = runner.slice(runner.indexOf('function captureEpisodeEvent('), runner.indexOf('function plausibleCastAtLocation('));
  assert.match(episode, /urgentVitalsDirty = true/);
  const awg = runner.slice(runner.indexOf('async function runAwgDuringIdle('), runner.indexOf('// Interruptible idle:'));
  assert.ok(awg.indexOf('awgLocationEligible(vitals.locationRegime)') < awg.indexOf('shouldRunAwg(vitals.worldSimulation'));
  assert.ok(awg.indexOf('awgLocationEligible(vitals.locationRegime)') < awg.indexOf('claimAwgReservation('));
  assert.match(awg, /currentLocation: locationContextId\(vitals\.locationRegime\.current\.id\)/);
});

test('the public location and mode pills name actual routine places', () => {
  for (const place of ['SHOWER', 'ASSOCIATION', 'PHONE']) {
    assert.match(app, new RegExp(`${place}:`));
    assert.match(app, new RegExp(`mode === '${place.toLowerCase()}'`));
  }
  assert.match(app, /name === 'location_transition'/);
});
