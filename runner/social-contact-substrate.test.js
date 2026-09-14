import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import {
  createSocialContactState,
  observeSocialContactRecord,
  reconcileSocialContactState,
  socialContextState,
  socialContactSnapshot,
} from './social-contact-substrate.js';
import { socialContactHeadline } from '../public/assets/brain.js';

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
assert.equal(socialContextState(state), 'NO_CURRENT_EPISODE_OBSERVED');
assert.equal(socialContextState(null), 'UNKNOWN');

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

// Inmate and officer channels remain distinct factual contact records.
const inmateContact = add(state, 'inmate-contact', {
  episode_type: 'CONTACT', actor_label: 'Fisher', channel: 'IN_PERSON',
  contact_form: 'DIRECT_INTERACTION', reciprocity: 'RECIPROCAL', character: 'ORDINARY', resolution: 'COMPLETED',
}, BASE + 2500);
const officerContact = add(state, 'officer-contact', {
  episode_type: 'CONTACT', actor_label: 'Mr Proctor', channel: 'OFFICER_INTERACTION',
  contact_form: 'DIRECT_INTERACTION', reciprocity: 'RECIPROCAL', character: 'HOSTILE', resolution: 'COMPLETED',
}, BASE + 2600);
assert.equal(inmateContact.channel, 'IN_PERSON');
assert.equal(officerContact.channel, 'OFFICER_INTERACTION');

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
assert.equal(restarted.episodes.find((episode) => episode.episodeId === 'instrumental:engage').resolution, 'COMPLETED');

// An episode that was still ongoing at restart is interrupted at the last
// observed instant; downtime is a gap and never extends contact or isolation.
const duringIsolation = createSocialContactState(BASE);
add(duringIsolation, 'ongoing-isolation', {
  episode_type: 'CONFIRMED_ISOLATION', resolution: 'ONGOING',
  continuously_observed: true, alone_established: true, no_contact_established: true,
}, BASE + 1000);
assert.equal(socialContextState(duringIsolation), 'CONFIRMED_ISOLATION');
duringIsolation.continuity.lastObservedAtMs = BASE + 2000;
const afterIsolationRestart = reconcileSocialContactState(duringIsolation, { now: BASE + 5000 });
assert.equal(afterIsolationRestart.episodes[0].resolution, 'INTERRUPTED');
assert.equal(afterIsolationRestart.episodes[0].endTimestamp, new Date(BASE + 2000).toISOString());
assert.equal(socialContextState(afterIsolationRestart), 'NO_CURRENT_EPISODE_OBSERVED');
assert.equal(afterIsolationRestart.observationGaps.at(-1).isolationInference, 'NONE_MADE');

const emptyBeforeRestart = createSocialContactState(BASE);
emptyBeforeRestart.continuity.lastObservedAtMs = BASE + 1000;
const emptyAfterRestart = reconcileSocialContactState(emptyBeforeRestart, { now: BASE + 5000 });
assert.equal(emptyAfterRestart.observationGaps.length, 1,
  'restart downtime remains an observation gap even before the first social episode');

const currentContact = createSocialContactState(BASE);
add(currentContact, 'ongoing-contact', {
  episode_type: 'CONTACT', channel: 'IN_PERSON', contact_form: 'DIRECT_INTERACTION',
  reciprocity: 'RECIPROCAL', character: 'ORDINARY', resolution: 'ONGOING',
}, BASE + 1000);
assert.equal(socialContextState(currentContact), 'CONTACT_ONGOING');
assert.equal(socialContactHeadline(socialContactSnapshot(currentContact, BASE + 2000)), 'CONTACT ONGOING');
const currentOpportunity = createSocialContactState(BASE);
add(currentOpportunity, 'open-opportunity', {
  episode_type: 'OPPORTUNITY', contact_form: 'ATTEMPTED_CONTACT', resolution: 'ONGOING',
}, BASE + 1000);
assert.equal(socialContextState(currentOpportunity), 'OPPORTUNITY_OPEN');

