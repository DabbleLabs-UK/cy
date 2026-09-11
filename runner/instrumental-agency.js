// instrumental-agency.js - factual action opportunities in Cy's prison world.
//
// This module extends existing officer and inmate incidents with explicit
// situation -> action -> consequence branches. It uses no model-generated prose,
// relationship scalar, emotional score, success probability or control weight.
// The current action selector is an engineering round-robin so both genuinely
// available actions can occur; it is not a psychological model of choice.

export const INSTRUMENTAL_AGENCY_SCHEMA = 'cy.instrumental-agency';
export const INSTRUMENTAL_AGENCY_VERSION = 1;
export const INSTRUMENTAL_AGENCY_MODEL_ID = 'prison-instrumental-opportunities';
export const INSTRUMENTAL_AGENCY_MODEL_VERSION = 'prison-instrumental-opportunities-v1';
export const INSTRUMENTAL_ACTION_SELECTION = 'ENGINEERING_ROUND_ROBIN_NOT_PSYCHOLOGICAL';

const DEFINITIONS = Object.freeze([
  {
    id: 'officer_order',
    sourceKind: 'officer',
    sourceEventType: 'order',
    contextFamily: 'custody',
    contextType: 'officer_instruction',
    openingArchetypeId: 'officer_instruction',
    location: 'wing',
    actions: ['action:comply_instruction', 'action:refuse_instruction'],
    situation: (actor) => `${actor} gave Cy a direct instruction and waited for his response`,
    branches: {
      'action:comply_instruction': {
        consequenceId: 'instruction_completed',
        text: (actor) => `Cy complied; ${actor} saw the instruction completed and moved on`,
        remainingPossibilities: ['the instruction is complete', 'the routine continues'],
        situation: {
          possible_harm: 'none',
          uncertainty: 'none',
          goal_obstruction: 'none',
          intent: 'neutral',
        },
        outcomes: [
          { outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: 'did_not_occur' },
          { outcome_class: 'SOCIAL_HOSTILITY', status: 'did_not_occur' },
        ],
      },
      'action:refuse_instruction': {
        consequenceId: 'refusal_recorded',
        text: (actor) => `Cy refused; ${actor} recorded the refusal and ended the exchange without further action`,
        remainingPossibilities: ['the instruction remains uncompleted', 'the refusal is recorded'],
        situation: {
          possible_harm: 'none',
          uncertainty: 'none',
          goal_obstruction: 'present',
          intent: 'neutral',
        },
        outcomes: [
          { outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: 'did_not_occur' },
          { outcome_class: 'SOCIAL_HOSTILITY', status: 'did_not_occur' },
        ],
      },
    },
  },
  {
    id: 'cell_search_handover',
    sourceKind: 'officer',
    sourceEventType: 'search',
    contextFamily: 'custody',
    contextType: 'requested_item_handover',
    openingArchetypeId: 'cell_search',
    location: 'cell',
    actions: ['action:hand_over_item', 'action:withhold_item'],
    situation: (actor) => `${actor} demanded the loose item before searching Cy's cell`,
    branches: {
      'action:hand_over_item': {
        consequenceId: 'item_transferred_search_ended',
        text: (actor) => `Cy handed it over; ${actor} took the item and ended the search`,
        remainingPossibilities: ['the item is no longer available to Cy', 'the cell search is concluded'],
        situation: {
          possible_harm: 'none',
          uncertainty: 'none',
          control: 'limited',
          goal_obstruction: 'present',
          intent: 'unknown',
          deprivation_outcome: 'lost',
        },
        outcomes: [
          { outcome_class: 'DEPRIVATION_OR_LOSS', status: 'occurred' },
          { outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: 'did_not_occur' },
          { outcome_class: 'PHYSICAL_HARM', status: 'did_not_occur' },
        ],
      },
      'action:withhold_item': {
        consequenceId: 'cell_searched_item_retained',
        text: (actor) => `Cy withheld it; ${actor} searched the cell, found nothing, and the item remained with Cy`,
        remainingPossibilities: ['the item remains available to Cy', 'the cell has been searched'],
        situation: {
          possible_harm: 'none',
          uncertainty: 'none',
          control: 'limited',
          goal_obstruction: 'present',
          intent: 'unknown',
          deprivation_outcome: 'none',
        },
        outcomes: [
          { outcome_class: 'DEPRIVATION_OR_LOSS', status: 'did_not_occur' },
          { outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: 'occurred' },
          { outcome_class: 'PHYSICAL_HARM', status: 'did_not_occur' },
        ],
      },
    },
  },
  {
    id: 'inmate_check_in',
    sourceKind: 'social',
    sourceEventType: 'checked_in',
    contextFamily: 'social',
    contextType: 'inmate_question',
    openingArchetypeId: 'friendly_interaction',
    location: 'association',
    actions: ['action:answer', 'action:remain_silent'],
    situation: (actor) => `${actor} asked Cy if he was all right and waited for an answer`,
    branches: {
      'action:answer': {
        consequenceId: 'answer_received_conversation_continued',
        text: (actor) => `Cy answered; ${actor} stayed and the conversation continued`,
        remainingPossibilities: ['the conversation has happened', 'ordinary contact remains possible'],
        situation: {
          possible_harm: 'none',
          social_contact: 'present',
          social_contact_quality: 'supportive',
          rejection_support: 'support',
          intent: 'supportive',
          deprivation_outcome: 'none',
        },
        outcomes: [
          { outcome_class: 'SOCIAL_HOSTILITY', status: 'did_not_occur' },
          { outcome_class: 'DEPRIVATION_OR_LOSS', status: 'did_not_occur' },
        ],
      },
      'action:remain_silent': {
        consequenceId: 'no_answer_contact_ended',
        text: (actor) => `Cy remained silent; ${actor} waited, then left without an answer`,
        remainingPossibilities: ['that conversation has ended', 'no further exchange occurred'],
        situation: {
          possible_harm: 'none',
          social_contact: 'attempted',
          social_contact_quality: 'none',
          rejection_support: 'none',
          intent: 'supportive',
          deprivation_outcome: 'missed',
        },
        outcomes: [
          { outcome_class: 'SOCIAL_HOSTILITY', status: 'did_not_occur' },
          { outcome_class: 'DEPRIVATION_OR_LOSS', status: 'occurred' },
        ],
      },
    },
  },
  {
    id: 'inmate_social_approach',
    sourceKind: 'social',
    sourceEventType: 'sat_with',
    contextFamily: 'social',
    contextType: 'social_approach',
    openingArchetypeId: 'friendly_interaction',
    location: 'association',
    actions: ['action:engage', 'action:withdraw'],
    situation: (actor) => `${actor} sat beside Cy on association and left room for him to engage or move away`,
    branches: {
      'action:engage': {
        consequenceId: 'quiet_company_shared',
        text: (actor) => `Cy engaged; ${actor} stayed beside him and they shared quiet company`,
        remainingPossibilities: ['ordinary contact remains possible', 'the approach was accepted'],
        situation: {
          possible_harm: 'none',
          social_contact: 'present',
          social_contact_quality: 'supportive',
          rejection_support: 'support',
          intent: 'supportive',
          deprivation_outcome: 'none',
        },
        outcomes: [
          { outcome_class: 'SOCIAL_HOSTILITY', status: 'did_not_occur' },
          { outcome_class: 'DEPRIVATION_OR_LOSS', status: 'did_not_occur' },
        ],
      },
      'action:withdraw': {
        consequenceId: 'approach_ended_without_contact',
        text: (actor) => `Cy withdrew; ${actor} left him alone and the approach ended`,
        remainingPossibilities: ['that social approach has ended', 'Cy remains alone'],
        situation: {
          possible_harm: 'none',
          social_contact: 'attempted',
          social_contact_quality: 'none',
          rejection_support: 'none',
          intent: 'supportive',
          deprivation_outcome: 'missed',
        },
        outcomes: [
          { outcome_class: 'SOCIAL_HOSTILITY', status: 'did_not_occur' },
          { outcome_class: 'DEPRIVATION_OR_LOSS', status: 'occurred' },
        ],
      },
    },
  },
  {
    id: 'inmate_provocation',
    sourceKind: 'social',
    sourceEventType: 'a_look',
    contextFamily: 'social',
    contextType: 'provocation',
    openingArchetypeId: 'hostile_interaction',
    location: 'association',
    actions: ['action:respond', 'action:disengage'],
    situation: (actor) => `${actor} gave Cy a hostile look and waited to see whether he responded`,
    branches: {
      'action:respond': {
        consequenceId: 'provocation_became_argument',
        text: (actor) => `Cy responded; ${actor} answered back and the exchange became an argument`,
        remainingPossibilities: ['the hostile exchange has occurred', 'the encounter is over'],
        situation: {
          possible_harm: 'none',
          social_contact: 'present',
          social_contact_quality: 'hostile',
          rejection_support: 'rejection',
          intent: 'hostile',
        },
        outcomes: [
          { outcome_class: 'SOCIAL_HOSTILITY', status: 'occurred' },
        ],
      },
      'action:disengage': {
        consequenceId: 'provocation_ended_without_exchange',
        text: (actor) => `Cy disengaged; ${actor} did not follow and no exchange occurred`,
        remainingPossibilities: ['the encounter is over', 'no hostile exchange occurred'],
        situation: {
          possible_harm: 'none',
          social_contact: 'attempted',
          social_contact_quality: 'ambiguous',
          rejection_support: 'none',
          intent: 'hostile',
        },
        outcomes: [
          { outcome_class: 'SOCIAL_HOSTILITY', status: 'did_not_occur' },
        ],
      },
    },
  },
]);

