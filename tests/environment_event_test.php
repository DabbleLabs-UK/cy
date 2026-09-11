<?php
declare(strict_types=1);

require __DIR__ . '/../lib/implementation_registry.php';
require __DIR__ . '/../lib/environment_event.php';

$failures = [];
function check_environment(bool $condition, string $message): void {
    global $failures;
    if (!$condition) {
        $failures[] = $message;
    }
}

$record = [
    'schema' => 'cy.environment-record',
    'version' => 1,
    'world_event' => [
        'schema' => 'cy.environment-event',
        'version' => 1,
        'id' => 'env-test',
        'timestamp' => '2026-09-10 12:00:00.000',
        'event_type' => 'cell_search',
        'event_family' => 'custody',
        'world' => ['situation' => ['possible_harm' => 'possible']],
    ],
    'observation' => ['modality' => 'direct', 'certainty' => 'certain'],
    'soma_input' => [
        'schema' => 'cy.soma-input',
        'version' => 1,
        'event_id' => 'env-test',
        'possible_harm' => 'possible',
        'uncertainty' => 'unknown',
    ],
    'consumed_by' => ['soma-input-staging-v1', 'legacy-experienced-state-v2'],
];

check_environment(captive_environment_record_validate($record) === $record, 'record validation changed the record');
$inspection = captive_environment_record_inspection($record, captive_implementation_registry());
check_environment($inspection['what_happened']['id'] === 'env-test', 'wrong event id');
check_environment($inspection['what_cy_observed']['modality'] === 'direct', 'wrong observation modality');
check_environment($inspection['what_soma_received']['possible_harm'] === 'possible', 'Soma input was not preserved');
check_environment(count($inspection['what_systems_consumed_it']['consumers']) === 2, 'wrong consumer count');
check_environment($inspection['what_systems_consumed_it']['consumers'][1]['public_label'] === 'PROVISIONAL', 'legacy consumer must be provisional');

$sleepRecord = $record;
$sleepRecord['world_event']['id'] = 'env-sleep-test';
$sleepRecord['world_event']['event_type'] = 'sleep_state_asleep';
$sleepRecord['world_event']['event_family'] = 'homeostasis';
$sleepRecord['soma_input']['event_id'] = 'env-sleep-test';
$sleepRecord['soma_input']['sleep_period'] = 'sleep_period';
$sleepRecord['consumed_by'] = ['soma-input-staging-v1', 'process-s-normalized-v1', 'tpm-predicted-kss-v1'];
$sleepInspection = captive_environment_record_inspection($sleepRecord, captive_implementation_registry());
check_environment($sleepInspection['what_systems_consumed_it']['consumers'][1]['public_label'] === 'LIVE', 'Process S consumer must be LIVE');
check_environment(str_contains($sleepInspection['what_systems_consumed_it']['consumers'][1]['detail'], 'Process S'), 'Process S consumer provenance is missing');
check_environment($sleepInspection['what_systems_consumed_it']['consumers'][2]['public_label'] === 'LIVE', 'TPM KSS consumer must be LIVE');
check_environment(str_contains($sleepInspection['what_systems_consumed_it']['consumers'][2]['detail'], 'predict KSS'), 'TPM KSS consumer provenance is missing');

$threatRecord = $record;
$threatRecord['consumed_by'] = ['soma-input-staging-v1', 'probabilistic-threat-learning-v1'];
$threatRecord['threat_learning'] = [
    'modelVersion' => 'probabilistic-threat-learning-v1',
    'trialsExamined' => 1,
    'updatesApplied' => 1,
    'results' => [[
        'updated' => true,
        'update' => [
            'cueId' => 'event:cell_search',
            'outcomeClass' => 'COERCIVE_LOSS_OF_CONTROL',
            'u' => 1,
            'before' => ['alpha' => 1, 'beta' => 1, 'mean' => 0.5],
            'after' => ['alpha' => 2, 'beta' => 1, 'mean' => 2 / 3],
        ],
    ]],
];
$threatInspection = captive_environment_record_inspection($threatRecord, captive_implementation_registry());
check_environment($threatInspection['what_threat_learning_did']['updatesApplied'] === 1, 'threat-learning trace was not exposed');
check_environment($threatInspection['what_systems_consumed_it']['consumers'][1]['public_label'] === 'LIVE', 'threat learner consumer must be LIVE');
$threatApiSource = file_get_contents(__DIR__ . '/../public/api/threat-learning.php');
check_environment(str_contains($threatApiSource, 'captive_is_admin'), 'exact threat-learning inspection must be admin-only');
check_environment(str_contains($threatApiSource, "'history' => \$history"), 'exact threat-learning history must be exposed to admin');