// P/Q. Public subjective Loneliness stays provisional and no brain activation is
// present in either the snapshot or registry metadata.
const snapshot = socialContactSnapshot(restarted, BASE + 60000);
assert.equal(snapshot.subjectiveLoneliness, 'NOT_MODELLED');
assert.equal(snapshot.legacyDisplayedLoneliness, 'DIAGNOSTICS_ONLY');
assert.equal(snapshot.socialSetPoint, 'NOT_MODELLED');
assert.equal('brainActivation' in snapshot, false);
const registry = JSON.parse(readFileSync(new URL('../config/implementation-registry.json', import.meta.url), 'utf8'));
assert.equal(registry.soma_variables.find((item) => item.id === 'loneliness').implementation_status, 'IMPLEMENTED');
assert.equal(registry.soma_subsystems.find((item) => item.id === 'subjective_loneliness').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(registry.soma_subsystems.find((item) => item.id === 'social_deprivation_need').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(registry.soma_subsystems.find((item) => item.id === 'legacy_loneliness_metric').lifecycle_status, 'DIAGNOSTICS_ONLY');
assert.equal(registry.brain_regions.find((item) => item.id === 'temporalSocial').implementation_status, 'PROVISIONAL');

// Public snapshots retain prison-character labels but remove private postcard
// sender labels and all hidden identifiers.
const privacyState = createSocialContactState(BASE);
add(privacyState, 'private-postcard', {
  episode_type: 'CONTACT', actor_id: 'visitor:secret', actor_label: 'Private Sender', target_id: 'cy:7734',
  target_label: 'Cy', relationship_ref: 'private:relationship', channel: 'POSTCARD',
  contact_form: 'MESSAGE_RECEIVED', reciprocity: 'ONE_WAY', character: 'UNKNOWN', resolution: 'COMPLETED',
}, BASE + 1000);
const publicPostcard = socialContactSnapshot(privacyState, BASE + 2000).latestEpisode;
assert.equal('episodeId' in publicPostcard, false);
assert.equal('actorId' in publicPostcard.participants, false);
assert.equal('actorLabel' in publicPostcard.participants, false);
assert.equal('relationshipRef' in publicPostcard.participants, false);
assert.equal('opportunityId' in publicPostcard.opportunity, false);
const ongoingPrivatePostcard = createSocialContactState(BASE);
add(ongoingPrivatePostcard, 'private-postcard-ongoing', {
  episode_type: 'CONTACT', actor_id: 'visitor:secret', actor_label: 'Private Sender', channel: 'POSTCARD',
  contact_form: 'MESSAGE_RECEIVED', reciprocity: 'ONE_WAY', character: 'UNKNOWN', resolution: 'ONGOING',
}, BASE + 1000);
assert.equal(socialContactSnapshot(ongoingPrivatePostcard, BASE + 2000).currentContext.currentlyWith, null);

// Integration source guards: postcard quality is UNKNOWN in the grounded path,
// and Handoff-8 outcomes explicitly separate opportunity and contact.
const runSource = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
assert.match(runSource, /episode_id: `postcard:\$\{pc\.id\}`[\s\S]*?character: 'UNKNOWN'/);
assert.match(runSource, /actualContact \? 'CONTACT' : 'OPPORTUNITY'/);
assert.match(runSource, /action:disengage/);
const brainSource = readFileSync(new URL('../public/assets/brain.js', import.meta.url), 'utf8');
assert.match(brainSource, /SOCIAL CONTACT LEDGER INSPECTION/);
assert.match(brainSource, /\['somaticHarm', 'loneliness', 'satiety'\]\.includes\(definition\.key\)/);
assert.match(brainSource, /data-range="1h"[\s\S]*data-range="24h"[\s\S]*data-range="7d"/);
assert.match(brainSource, /SOCIAL CONTACT \/ ISOLATION/);
assert.match(brainSource, /CURRENT SOCIAL CONTEXT/);
assert.match(brainSource, /SOCIAL HISTORY/);
assert.match(brainSource, /SUBJECTIVE LONELINESS<\/span><strong>NOT MODELLED/);
assert.doesNotMatch(brainSource, /definition\.key === 'loneliness'[\s\S]{0,500}soma-state-bar/);
const endpointSource = readFileSync(new URL('../public/api/social-contact.php', import.meta.url), 'utf8');
assert.match(endpointSource, /unset\(\$episode\['episodeId'\], \$episode\['linkedEnvironmentEventIds'\]\)/);
assert.match(endpointSource, /unset\(\$episode\['opportunity'\]\['opportunityId'\]\)/);
assert.match(endpointSource, /unset\(\$episode\['participants'\]\['actorLabel'\]/);
assert.match(endpointSource, /\$range === 'all' && \$isAdmin/);
assert.match(endpointSource, /'fromMs' => \$fromMs/);
assert.match(endpointSource, /'1h' => 3600000, '24h' => 86400000, '7d' => 604800000/);
assert.match(endpointSource, /\$response\['inspection'\] =/);
assert.match(brainSource, /episode\.resolution === 'ONGOING' \? toMs/,
  'an ongoing episode continues through the right edge of a rolling history graph');

const somaSource = readFileSync(new URL('./soma.js', import.meta.url), 'utf8');
const experiencedSource = readFileSync(new URL('./experienced-state.js', import.meta.url), 'utf8');
assert.doesNotMatch(runSource, /mental\.longing\s*=\s*experienced\.loneliness/);
assert.doesNotMatch(somaSource, /drives\.contact\s*=\s*round\(experienced\.loneliness/);
assert.match(experiencedSource, /!\['pain', 'loneliness'\]\.includes\(key\)/);
assert.match(experiencedSource, /temporalSocial[\s\S]{0,240}value: null/);

console.log('social-contact-substrate.test.js: all checks passed');