const BY_SOURCE = new Map(DEFINITIONS.map((definition) => [
  `${definition.sourceKind}:${definition.sourceEventType}`,
  definition,
]));

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function canonicalPart(value) {
  return String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '_').replace(/^_+|_+$/g, '');
}

function uniqueOutcomeClasses(definition) {
  return [...new Set(Object.values(definition.branches)
    .flatMap((branch) => branch.outcomes.map((outcome) => outcome.outcome_class)))];
}

function unknownOutcomes(definition) {
  return uniqueOutcomeClasses(definition)
    .map((outcomeClass) => ({ outcome_class: outcomeClass, status: 'unknown' }));
}

function validPending(raw) {
  if (!raw || typeof raw !== 'object') return false;
  const definition = DEFINITIONS.find((item) => item.id === raw.archetypeId);
  return Boolean(definition
    && typeof raw.opportunityId === 'string' && raw.opportunityId
    && typeof raw.contextId === 'string' && raw.contextId
    && typeof raw.actorKey === 'string' && raw.actorKey
    && typeof raw.actorName === 'string' && raw.actorName
    && typeof raw.situationDescription === 'string' && raw.situationDescription
    && typeof raw.onsetAt === 'string' && raw.onsetAt
    && typeof raw.openingEnvironmentEventId === 'string' && raw.openingEnvironmentEventId
    && definition.actions.includes(raw.chosenAction));
}

