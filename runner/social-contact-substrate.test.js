import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import {
  createSocialContactState,
  observeSocialContactRecord,
  reconcileSocialContactState,
  socialContactSnapshot,
} from './social-contact-substrate.js';

const BASE = Date.parse('2026-09-11T12:00:00.000Z');

function record(id, social, timestamp = BASE) {
  return createEnvironmentRecord(createEnvironmentEvent('social_episode', {
    id: `env-${id}`,
    timestamp: new Date(timestamp).toISOString(),
    world: { social: { episode_id: id, start_at: new Date(timestamp).toISOString(), ...social } },
  }));
}

function add(state, id, social, timestamp) {
  const result = observeSocialContactRecord(state, record(id, social, timestamp));
  assert.equal(result.updated, true);
  return result.episode;
}

const state = createSocialContactState(BASE);

// A. Friendly contact.
const friendly = add(state, 'friendly', {
  episode_type: 'CONTACT', actor_id: 'inmate:daemon', actor_label: 'Daemon', target_id: 'cy:7734',
  channel: 'IN_PERSON', contact_form: 'DIRECT_INTERACTION', direction: 'MUTUAL',
  reciprocity: 'RECIPROCAL', character: 'SUPPORTIVE', resolution: 'COMPLETED',
});
assert.equal(friendly.socialCharacter, 'SUPPORTIVE');

// B/C/F. Hostile, ordinary and passive contact remain distinct.
assert.equal(add(state, 'hostile', { episode_type: 'CONTACT', channel: 'IN_PERSON', contact_form: 'DIRECT_INTERACTION', reciprocity: 'RECIPROCAL', character: 'HOSTILE', resolution: 'COMPLETED' }, BASE + 1000).socialCharacter, 'HOSTILE');
const passive = add(state, 'passive', { episode_type: 'CONTACT', channel: 'IN_PERSON', contact_form: 'PASSIVE_CO_PRESENCE', reciprocity: 'ONE_WAY', character: 'ORDINARY', resolution: 'COMPLETED' }, BASE + 2000);
assert.equal(passive.socialCharacter, 'ORDINARY');
assert.equal(passive.contactForm, 'PASSIVE_CO_PRESENCE');
assert.notEqual(passive.reciprocity, 'RECIPROCAL');

// D/E. Explicit rejection is REJECTED; no response is not rejection.
assert.equal(add(state, 'rejected', { episode_type: 'OPPORTUNITY', channel: 'IN_PERSON', contact_form: 'ATTEMPTED_CONTACT', reciprocity: 'REJECTED', character: 'REJECTING', resolution: 'COMPLETED' }, BASE + 3000).reciprocity, 'REJECTED');
const noResponse = add(state, 'no-response', { episode_type: 'OPPORTUNITY', channel: 'OTHER', contact_form: 'ATTEMPTED_CONTACT', reciprocity: 'NO_RESPONSE', character: 'UNKNOWN', resolution: 'COMPLETED' }, BASE + 4000);
assert.equal(noResponse.reciprocity, 'NO_RESPONSE');
assert.notEqual(noResponse.socialCharacter, 'REJECTING');

// G/H. A postcard starts one-way and a reply updates the same episode to
// reciprocal without inventing support.
add(state, 'postcard:8', { episode_type: 'CONTACT', channel: 'POSTCARD', contact_form: 'MESSAGE_RECEIVED', direction: 'INITIATED_BY_OTHER', reciprocity: 'ONE_WAY', character: 'UNKNOWN', resolution: 'COMPLETED' }, BASE + 5000);
const reply = add(state, 'postcard:8', { episode_type: 'CONTACT', start_at: new Date(BASE + 5000).toISOString(), end_at: new Date(BASE + 7000).toISOString(), channel: 'POSTCARD', contact_form: 'MESSAGE_SENT', direction: 'MUTUAL', reciprocity: 'RECIPROCAL', character: 'UNKNOWN', resolution: 'COMPLETED' }, BASE + 7000);
assert.equal(reply.reciprocity, 'RECIPROCAL');
assert.equal(reply.socialCharacter, 'UNKNOWN');
assert.equal(state.episodes.filter((episode) => episode.episodeId === 'postcard:8').length, 1);

// I/J. Confirmed isolation requires all three explicit facts. Observation gaps
// survive as gaps and cannot become isolation.
const refusedIsolation = observeSocialContactRecord(state, record('bad-isolation', {
  episode_type: 'CONFIRMED_ISOLATION', resolution: 'COMPLETED',
  continuously_observed: false, alone_established: true, no_contact_established: true,
}, BASE + 8000));
assert.equal(refusedIsolation.reason, 'isolation_not_confirmed');
add(state, 'isolation', {
  episode_type: 'CONFIRMED_ISOLATION', resolution: 'COMPLETED',
  continuously_observed: true, alone_established: true, no_contact_established: true,
}, BASE + 9000);
add(state, 'gap', {
  episode_type: 'OBSERVATION_GAP', start_at: new Date(BASE + 10000).toISOString(),
  end_at: new Date(BASE + 11000).toISOString(), resolution: 'COMPLETED',
}, BASE + 10000);
assert.equal(state.episodes.filter((episode) => episode.episodeType === 'CONFIRMED_ISOLATION').length, 1);