$contextRecord = $record;
$contextRecord['consumed_by'] = ['soma-input-staging-v1', 'current-defensive-context-v1'];
$contextRecord['current_defensive_context'] = [
    'modelVersion' => 'current-defensive-context-v1',
    'updated' => true,
    'transitions' => [[
        'contextKey' => 'search:one|COERCIVE_LOSS_OF_CONTROL',
        'active' => true,
        'temporalStatus' => 'IMMINENT',
        'objectiveControllability' => 'NONE',
        'perceivedControllability' => 'NOT_MODELLED',
    ]],
];
$contextInspection = captive_environment_record_inspection($contextRecord, captive_implementation_registry());
check_environment($contextInspection['what_current_defensive_context_did']['updated'] === true, 'current defensive-context trace was not exposed');
check_environment($contextInspection['what_systems_consumed_it']['consumers'][1]['public_label'] === 'LIVE', 'current defensive-context consumer must be LIVE');
$contextApiSource = file_get_contents(__DIR__ . '/../public/api/defensive-context.php');
check_environment(str_contains($contextApiSource, 'captive_is_admin'), 'exact defensive-context inspection must be admin-only');
check_environment(str_contains($contextApiSource, "'activeContexts' => \$active"), 'active defensive contexts must be exposed to admin');
check_environment(str_contains($contextApiSource, "'history' => \$history"), 'defensive-context transition history must be exposed to admin');

$controlRecord = $record;
$controlRecord['consumed_by'] = ['soma-input-staging-v1', 'action-opportunity-model-v1', 'action-outcome-contingency-v1'];
$controlRecord['action_outcome_contingency'] = [
    'modelVersion' => 'action-outcome-contingency-v1',
    'updated' => true,
    'opportunity' => ['opportunityId' => 'meal:test:lunch'],
    'updates' => [[
        'condition' => 'action',
        'actionId' => 'action:accept_meal',
        'before' => ['alpha' => 1, 'beta' => 1],
        'after' => ['alpha' => 1, 'beta' => 2],
    ]],
];
$controlInspection = captive_environment_record_inspection($controlRecord, captive_implementation_registry());
check_environment($controlInspection['what_action_outcome_contingency_did']['updated'] === true, 'action-outcome trace was not exposed');
check_environment($controlInspection['what_systems_consumed_it']['consumers'][1]['public_label'] === 'LIVE', 'action opportunity consumer must be LIVE');
check_environment($controlInspection['what_systems_consumed_it']['consumers'][2]['public_label'] === 'LIVE', 'action-outcome learner consumer must be LIVE');
$controlApiSource = file_get_contents(__DIR__ . '/../public/api/action-outcome-contingency.php');
check_environment(str_contains($controlApiSource, 'captive_is_admin'), 'exact action-outcome inspection must be admin-only');
check_environment(str_contains($controlApiSource, "'opportunities' => array_values(\$opportunities)"), 'complete action opportunities must be exposed to admin');
check_environment(str_contains($controlApiSource, "'history' => \$history"), 'complete action-outcome update history must be exposed to admin');

$instrumentalRecord = $controlRecord;
$instrumentalRecord['world_event']['world'] = [
    'context' => ['description' => 'Mr Proctor gave Cy a direct instruction'],
    'instrumental' => [
        'archetype_id' => 'officer_order',
        'stage' => 'WORLD_OUTCOME_RESOLVED',
        'situation_description' => 'Mr Proctor gave Cy a direct instruction',
        'consequence_description' => 'Cy complied and Mr Proctor moved on',
        'remaining_possibilities' => ['the routine continues'],
        'action_selection_provenance' => 'ENGINEERING_ROUND_ROBIN_NOT_PSYCHOLOGICAL',
    ],
    'action_opportunity' => [
        'available_actions' => ['action:comply_instruction', 'action:refuse_instruction'],
        'unavailable_actions' => [],
        'chosen_action' => 'action:comply_instruction',
        'action_actually_executed' => 'action:comply_instruction',
        'resolution_status' => 'RESOLVED',
        'resolved_at' => '2026-09-10 12:00:05.000',
        'outcome_resolution' => [[
            'outcome_class' => 'SOCIAL_HOSTILITY',
            'status' => 'did_not_occur',
        ]],
    ],
];
$instrumentalRecord['consumed_by'][] = 'prison-instrumental-opportunities-v1';
$instrumentalInspection = captive_environment_record_inspection($instrumentalRecord, captive_implementation_registry());
check_environment($instrumentalInspection['what_instrumental_agency_did']['situation'] === 'Mr Proctor gave Cy a direct instruction', 'opening instrumental situation was not retained');
check_environment($instrumentalInspection['what_instrumental_agency_did']['action_executed'] === 'action:comply_instruction', 'executed instrumental action was not exposed');
check_environment($instrumentalInspection['what_instrumental_agency_did']['world_consequence'] === 'Cy complied and Mr Proctor moved on', 'instrumental consequence was not exposed');
check_environment($instrumentalInspection['what_instrumental_agency_did']['contingency_learner_update']['updated'] === true, 'instrumental learner update was not exposed');
$instrumentalConsumers = $instrumentalInspection['what_systems_consumed_it']['consumers'];
check_environment($instrumentalConsumers[array_key_last($instrumentalConsumers)]['public_label'] === 'LIVE', 'instrumental consumer was not labelled live');