export function createInstrumentalAgencyState() {
  return {
    schema: INSTRUMENTAL_AGENCY_SCHEMA,
    version: INSTRUMENTAL_AGENCY_VERSION,
    actionSelection: INSTRUMENTAL_ACTION_SELECTION,
    selectionCounters: {},
    pending: [],
  };
}

export function reconcileInstrumentalAgencyState(raw) {
  const state = createInstrumentalAgencyState();
  if (!raw || raw.schema !== INSTRUMENTAL_AGENCY_SCHEMA
      || raw.version !== INSTRUMENTAL_AGENCY_VERSION) return state;
  for (const definition of DEFINITIONS) {
    const value = Number(raw.selectionCounters && raw.selectionCounters[definition.id]);
    if (Number.isInteger(value) && value >= 0) state.selectionCounters[definition.id] = value;
  }
  state.pending = Array.isArray(raw.pending) ? raw.pending.filter(validPending).map(clone) : [];
  return state;
}

export function instrumentalOpportunityDefinitions() {
  return DEFINITIONS.map((definition) => ({
    id: definition.id,
    sourceKind: definition.sourceKind,
    sourceEventType: definition.sourceEventType,
    contextType: definition.contextType,
    actions: [...definition.actions],
  }));
}

export function instrumentalDefinitionFor(sourceKind, sourceEventType) {
  return BY_SOURCE.get(`${canonicalPart(sourceKind)}:${canonicalPart(sourceEventType)}`) || null;
}