// K/L. Opportunities and resulting contact are one upserted episode; withdrawn
// and disengaged branches remain opportunities and do not fabricate hostility.
add(state, 'instrumental:engage', { episode_type: 'OPPORTUNITY', opportunity_id: 'opp-engage', opportunity_status: 'OPEN', contact_form: 'ATTEMPTED_CONTACT', character: 'ORDINARY', resolution: 'ONGOING' }, BASE + 12000);
const engaged = add(state, 'instrumental:engage', { episode_type: 'CONTACT', opportunity_id: 'opp-engage', opportunity_status: 'RESOLVED', action_executed: 'action:engage', contact_form: 'DIRECT_INTERACTION', reciprocity: 'RECIPROCAL', character: 'ORDINARY', resolution: 'COMPLETED', end_at: new Date(BASE + 13000).toISOString() }, BASE + 13000);
assert.equal(engaged.episodeType, 'CONTACT');
assert.equal(engaged.socialCharacter, 'ORDINARY');
const withdrawn = add(state, 'instrumental:withdraw', { episode_type: 'OPPORTUNITY', opportunity_id: 'opp-withdraw', opportunity_status: 'RESOLVED', action_executed: 'action:withdraw', contact_form: 'ATTEMPTED_CONTACT', reciprocity: 'ONE_WAY', character: 'ORDINARY', resolution: 'COMPLETED' }, BASE + 14000);
assert.equal(withdrawn.episodeType, 'OPPORTUNITY');
assert.notEqual(withdrawn.socialCharacter, 'HOSTILE');
const disengaged = add(state, 'instrumental:disengage', { episode_type: 'OPPORTUNITY', action_executed: 'action:disengage', contact_form: 'ATTEMPTED_CONTACT', reciprocity: 'ONE_WAY', character: 'ORDINARY', resolution: 'COMPLETED' }, BASE + 15000);
assert.notEqual(disengaged.socialCharacter, 'HOSTILE');

// M/N. Legacy fields and prose cannot create or alter the grounded ledger.
const count = state.episodes.length;
const legacy = createEnvironmentRecord(createEnvironmentEvent('prolonged_social_absence', {
  id: 'env-legacy', timestamp: new Date(BASE + 16000).toISOString(),
  world: { situation: { social_contact: 'none', social_contact_quality: 'none' } },
  observation: { summary: "I'm lonely" },
}));
assert.equal(observeSocialContactRecord(state, legacy).updated, false);
assert.equal(state.episodes.length, count);

// O. State and ongoing/recent episodes survive reconciliation; a restart gap is
// unknown observation, not isolation.
const restarted = reconcileSocialContactState(JSON.parse(JSON.stringify(state)), { now: BASE + 60000 });
assert.equal(restarted.episodes.length, state.episodes.length);
assert.ok(restarted.observationGaps.length >= state.observationGaps.length);
assert.equal(restarted.episodes.filter((episode) => episode.episodeType === 'CONFIRMED_ISOLATION').length, 1);

// P/Q. Public subjective Loneliness stays provisional and no brain activation is
// present in either the snapshot or registry metadata.
const snapshot = socialContactSnapshot(restarted, BASE + 60000);
assert.equal(snapshot.subjectiveLoneliness, 'NOT_MODELLED');
assert.equal(snapshot.legacyDisplayedLoneliness, 'PROVISIONAL');
assert.equal(snapshot.socialSetPoint, 'NOT_MODELLED');
assert.equal('brainActivation' in snapshot, false);
const registry = JSON.parse(readFileSync(new URL('../config/implementation-registry.json', import.meta.url), 'utf8'));
assert.equal(registry.soma_variables.find((item) => item.id === 'loneliness').implementation_status, 'PROVISIONAL');
assert.equal(registry.brain_regions.find((item) => item.id === 'temporalSocial').implementation_status, 'PROVISIONAL');

// Integration source guards: postcard quality is UNKNOWN in the grounded path,
// and Handoff-8 outcomes explicitly separate opportunity and contact.
const runSource = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
assert.match(runSource, /episode_id: `postcard:\$\{pc\.id\}`[\s\S]*?character: 'UNKNOWN'/);
assert.match(runSource, /actualContact \? 'CONTACT' : 'OPPORTUNITY'/);
assert.match(runSource, /action:disengage/);
const brainSource = readFileSync(new URL('../public/assets/brain.js', import.meta.url), 'utf8');
assert.match(brainSource, /SOCIAL CONTACT LEDGER INSPECTION/);
assert.match(brainSource, /\['pain', 'loneliness'\]\.includes\(definition\.key\)/);
assert.match(brainSource, /data-range="1h"[\s\S]*data-range="24h"[\s\S]*data-range="7d"/);
const endpointSource = readFileSync(new URL('../public/api/social-contact.php', import.meta.url), 'utf8');
assert.match(endpointSource, /unset\(\$episode\['linkedEnvironmentEventIds'\]\)/);
assert.match(endpointSource, /\$range === 'all' && \$isAdmin/);
assert.match(endpointSource, /\$response\['inspection'\] =/);

console.log('social-contact-substrate.test.js: all checks passed');
