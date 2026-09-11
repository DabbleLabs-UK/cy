<?php
declare(strict_types=1);

function captive_environment_assert_no_model_outputs(array $value, string $path): void
{
    $forbidden = [
        'appraisal', 'appraisal_magnitude', 'emotion', 'emotion_score',
        'emotional_magnitude', 'brain_activation',
        'anxiety', 'arousal', 'stress', 'pain', 'hunger', 'fatigue',
        'loneliness', 'anger', 'rumination',
        'amygdala', 'insula', 'hypothalamic', 'acc', 'hippocampal',
        'prefrontal', 'temporalSocial',
    ];
    foreach ($value as $key => $child) {
        if (in_array((string)$key, $forbidden, true)) {
            throw new InvalidArgumentException($path . '.' . $key . ' is a model output, not an environment fact');
        }
        if (is_array($child)) {
            captive_environment_assert_no_model_outputs($child, $path . '.' . $key);
        }
    }
}

function captive_environment_record_validate(array $record): array
{
    $event = $record['world_event'] ?? null;
    $observation = $record['observation'] ?? null;
    $input = $record['soma_input'] ?? null;
    if (($record['schema'] ?? null) !== 'cy.environment-record'
        || !is_array($event)
        || ($event['schema'] ?? null) !== 'cy.environment-event'
        || !is_array($observation)
        || !is_array($input)
        || ($input['schema'] ?? null) !== 'cy.soma-input') {
        throw new InvalidArgumentException('invalid environment event record');
    }

    $id = (string)($event['id'] ?? '');
    $type = (string)($event['event_type'] ?? '');
    $family = (string)($event['event_family'] ?? '');
    $timestamp = (string)($event['timestamp'] ?? '');
    if ($id === '' || strlen($id) > 96
        || $type === '' || strlen($type) > 64
        || $family === '' || strlen($family) > 32
        || $timestamp === ''
        || (string)($input['event_id'] ?? '') !== $id) {
        throw new InvalidArgumentException('invalid environment event identity');
    }
    captive_environment_assert_no_model_outputs((array)($event['world'] ?? []), 'world');
    captive_environment_assert_no_model_outputs($observation, 'observation');
    captive_environment_assert_no_model_outputs($input, 'soma_input');
    return $record;
}

function captive_environment_meaningful_input_keys(array $input): array
{
    $keys = [];
    foreach ($input as $key => $value) {
        if (in_array($key, ['schema', 'version', 'event_id', 'event_type', 'event_family'], true)) {
            continue;
        }
        if ($value === null || $value === '' || $value === 'unknown' || $value === []) {
            continue;
        }
        $keys[] = (string)$key;
    }
    return $keys;
}