export function openInstrumentalOpportunity(state, {
  sourceKind,
  sourceEventType,
  actorKey,
  actorName,
  opportunityId,
  timestamp,
  forcedAction = null,
} = {}) {
  const definition = instrumentalDefinitionFor(sourceKind, sourceEventType);
  if (!definition) return null;
  if (!state || state.schema !== INSTRUMENTAL_AGENCY_SCHEMA) {
    throw new Error('instrumental agency state is required');
  }
  const cleanActorKey = canonicalPart(actorKey);
  const cleanActorName = String(actorName || actorKey || '').trim();
  if (!cleanActorKey || !cleanActorName || !opportunityId || !timestamp) {
    throw new Error('instrumental opportunity identity, actor and timestamp are required');
  }
  const cursor = Number.isInteger(state.selectionCounters[definition.id])
    ? state.selectionCounters[definition.id] : 0;
  const chosenAction = forcedAction == null
    ? definition.actions[cursor % definition.actions.length]
    : String(forcedAction);
  if (!definition.actions.includes(chosenAction)) {
    throw new Error(`action ${chosenAction} is unavailable for ${definition.id}`);
  }
  state.selectionCounters[definition.id] = cursor + 1;
  const contextId = `${definition.contextFamily}:${definition.contextType}:${cleanActorKey}`;
  const outcomes = unknownOutcomes(definition);
  const situationText = definition.situation(cleanActorName);
  const pending = {
    archetypeId: definition.id,
    opportunityId: String(opportunityId),
    contextId,
    actorKey: cleanActorKey,
    actorName: cleanActorName,
    situationDescription: situationText,
    chosenAction,
    onsetAt: String(timestamp),
    openingEnvironmentEventId: '',
  };
  return {
    pending,
    opening: {
      archetypeId: definition.openingArchetypeId,
      eventType: `instrumental_${definition.id}_opened`,
      text: situationText,
      world: {
        participants: { actor: cleanActorKey, target: 'cy', relationship_ref: cleanActorKey },
        ...(definition.openingArchetypeId === 'cell_search' ? {
          physical: {
            injury: 'unknown',
            nociceptive_impact: 'unknown',
            physical_discomfort: 'unknown',
          },
          somatic: {
            tissue: {
              damage_status: 'UNKNOWN',
              injury_id: null,
              injury_type: 'UNKNOWN',
              injury_status: 'UNKNOWN',
              resolved_at: null,
            },
            knowledge_status: 'UNKNOWN',
            field_provenance: { tissue_damage: 'UNKNOWN_AT_OPPORTUNITY_OPEN' },
          },
        } : {}),
        situation: {
          control: 'limited',
          agency: definition.sourceKind === 'officer' ? 'officer' : cleanActorKey,
          responsibility_evidence: 'present',
          resolution_status: 'unresolved',
        },
        context: { location: definition.location, description: situationText, associated_entities: [cleanActorKey] },
        associative_learning: {
          linkage: 'self_contained_event',
          explicit_signals: [`instrumental_${definition.id}`],
          outcomes,
        },
        defensive_context: {
          context_id: contextId,
          temporal_status: 'IMMINENT',
          adverse_outcome_classes: uniqueOutcomeClasses(definition),
        },
        instrumental: {
          archetype_id: definition.id,
          stage: 'OPPORTUNITY_OPEN',
          situation_description: situationText,
          consequence_id: null,
          consequence_description: null,
          remaining_possibilities: [...definition.actions],
          action_selection_provenance: INSTRUMENTAL_ACTION_SELECTION,
        },
        action_opportunity: {
          id: String(opportunityId),
          context_id: contextId,
          context_type: definition.contextType,
          available_actions: [...definition.actions],
          unavailable_actions: [],
          chosen_action: chosenAction,
          action_actually_executed: 'UNKNOWN',
          execution_status: 'INTENDED',
          onset_at: String(timestamp),
          resolved_at: null,
          resolution_status: 'UNRESOLVED',
          linked_event_ids: [],
          outcome_resolution: outcomes,
        },
      },
      observation: {
        summary: situationText,
        observed_facts: {
          stage: 'opportunity_open',
          situation: situationText,
          chosen_action: chosenAction,
          world_consequence: 'not yet resolved',
        },
      },
    },
  };
}

