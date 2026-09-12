<?php
declare(strict_types=1);

require __DIR__ . '/../lib/soma.php';
require __DIR__ . '/../lib/http.php';

$failed = 0;
function check_soma(bool $condition, string $message): void
{
    global $failed;
    if (!$condition) {
        $failed++;
        fwrite(STDERR, "FAIL: $message\n");
    }
}

$state = [
    'version' => 1,
    'status' => 'implemented',
    'circuits' => ['attention' => ['value' => 0.71, 'source' => 'winner of current salience competition']],
    'experienced' => ['metrics' => ['anxiety' => ['value' => 42]]],
    'attention' => ['text' => 'Mr Locke moved the postcard'],
    'memory' => ['episodes' => 2],
    'feeding' => [
        'status' => 'implemented',
        'lastKnownIntakeAt' => '2026-09-10 11:45:00.000',
        'latestResolvedMeal' => ['intakeOutcome' => 'FULLY_CONSUMED'],
        'homeostaticEnergyState' => 'NOT_MODELLED',
        'subjectiveHunger' => 'NOT_MODELLED',
    ],
    'physiologicalSatiety' => [
        'status' => 'LIVE',
        'headline' => ['status' => 'ESTIMATE_AVAILABLE', 'estimate' => 4.7, 'central95' => ['lower' => 4.3, 'upper' => 5.1]],
        'subjectiveHunger' => 'NOT_MODELLED',
    ],
    'physiologicalSatietyInspection' => ['rawModelState' => ['ghrelin' => ['median' => -0.468]]],
    'learnedControllability' => [
        'status' => 'implemented',
        'contingencies' => [[
            'contextId' => 'meal:lunch',
            'actionId' => 'action:accept_meal',
            'contingencyDifference' => 0.25,
            'causalStatus' => 'NOT_ESTABLISHED',
        ]],
        'perceivedControl' => 'NOT_MODELLED',
    ],
];
$implemented = captive_soma_api_payload([
    'seq' => '42',
    'ts' => '2026-09-10 12:00:00.000000',
    'payload' => json_encode(['mode' => 'journal', 'soma' => $state], JSON_THROW_ON_ERROR),
]);
check_soma($implemented['ok'] === true, 'implemented state is available');
check_soma($implemented['seq'] === 42, 'event sequence is preserved');
check_soma($implemented['soma']['status'] === 'provisional', 'registry truth overrides the legacy runner claim');
check_soma($implemented['soma']['circuits'] === $state['circuits'], 'runner values are returned without recomputation');
check_soma($implemented['soma']['feeding'] === $state['feeding'], 'grounded feeding state is returned without recomputation');
check_soma($implemented['soma']['physiologicalSatiety'] === $state['physiologicalSatiety'], 'physiological Satiety range is returned without recomputation');
check_soma(!isset($implemented['soma']['physiologicalSatietyInspection']), 'admin-only raw physiological state is stripped from the public Soma response');
$publicVitals = captive_public_event_payload('vitals', ['soma' => $state]);
check_soma(!isset($publicVitals['soma']['physiologicalSatietyInspection']), 'admin-only raw physiological state is stripped from public event streams');
$publicGen = captive_public_event_payload('gen', [
    'tokens_in' => 2711,
    'mode' => 'journal',
    'form' => 'write',
    'zone_a' => str_repeat('private prompt ', 1000),
    'grounded_soma_context' => ['large' => str_repeat('state ', 1000)],
    'output' => 'rendered separately as text events',
]);
check_soma($publicGen['tokens_in'] === 2711 && $publicGen['mode'] === 'journal', 'public generation telemetry is preserved');
check_soma($publicGen['form'] === 'write', 'public generation form is preserved');
check_soma(!isset($publicGen['zone_a']), 'full prompt zones are stripped from public event streams');
check_soma(!isset($publicGen['grounded_soma_context']), 'large grounded prompt context is stripped from public event streams');
check_soma(!isset($publicGen['output']), 'duplicated full generation output is stripped from public event streams');
$dreamPayload = [
    'id' => 'dream-1',
    'sleep_period_id' => 'sleep-1',
    'state' => 'DREAMING',
    'classification' => 'DREAM / SUBJECTIVE EXPRESSION',
    'fragments' => ['grey corridor', 'eight marks, four across'],
    'lucid' => false,
    'context_packet' => ['memory_traces' => [['id' => 'memory-secret']]],
    'autobiographical_memory_ids' => ['memory-secret'],
    'provider' => 'provider-a',
    'latency_ms' => 123,
    'output_validation' => 'PASSED',
];
$publicDream = captive_public_event_payload('dream', $dreamPayload);
check_soma($publicDream['fragments'] === $dreamPayload['fragments'], 'public dream presentation preserves separate fragments');
check_soma(!isset($publicDream['context_packet']), 'dream context packet is stripped from public event streams');
check_soma(!isset($publicDream['autobiographical_memory_ids']), 'dream memory identifiers are stripped from public event streams');
$privateDream = captive_public_event_payload('dream', $dreamPayload, true);
check_soma(isset($privateDream['context_packet']) && isset($privateDream['autobiographical_memory_ids']), 'owner dream diagnostics preserve context and memory identifiers');
check_soma($implemented['soma']['learnedControllability'] === $state['learnedControllability'], 'action-outcome evidence is returned without recomputation');
check_soma($implemented['implementation_registry']['schema'] === 'cy.implementation-registry', 'registry accompanies the state');

$failedRuntime = captive_soma_api_payload([
    'seq' => '43',
    'ts' => '2026-09-10 12:00:05.000000',
    'payload' => json_encode(['soma' => ['status' => 'unavailable', 'reason' => 'bad persisted state']], JSON_THROW_ON_ERROR),
]);
check_soma($failedRuntime['ok'] === false, 'runtime failure stays unavailable');
check_soma($failedRuntime['reason'] === 'bad persisted state', 'runtime failure reason is preserved');

$missing = captive_soma_api_payload(null);
check_soma($missing['ok'] === false && $missing['soma'] === null, 'missing state is not fabricated');

echo $failed === 0 ? "ALL PASS\n" : "$failed FAILED\n";
exit($failed === 0 ? 0 : 1);
