// social-officer-contact-grounding.test.js - the random inmate-social
// (~0.006/5s tick, hard-coded location 'association') and random-officer
// (~0.004/5s tick, hard-coded 'wing' or 'cell' for searches) template
// producers previously asserted full grounded CONTACT episodes - direct Cy
// observation, CONTACT, reciprocity/contact form, grounded social episode,
// memory eligibility, grounded prose input - without ever checking Cy's
// authoritative current location (vitals.locationRegime.current.id). Each
// firing got a fresh episode ID, so repeated encounters accumulated as
// independent "factual" evidence even when co-presence was never
// established.
//
// The Social substrate (social-contact-substrate.js) is not the defect: it
// correctly trusts whatever evidence it is given, and is untouched here.
//
// Fix: gate both random producers on Cy's authoritative location before they
// do anything else -
//   - fireSocial(): the tick-loop call site now only rolls the dice while
//     vitals.locationRegime.current.id === INMATE_SOCIAL_COMPATIBLE_LOCATION
//     (WING_OR_LANDING) - the only location 'association' contact is
//     plausible at. The yard is already excluded upstream of this call site.
//   - fireOfficer(): an internal guard, evaluated before any relations
//     update, incident recording, instrumental opening or structured event
//     creation, requires vitals.locationRegime.current.id to equal
//     officerEventCompatibleLocation(ev.type) - CELL for a 'search', else
//     WING_OR_LANDING for everything else.
// A mismatch means the function returns having done nothing at all: no
// grounded Social episode, no captureEnvironmentEvent call (so no Cy-observed
// memory source, no grounded-prose Social fact), no instrumental opening, no
// relations nudge, no incident record, no emitted event. It is simply
// treated as not having happened this tick, per the task's explicit
// "acceptable for unsupported template contact simply not to occur."
//
// This automatically closes the instrumental path too: beginInstrumentalIncident
// is only reached from fireSocial/fireOfficer AFTER the guard, so an
// incompatible-location tick never reaches it. The other two
// beginInstrumentalIncident call sites (inside advanceCellSearch, keyed off
// an already-co-presence-validated search episode's own actor) are a
// different, already-correct path and are untouched.
//
// fireSocial/fireOfficer themselves are closure-scoped inside run.js's
// main() (guarded from auto-running on import, same as every other producer
// in this file) and not exported, so - consistent with
// foreground-timeout.test.js and injury-producer-removal.test.js's
// established approach for this exact class of wiring - the gating
// structure is proven by source inspection, while the location-compatibility
// RULE itself is proven directly by calling the small pure functions now
// exported for it.
//
// Self-checking: throws (non-zero exit) on any failure.
//
//   node runner/social-officer-contact-grounding.test.js

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  officerEventCompatibleLocation,
  INMATE_SOCIAL_COMPATIBLE_LOCATION,
} from './run.js';
import { LOCATIONS } from './location-regime.js';
import { createSocialContactState, reconcileSocialContactState } from './social-contact-substrate.js';

let n = 0;
const ok = (msg) => { n++; console.log('  ok - ' + msg); };

