<?php
declare(strict_types=1);

require __DIR__ . '/../lib/postcard_inference.php';

$passed = 0;
function verify(bool $ok, string $message): void
{
    global $passed;
    if (!$ok) throw new RuntimeException($message);
    $passed++;
    echo "ok {$message}\n";
}
function rejects(callable $fn): bool
{
    try { $fn(); } catch (InvalidArgumentException) { return true; }
    return false;
}

$config = captive_postcard_inference_config();
$settings = captive_postcard_inference_settings([]);
$pricing = $config['pricing'];
$empty = array_fill_keys(['hour', 'day', 'month'], ['requests' => 0, 'estimated_gbp' => 0, 'uncertain_gbp' => 0]);
verify($settings['concurrency'] === 1 && $settings['gbp_month'] === 5.0, 'conservative editable defaults');
verify(captive_postcard_inference_route_choice($settings, true, true, null)['provider'] === 'deepseek', 'AUTO healthy selects cloud');
verify(captive_postcard_inference_route_choice(array_replace($settings, ['enabled' => false, 'route' => 'DEEPSEEK']), true, true, null)['provider'] === 'ollama', 'OFF always selects local');
verify(captive_postcard_inference_route_choice(array_replace($settings, ['route' => 'LOCAL']), true, true, null)['provider'] === 'ollama', 'LOCAL selects local');
foreach (['credentials_missing' => [false, true, null], 'provider_unavailable' => [true, false, null], 'hour_spend_cap' => [true, true, 'hour_spend_cap']] as $reason => $args) {
    $choice = captive_postcard_inference_route_choice($settings, ...$args);
    verify($choice['provider'] === 'ollama' && $choice['reason'] === $reason, 'AUTO falls back for ' . $reason);
    $choice = captive_postcard_inference_route_choice(array_replace($settings, ['route' => 'DEEPSEEK']), ...$args);
    verify($choice['provider'] === null && $choice['reason'] === $reason, 'DEEPSEEK held for ' . $reason);
}
verify(captive_postcard_inference_cap_reason($settings, $empty, 1, 0.001) === 'concurrency_full', 'concurrency enforced');
foreach (['hour', 'day', 'month'] as $window) {
    $full = $empty;
    $full[$window]['requests'] = $settings['requests_' . $window];
    verify(captive_postcard_inference_cap_reason($settings, $full, 0, 0) === $window . '_request_cap', $window . ' requests enforced');
    $full = $empty;
    $full[$window]['estimated_gbp'] = $settings['gbp_' . $window] - 0.0001;
    verify(captive_postcard_inference_cap_reason($settings, $full, 0, 0.0002) === $window . '_spend_cap', $window . ' preflight worst-case enforced');
}
$worst = captive_postcard_inference_cost(10000, 0, 1000, $pricing);
$cached = captive_postcard_inference_cost(1000, 9000, 100, $pricing);
verify(abs($worst - 0.003318) < 0.0000000001, 'preflight pricing uses input and worst output');
verify($cached < $worst && $cached > 0, 'actual cache usage reduces calculated cost');
verify(captive_postcard_inference_cost(0, 0, 0, $pricing) === 0.0, 'zero reported usage is zero');
verify(rejects(fn() => captive_postcard_inference_settings(['route' => 'other'])), 'invalid route rejected');
verify(rejects(fn() => captive_postcard_inference_settings(['concurrency' => 0])), 'zero concurrency rejected');
verify(rejects(fn() => captive_postcard_inference_settings(['gbp_hour' => -1])), 'negative budget rejected');
verify(rejects(fn() => captive_postcard_inference_settings(['gbp_hour' => INF])), 'nonfinite budget rejected');
verify(rejects(fn() => captive_postcard_inference_settings(['enabled' => 'true'])), 'string boolean rejected');
verify(rejects(fn() => captive_postcard_inference_settings(['api_key' => 'secret'])), 'unknown setting rejected');
verify(captive_postcard_inference_reason('secret arbitrary provider message') === 'provider_error', 'provider message cannot enter ledger');
$origin = ['CONTENT_TYPE' => 'application/json', 'HTTP_HOST' => 'cy.dabblelabs.uk', 'HTTP_ORIGIN' => 'https://cy.dabblelabs.uk', 'HTTP_SEC_FETCH_SITE' => 'same-origin'];
verify(captive_postcard_inference_same_origin($origin), 'same origin JSON accepted');
verify(!captive_postcard_inference_same_origin(array_replace($origin, ['HTTP_ORIGIN' => 'https://attacker.example'])), 'other origin rejected');
verify(!captive_postcard_inference_same_origin(array_replace($origin, ['CONTENT_TYPE' => 'text/plain'])), 'simple cross-site body rejected');
verify(!captive_postcard_inference_same_origin(array_replace($origin, ['HTTP_SEC_FETCH_SITE' => 'cross-site'])), 'cross-site request rejected');
verify(!captive_postcard_inference_same_origin(array_replace($origin, ['HTTP_ORIGIN' => 'http://cy.dabblelabs.uk'])), 'insecure different origin rejected');
verify(!captive_postcard_inference_same_origin(['CONTENT_TYPE' => 'application/json', 'HTTP_HOST' => 'cy.dabblelabs.uk']), 'missing origin proof rejected');
$endpoint = file_get_contents(__DIR__ . '/../public/api/postcard-inference.php');
verify(str_contains($endpoint, 'captive_admin_same_network($db)') && !str_contains($endpoint, 'captive_is_admin('), 'paid writes exclude legacy query bypass');
echo "PASS {$passed} postcard inference checks\n";