function captive_environment_record_inspection(array $record, array $registry): array
{
    captive_environment_record_validate($record);
    $input = $record['soma_input'];
    $meaningful = captive_environment_meaningful_input_keys($input);
    $relevant = [];
    foreach ($registry['soma_variables'] ?? [] as $entry) {
        $matched = array_values(array_intersect($meaningful, $entry['data_dependencies'] ?? []));
        if (!$matched) {
            continue;
        }
        $status = (string)($entry['implementation_status'] ?? 'NOT_IMPLEMENTED');
        $relevant[] = [
            'id' => (string)$entry['id'],
            'name' => (string)$entry['display_name'],
            'status' => $status,
            'public_label' => captive_implementation_public_label($registry, $status),
            'matched_dependencies' => $matched,
        ];
    }

    $consumers = [];
    foreach ($record['consumed_by'] ?? [] as $consumer) {
        if ($consumer === 'soma-input-staging-v1') {
            $consumers[] = [
                'id' => $consumer,
                'status' => 'IMPLEMENTED',
                'public_label' => 'LIVE',
                'detail' => 'Stores the categorical input without assigning an emotional magnitude.',
            ];
        } elseif ($consumer === 'process-s-normalized-v1') {
            $consumers[] = [
                'id' => $consumer,
                'status' => 'IMPLEMENTED',
                'public_label' => 'LIVE',
                'detail' => 'Uses only observed sleep/wake state and elapsed time in the Borbely/Daan Process S equations. It does not assign an emotional magnitude.',
            ];
        } elseif ($consumer === 'probabilistic-threat-learning-v1') {
            $consumers[] = [
                'id' => $consumer,
                'status' => 'IMPLEMENTED',
                'public_label' => 'LIVE',
                'detail' => 'Examines only explicit structured cue/outcome links. Resolved occurred or did-not-occur trials update independent Beta-Bernoulli posteriors; unknown outcomes do not update.',
            ];
        } elseif ($consumer === 'current-defensive-context-v1') {
            $consumers[] = [
                'id' => $consumer,
                'status' => 'IMPLEMENTED',
                'public_label' => 'LIVE',
                'detail' => 'Joins present structured external cues to existing learned posteriors and keeps ambiguity, categorical imminence, objective control and resolution separate. It calculates no emotion score.',
            ];
        } elseif ($consumer === 'action-opportunity-model-v1') {
            $consumers[] = [
                'id' => $consumer,
                'status' => 'IMPLEMENTED',
                'public_label' => 'LIVE',
                'detail' => 'Reads only explicit structured action availability, selection, execution, timing and resolution. Missing action data is not treated as deliberate inaction.',
            ];
        } elseif ($consumer === 'action-outcome-contingency-v1') {
            $consumers[] = [
                'id' => $consumer,
                'status' => 'IMPLEMENTED',
                'public_label' => 'LIVE',
                'detail' => 'Updates separate Beta-Bernoulli posteriors for executed action and explicit no-action conditions in the same context. It infers neither causal nor perceived control.',
            ];
        } elseif ($consumer === 'prison-instrumental-opportunities-v1') {
            $consumers[] = [
                'id' => $consumer,
                'status' => 'IMPLEMENTED',
                'public_label' => 'LIVE',
                'detail' => 'Extends an eligible prison incident into an explicit situation, available action, executed action and factual world consequence. Live action selection is engineering round-robin, not a psychological model.',
            ];
        } elseif ($consumer === 'feeding-event-model-v1') {
            $consumers[] = [
                'id' => $consumer,
                'status' => 'IMPLEMENTED',
                'public_label' => 'LIVE',
                'detail' => 'Normalizes only explicit structured food offering, availability, receipt, consumption and portion facts. It does not calculate Hunger.',
            ];
        } elseif ($consumer === 'ingestion-ledger-v1') {
            $consumers[] = [
                'id' => $consumer,
                'status' => 'IMPLEMENTED',
                'public_label' => 'LIVE',
                'detail' => 'Persists the canonical ingestion record and updates factual feeding-history indexes. It does not infer calories, physiology or appetite.',
            ];
        } elseif (in_array($consumer, [
            'somatic-event-model-v1',
            'noxious-stimulus-representation-v1',
            'injury-ledger-v1',
            'computational-nociceptive-input-analogue-v1',
        ], true)) {
            $consumers[] = [
                'id' => $consumer,
                'status' => 'IMPLEMENTED',
                'public_label' => 'LIVE',
                'detail' => 'Reads only structured somatic facts and preserves explicit unknowns. It calculates no subjective Pain, healing, sensitisation, action or brain activation.',
            ];
        } elseif (in_array($consumer, ['social-episode-model-v1', 'social-contact-detector-ledger-v1'], true)) {
            $consumers[] = [
                'id' => $consumer,
                'status' => 'IMPLEMENTED',
                'public_label' => 'LIVE',
                'detail' => 'Reads only explicit structured social facts and records contact, opportunity, reciprocity, character and continuity separately. It calculates no Loneliness or affiliation magnitude.',
            ];
        } elseif ($consumer === 'legacy-experienced-state-v2') {
            $consumers[] = [
                'id' => $consumer,
                'status' => 'PROVISIONAL',
                'public_label' => 'PROVISIONAL',
                'detail' => 'The same event also entered the older heuristic compatibility path. Its numeric appraisal is not part of this structured record.',
            ];
        } else {
            $consumers[] = [
                'id' => (string)$consumer,
                'status' => 'NOT_IMPLEMENTED',
                'public_label' => 'NOT MODELLED',
                'detail' => 'No registered consumer description exists.',
            ];
        }
    }

    $world = (array)($record['world_event']['world'] ?? []);
    $opportunity = (array)($world['action_opportunity'] ?? []);
    $instrumental = (array)($world['instrumental'] ?? []);
    $instrumentalInspection = ($instrumental['archetype_id'] ?? null) === null
        ? [
            'status' => 'not_applicable',
            'detail' => 'This event is not one of the implemented prison instrumental opportunities.',
        ]
        : [
            'situation' => $instrumental['situation_description'] ?? $world['context']['description'] ?? $observation['summary'] ?? null,
            'available_actions' => $opportunity['available_actions'] ?? [],
            'unavailable_actions' => $opportunity['unavailable_actions'] ?? [],
            'action_selected' => $opportunity['chosen_action'] ?? 'unknown',
            'action_executed' => $opportunity['action_actually_executed'] ?? 'unknown',
            'action_selection_provenance' => $instrumental['action_selection_provenance'] ?? null,
            'world_consequence' => $instrumental['consequence_description'] ?? 'not yet resolved',
            'remaining_possibilities' => $instrumental['remaining_possibilities'] ?? [],
            'resolution' => [
                'stage' => $instrumental['stage'] ?? null,
                'status' => $opportunity['resolution_status'] ?? 'unknown',
                'resolved_at' => $opportunity['resolved_at'] ?? null,
            ],
            'adverse_outcome_classification' => $opportunity['outcome_resolution'] ?? [],
            'contingency_learner_update' => $record['action_outcome_contingency'] ?? null,
        ];

    return [
        'event_id' => (string)$record['world_event']['id'],
        'what_happened' => $record['world_event'],
        'what_cy_observed' => $record['observation'],
        'what_soma_received' => $record['soma_input'],
        'what_threat_learning_did' => $record['threat_learning'] ?? [
            'status' => 'not_recorded',
            'detail' => 'This record predates the probabilistic threat-learning implementation or did not reach that consumer.',
        ],
        'what_current_defensive_context_did' => $record['current_defensive_context'] ?? [
            'status' => 'not_recorded',
            'detail' => 'This record predates current defensive context or did not reach that consumer.',
        ],
        'what_action_outcome_contingency_did' => $record['action_outcome_contingency'] ?? [
            'status' => 'not_recorded',
            'detail' => 'This record has no explicit action opportunity, predates action-outcome learning, or did not reach that consumer.',
        ],
        'what_instrumental_agency_did' => $instrumentalInspection,
        'what_feeding_ledger_did' => $record['feeding'] ?? [
            'status' => 'not_recorded',
            'detail' => 'This record is not a feeding event, predates the feeding ledger, or did not reach that consumer.',
        ],
        'what_somatic_noxious_substrate_did' => $record['somatic_nociceptive'] ?? [
            'status' => 'not_recorded',
            'detail' => 'This record has no structured somatic facts, predates the somatic substrate, or did not reach that consumer.',
        ],
        'what_social_contact_substrate_did' => $record['social_contact'] ?? [
            'status' => 'not_recorded',
            'detail' => 'This record has no canonical social episode, predates the social ledger, or did not reach that consumer.',
        ],
        'what_systems_consumed_it' => [
            'consumers' => $consumers,
            'registry_relevance' => $relevant,
        ],
    ];
}