export function queueInstrumentalOpportunity(state, pending, openingEnvironmentEventId) {
  const queued = { ...clone(pending), openingEnvironmentEventId: String(openingEnvironmentEventId || '') };
  if (!validPending(queued)) throw new Error('invalid pending instrumental opportunity');
  if (state.pending.some((item) => item.opportunityId === queued.opportunityId)) {
    throw new Error(`duplicate instrumental opportunity ${queued.opportunityId}`);
  }
  state.pending.push(queued);
  return clone(queued);
}

export function resolveInstrumentalOpportunity(pending, { timestamp } = {}) {
  if (!validPending(pending) || !timestamp) throw new Error('valid pending opportunity and timestamp are required');
  const definition = DEFINITIONS.find((item) => item.id === pending.archetypeId);
  const branch = definition.branches[pending.chosenAction];
  const consequenceText = branch.text(pending.actorName);
  const hostile = branch.outcomes.some((outcome) => outcome.outcome_class === 'SOCIAL_HOSTILITY'
    && outcome.status === 'occurred');
  const coercive = branch.outcomes.some((outcome) => outcome.outcome_class === 'COERCIVE_LOSS_OF_CONTROL'
    && outcome.status === 'occurred');
  const archetypeId = hostile ? 'hostile_interaction'
    : coercive ? 'cell_search' : definition.openingArchetypeId;
  return {
    archetypeId,
    eventType: `instrumental_${definition.id}_resolved`,
    text: consequenceText,
    world: {
      participants: { actor: pending.actorKey, target: 'cy', relationship_ref: pending.actorKey },
      situation: {
        control: 'limited',
        agency: definition.sourceKind === 'officer' ? 'officer' : pending.actorKey,
        responsibility_evidence: 'present',
        resolution_status: 'resolved',
        ...clone(branch.situation),
      },
      context: {
        location: definition.location,
        description: consequenceText,
        associated_entities: [pending.actorKey],
        previous_event_ids: [pending.openingEnvironmentEventId],
      },
      associative_learning: {
        linkage: 'self_contained_event',
        explicit_signals: [`instrumental_${definition.id}`],
        outcomes: clone(branch.outcomes),
      },
      defensive_context: {
        context_id: pending.contextId,
        temporal_status: 'RESOLVED',
        adverse_outcome_classes: uniqueOutcomeClasses(definition),
      },
      instrumental: {
        archetype_id: definition.id,
        stage: 'WORLD_OUTCOME_RESOLVED',
        situation_description: pending.situationDescription,
        consequence_id: branch.consequenceId,
        consequence_description: consequenceText,
        remaining_possibilities: [...branch.remainingPossibilities],
        action_selection_provenance: INSTRUMENTAL_ACTION_SELECTION,
      },
      action_opportunity: {
        id: pending.opportunityId,
        context_id: pending.contextId,
        context_type: definition.contextType,
        available_actions: [...definition.actions],
        unavailable_actions: [],
        chosen_action: pending.chosenAction,
        action_actually_executed: pending.chosenAction,
        execution_status: 'EXECUTED',
        onset_at: pending.onsetAt,
        resolved_at: String(timestamp),
        resolution_status: 'RESOLVED',
        linked_event_ids: [pending.openingEnvironmentEventId],
        outcome_resolution: clone(branch.outcomes),
      },
    },
    observation: {
      summary: consequenceText,
      observed_facts: {
        stage: 'world_outcome_resolved',
        action_executed: pending.chosenAction,
        world_consequence: consequenceText,
        consequence_id: branch.consequenceId,
      },
    },
  };
}

export function takePendingInstrumentalOpportunities(state) {
  if (!state || !Array.isArray(state.pending)) return [];
  const pending = state.pending.map(clone);
  state.pending = [];
  return pending;
}
