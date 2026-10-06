<?php
declare(strict_types=1);
require __DIR__ . '/../lib/memory_formation_inference.php';

$checks = [];
$settings = captive_memory_inference_settings([]);
$checks['default is cloud without fallback'] = $settings['mode'] === 'DEEPSEEK';
$checks['separate conservative budget'] = $settings['concurrency'] === 1 && $settings['requests_hour'] === 20
    && $settings['requests_day'] === 100 && $settings['requests_month'] === 1000
    && $settings['gbp_hour'] === 0.05 && $settings['gbp_day'] === 0.25 && $settings['gbp_month'] === 2.0;
$windows = array_fill_keys(['hour','day','month'], ['requests'=>0,'estimated_gbp'=>0,'uncertain_gbp'=>0]);
$checks['available budget admits'] = captive_memory_inference_cap_reason($settings,$windows,0,0.001) === null;
$checks['concurrency admission'] = captive_memory_inference_cap_reason($settings,$windows,1,0.001) === 'concurrency_full';
foreach (['hour','day','month'] as $window) {
    $used = $windows;
    $used[$window]['requests'] = $settings['requests_' . $window];
    $checks[$window . ' request bound'] = captive_memory_inference_cap_reason($settings,$used,0,0) === $window . '_request_cap';
    $used = $windows;
    $used[$window]['estimated_gbp'] = $settings['gbp_' . $window];
    $checks[$window . ' spend bound'] = captive_memory_inference_cap_reason($settings,$used,0,0.001) === $window . '_spend_cap';
}
$pricing = captive_memory_inference_config()['pricing'];
$checks['cache usage costs less'] = captive_memory_inference_cost(0,1000,50,$pricing) < captive_memory_inference_cost(1000,0,50,$pricing);
$checks['zero reported tokens cost zero'] = captive_memory_inference_cost(0,0,0,$pricing) === 0.0;
$checks['local pacing has a safe operational reason'] = captive_memory_inference_reason('local_busy') === 'local_busy';
foreach ([['mode'=>'AUTO'],['mode'=>false],['concurrency'=>0],['gbp_day'=>-1],['gbp_hour'=>INF],['requests_day'=>'100'],['enabled'=>true]] as $i => $invalid) {
    try { captive_memory_inference_settings($invalid); $checks['invalid setting ' . $i] = false; }
    catch (InvalidArgumentException) { $checks['invalid setting ' . $i] = true; }
}
foreach (['LOCAL','OFF'] as $mode) $checks[$mode . ' explicit'] = captive_memory_inference_settings(['mode'=>$mode])['mode'] === $mode;
try { captive_memory_inference_reason('private provider body'); $checks['raw error rejected'] = false; }
catch (InvalidArgumentException) { $checks['raw error rejected'] = true; }
$server = ['CONTENT_TYPE'=>'application/json','HTTP_HOST'=>'cy.example','HTTP_ORIGIN'=>'https://cy.example'];
$checks['same origin'] = captive_memory_inference_same_origin($server);
$checks['cross origin denied'] = !captive_memory_inference_same_origin(array_replace($server,['HTTP_ORIGIN'=>'https://other.example']));
$checks['non JSON denied'] = !captive_memory_inference_same_origin(array_replace($server,['CONTENT_TYPE'=>'text/plain']));
$api = file_get_contents(__DIR__ . '/../public/api/memory-formation-inference.php');
$checks['paid settings exclude diagnostic admin override'] = str_contains($api,'captive_admin_same_network($db)') && !str_contains($api,'captive_is_admin(');
foreach ($checks as $label=>$pass) {
    if (!$pass) { fwrite(STDERR,'FAIL: ' . $label . PHP_EOL); exit(1); }
}
echo 'memory_formation_inference_test.php: ' . count($checks) . " checks passed\n";