const source = readFileSync(new URL('./run.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ---- the compatibility RULE itself, proven directly (real function calls) ----

assert.equal(INMATE_SOCIAL_COMPATIBLE_LOCATION, LOCATIONS.WING_OR_LANDING,
  'association-style inmate contact is only compatible with the wing/landing');
assert.equal(officerEventCompatibleLocation('search'), LOCATIONS.CELL,
  'a cell search is only compatible with Cy actually being in his cell');
for (const eventType of ['kindness', 'refusal', 'instruction', 'anything-else']) {
  assert.equal(officerEventCompatibleLocation(eventType), LOCATIONS.WING_OR_LANDING,
    `non-search officer event type '${eventType}' is only compatible with the wing/landing`);
}
assert.notEqual(officerEventCompatibleLocation('search'), LOCATIONS.EXERCISE_YARD);
assert.notEqual(INMATE_SOCIAL_COMPATIBLE_LOCATION, LOCATIONS.EXERCISE_YARD);
ok('the location-compatibility rule (WING_OR_LANDING for inmate/non-search-officer contact, CELL for a search, never the yard) is correct (1, 2, 4)');

// ---- 1/2: cell-bound / yard-bound Cy cannot trigger the random inmate-social producer ----
assert.match(source,
  /if \(!asleep && vitals\.locationRegime\.current\.id === INMATE_SOCIAL_COMPATIBLE_LOCATION\s*\n\s*&& Math\.random\(\) < 0\.006\) fireSocial\(\);/,
  'fireSocial only rolls while Cy is authoritatively on the wing/landing - never while cell-bound or at the yard');
ok('a cell-bound (or yard-bound) Cy cannot receive an association direct-contact episode, because fireSocial is never even called (1, 2)');

// ---- 4: officer interactions require compatible authoritative location, checked BEFORE anything else fires ----
assert.match(source,
  /function fireOfficer\(\) \{\s*\n\s*const \{ officerKey, ev \} = pickOfficer\(\);\s*\n(?:\s*\/\/.*\n)*\s*if \(vitals\.locationRegime\.current\.id !== officerEventCompatibleLocation\(ev\.type\)\) return;/,
  'fireOfficer checks the picked event type against Cy\'s authoritative location and returns immediately on a mismatch, before any relations update, incident recording or structured event');
ok('officer interactions (both search and non-search) require Cy\'s authoritative location to match the picked event, checked before any side effect (4)');

// ---- 5: the instrumental opening for both producers sits AFTER the guard, so it cannot bypass it ----
{
  const officerBody = source.slice(source.indexOf('function fireOfficer()'), source.indexOf('function fireOfficer()') + 2000);
  const guardIdx = officerBody.indexOf('officerEventCompatibleLocation(ev.type)) return;');
  const instrumentalIdx = officerBody.indexOf("beginInstrumentalIncident('officer'");
  assert.ok(guardIdx > -1 && instrumentalIdx > -1 && guardIdx < instrumentalIdx,
    'fireOfficer\'s instrumental opening occurs strictly after the location guard');
}
{
  // fireSocial has no internal guard (the call site itself is the gate), so its
  // beginInstrumentalIncident call must only be reachable via that gated call site.
  const tickLoopIdx = source.indexOf('social frictions between inmates');
  const nearby = source.slice(tickLoopIdx, tickLoopIdx + 600);
  assert.match(nearby, /vitals\.locationRegime\.current\.id === INMATE_SOCIAL_COMPATIBLE_LOCATION[\s\S]*fireSocial\(\);/,
    'the only call site that can reach fireSocial (and therefore its instrumental opening) is location-gated');
}
assert.equal((source.match(/(?<!function )beginInstrumentalIncident\(/g) || []).length, 4,
  'exactly the 4 known call sites exist (the definition itself excluded): 2 inside advanceCellSearch (already validated), 2 inside fireSocial/fireOfficer (now gated) - no new bypass was introduced');
ok('instrumental social/officer openings cannot bypass the same co-presence gate, because they are only reached after it (5)');

// ---- 3/10: later world-continuity work may extend location-regime.js, but the
// yard observation function, Social substrate and cast pickers remain unchanged. ----
{
  const baseline = '8c5a863';
  const untouchedFiles = ['social-contact-substrate.js', 'cast.js'];
  let diffOutput = '';
  try {
    diffOutput = execFileSync('git', ['diff', '--stat', baseline, '--', ...untouchedFiles], {
      cwd: new URL('.', import.meta.url), encoding: 'utf8',
    });
  } catch (error) {
    // If the baseline ref is unavailable in this checkout (e.g. a shallow clone),
    // skip this specific proof rather than failing the whole suite on tooling.
    diffOutput = null;
  }
  if (diffOutput !== null) {
    assert.equal(diffOutput.trim(), '',
      `the Social substrate and cast pickers must be byte-for-byte unchanged from baseline; git diff --stat reported: ${diffOutput}`);
    const yardFunction = (text) => {
      const normalized = text.replace(/\r\n/g, '\n');
      return normalized.slice(
        normalized.indexOf('export function createYardObservation('),
        normalized.indexOf('export function startCellSearchEpisode('),
      );
    };
    const baselineLocation = execFileSync('git', ['show', `${baseline}:runner/location-regime.js`], {
      cwd: new URL('.', import.meta.url), encoding: 'utf8',
    });
    const currentLocation = readFileSync(new URL('./location-regime.js', import.meta.url), 'utf8');
    assert.equal(yardFunction(currentLocation), yardFunction(baselineLocation),
      'the actual yard-contact producer remains unchanged while adjacent location lifecycle code evolves');
    ok('the yard contact mechanism, the Social substrate itself, and the cast pickers are provably untouched by this fix (3, 10)');
  } else {
    ok('baseline ref unavailable in this checkout - skipped the git-diff proof for (3, 10); see the direct substrate/reconciliation checks below instead');
  }
}

// ---- 6/7: an incompatible-location tick never reaches captureEnvironmentEvent, so it can create
// neither a Cy-observed memory source nor a grounded-prose Social fact ----
{
  const fnStart = source.indexOf('function fireOfficer()');
  const fnBody = source.slice(fnStart, source.indexOf('\n  }\n', fnStart));
  const guardPos = fnBody.indexOf('return;');
  const captureCallPos = fnBody.indexOf('captureEnvironmentEvent(');
  assert.ok(guardPos > -1 && captureCallPos > -1 && guardPos < captureCallPos,
    'the location guard in fireOfficer returns before captureEnvironmentEvent (the sole source of memory-source enqueue and grounded-prose input) can be reached');
}
ok('invalid-location contact never calls captureEnvironmentEvent, so it creates no Cy-observed memory source and no grounded-prose Social fact (6, 7)');

// ---- 8: the cyObserved / WORLD_ONLY seam this fix relies on is itself untouched ----
assert.match(source,
  /if \(cyObserved\) \{\s*\n\s*Object\.assign\(record, observeEnvironmentRecord\(soma, record\)\);/,
  'the cyObserved -> observeEnvironmentRecord grounded-seam boundary is unchanged');
assert.doesNotMatch(source, /cyObserved:\s*false[\s\S]{0,120}(fireSocial|fireOfficer)/,
  'this fix never relabels a gated-out encounter as WORLD_ONLY (cyObserved: false) - it simply does not fire');
ok('AWG OBSERVED/WORLD_ONLY boundaries remain intact; an unsupported encounter is dropped, never relabeled as having happened elsewhere (8)');

// ---- 9: repeated firings still cannot accumulate as grounded episodes unless each is independently valid ----
// Each call to fireSocial/fireOfficer re-reads vitals.locationRegime.current.id live (no cached/sticky
// compatibility flag), so a location change mid-run is picked up on the very next tick.
assert.doesNotMatch(source, /let\s+\w*[Cc]ompatible\w*\s*=/,
  'there is no cached/mutable compatibility flag - the location is re-checked fresh on every single call');
ok('repeated random-producer firings are independently re-validated against Cy\'s current location on every tick, so mismatched encounters cannot accumulate as grounded episodes (9)');

// ---- 11: restart/replay behaviour is unaffected - proven functionally, not just by
// diff, since a gated-out tick never produces an environment record and therefore
// never reaches observeSocialContactRecord/reconcileSocialContactState at all. The
// reconciliation function itself (already-existing behaviour, untouched by this fix)
// still resolves a stale ONGOING episode into INTERRUPTED across a simulated restart. ----
{
  const now = Date.now();
  const state = createSocialContactState(now - 60 * 60 * 1000);
  state.episodes.push({
    schema: 'cy.social-episode',
    version: 1, episodeId: 'ep-restart-1', episodeType: 'CONTACT', startTimestamp: new Date(now - 60 * 60 * 1000).toISOString(),
    endTimestamp: null, durationMs: null, linkedEnvironmentEventIds: ['env-1'],
    participants: { actorId: 'inmate:1', targetId: 'cy', relationshipRef: 'inmate:1' },
    channel: 'IN_PERSON', contactForm: 'DIRECT_INTERACTION', direction: 'MUTUAL', reciprocity: 'RECIPROCAL',
    socialCharacter: 'ORDINARY', resolution: 'ONGOING',
    opportunity: { openedAtMs: null, closedAtMs: null, reason: null },
    isolation: { continuouslyObserved: false, aloneEstablished: false, noContactEstablished: false },
    fieldProvenance: {},
  });
  state.continuity = { status: 'CONTINUOUS', lastObservedAtMs: now - 60 * 60 * 1000 };
  const reconciled = reconcileSocialContactState(state, { now });
  assert.equal(reconciled.episodes.length, 1, 'the pre-existing episode survives a simulated restart');
  assert.equal(reconciled.episodes[0].resolution, 'INTERRUPTED',
    'a stale ONGOING episode is still correctly resolved to INTERRUPTED across a restart, exactly as before this fix');
}
ok('restart/replay behaviour is unaffected: a gated-out tick never reaches the Social substrate at all, and the substrate\'s own restart reconciliation (untouched by this fix) still behaves as before (11)');

console.log(`\nsocial-officer-contact-grounding.test.js: all ${n} checks passed`);