$feedingRecord = $record;
$feedingRecord['world_event']['id'] = 'env-feeding-test';
$feedingRecord['world_event']['event_type'] = 'lunch_consumed';
$feedingRecord['world_event']['event_family'] = 'homeostasis';
$feedingRecord['soma_input']['event_id'] = 'env-feeding-test';
$feedingRecord['consumed_by'] = ['soma-input-staging-v1', 'feeding-event-model-v1', 'ingestion-ledger-v1'];
$feedingRecord['feeding'] = [
    'updated' => true,
    'record' => [
        'schema' => 'cy.ingestion-record',
        'eventId' => 'env-feeding-test',
        'intakeOutcome' => 'FULLY_CONSUMED',
    ],
];
$feedingInspection = captive_environment_record_inspection($feedingRecord, captive_implementation_registry());
check_environment($feedingInspection['what_feeding_ledger_did']['record']['intakeOutcome'] === 'FULLY_CONSUMED', 'feeding trace was not exposed');
check_environment($feedingInspection['what_systems_consumed_it']['consumers'][1]['public_label'] === 'LIVE', 'feeding event consumer must be LIVE');
check_environment($feedingInspection['what_systems_consumed_it']['consumers'][2]['public_label'] === 'LIVE', 'ingestion ledger consumer must be LIVE');
$feedingApiSource = file_get_contents(__DIR__ . '/../public/api/feeding.php');
check_environment(str_contains($feedingApiSource, 'captive_is_admin'), 'exact feeding inspection must be admin-only');
check_environment(str_contains($feedingApiSource, "'records' => \$records"), 'complete feeding records must be exposed to admin');
check_environment(str_contains($feedingApiSource, "'homeostaticPhysiologicalState' => 'NOT_MODELLED'"), 'admin inspection must preserve the physiological boundary');

$somaticRecord = $record;
$somaticRecord['world_event']['id'] = 'env-somatic-test';
$somaticRecord['world_event']['event_type'] = 'injury';
$somaticRecord['world_event']['event_family'] = 'physical';
$somaticRecord['soma_input']['event_id'] = 'env-somatic-test';
$somaticRecord['consumed_by'] = ['soma-input-staging-v1', 'somatic-event-model-v1', 'injury-ledger-v1'];
$somaticRecord['somatic_nociceptive'] = [
    'updated' => true,
    'event' => [
        'schema' => 'cy.somatic-event',
        'eventId' => 'env-somatic-test',
        'tissue' => ['damageStatus' => 'CONFIRMED', 'injuryId' => 'injury:test'],
    ],
    'subjectivePain' => 'NOT_MODELLED',
];
$somaticInspection = captive_environment_record_inspection($somaticRecord, captive_implementation_registry());
check_environment($somaticInspection['what_somatic_noxious_substrate_did']['event']['tissue']['injuryId'] === 'injury:test', 'somatic trace was not exposed');
check_environment($somaticInspection['what_systems_consumed_it']['consumers'][1]['public_label'] === 'LIVE', 'somatic event consumer must be LIVE');
check_environment($somaticInspection['what_systems_consumed_it']['consumers'][2]['public_label'] === 'LIVE', 'injury ledger consumer must be LIVE');
$somaticApiSource = file_get_contents(__DIR__ . '/../public/api/somatic.php');
check_environment(str_contains($somaticApiSource, 'captive_is_admin'), 'exact somatic inspection must be admin-only');
check_environment(str_contains($somaticApiSource, "'eventTraces' => \$traces"), 'complete somatic event traces must be exposed to admin');
check_environment(str_contains($somaticApiSource, "'subjectivePain' => 'NOT_MODELLED'"), 'admin somatic inspection must preserve the subjective Pain boundary');

$source = file_get_contents(__DIR__ . '/../public/api/ingest.php');
check_environment(str_contains($source, "if (\$kind === 'world_event_record')"), 'ingest must handle private records');
check_environment(str_contains($source, 'continue;'), 'private records must not fall through to public events');

$invalid = $record;
$invalid['world_event']['world']['appraisal'] = ['anxiety' => 0.8];
$rejected = false;
try {
    captive_environment_record_validate($invalid);
} catch (InvalidArgumentException $e) {
    $rejected = str_contains($e->getMessage(), 'model output');
}
check_environment($rejected, 'environment records must reject emotional or appraisal output fields');

if ($failures !== []) {
    fwrite(STDERR, implode("\n", $failures) . "\n");
    exit(1);
}

echo "ALL PASS\n";
