<?php
declare(strict_types=1);

// admin_test.php - deterministic checks for the pure IP logic behind the
// automatic same-network admin unlock (lib/admin.php): CIDR membership, the
// Cloudflare-edge check, and the same-network comparison (IPv4 exact / IPv6 /64).
// No database or superglobals needed - just the pure helpers.
//
//   php tests/admin_test.php
//
// Exits non-zero if any assertion fails.

require __DIR__ . '/../lib/admin.php';

$pass = 0;
$fail = 0;
function check(string $label, bool $ok): void
{
    global $pass, $fail;
    echo ($ok ? '  ok   ' : '  FAIL ') . $label . "\n";
    $ok ? $pass++ : $fail++;
}

echo "==== CIDR MEMBERSHIP ====\n";
check('1.2.3.4 in 1.2.3.0/24', captive_ip_in_cidr('1.2.3.4', '1.2.3.0/24'));
check('1.2.4.4 NOT in 1.2.3.0/24', !captive_ip_in_cidr('1.2.4.4', '1.2.3.0/24'));
check('10.0.0.0 in 10.0.0.0/8', captive_ip_in_cidr('10.0.0.0', '10.0.0.0/8'));
check('11.0.0.0 NOT in 10.0.0.0/8', !captive_ip_in_cidr('11.0.0.0', '10.0.0.0/8'));
check('/32 exact match', captive_ip_in_cidr('5.6.7.8', '5.6.7.8/32'));
check('/32 non-match', !captive_ip_in_cidr('5.6.7.9', '5.6.7.8/32'));
// a /15 spanning two adjacent /16s (like Cloudflare's 162.158.0.0/15)
check('162.159.1.1 in 162.158.0.0/15', captive_ip_in_cidr('162.159.1.1', '162.158.0.0/15'));
check('162.160.0.1 NOT in 162.158.0.0/15', !captive_ip_in_cidr('162.160.0.1', '162.158.0.0/15'));
// IPv6 CIDR
check('2606:4700::1 in 2606:4700::/32', captive_ip_in_cidr('2606:4700::1', '2606:4700::/32'));
check('2606:4701::1 NOT in 2606:4700::/32', !captive_ip_in_cidr('2606:4701::1', '2606:4700::/32'));
// family mismatch is never a match, never an error
check('v4 addr vs v6 cidr -> false', !captive_ip_in_cidr('1.2.3.4', '2606:4700::/32'));
check('v6 addr vs v4 cidr -> false', !captive_ip_in_cidr('2606:4700::1', '1.2.3.0/24'));
// junk never throws, just false
check('garbage ip -> false', !captive_ip_in_cidr('not-an-ip', '1.2.3.0/24'));
check('cidr with no slash -> false', !captive_ip_in_cidr('1.2.3.4', '1.2.3.4'));

echo "\n==== CLOUDFLARE EDGE CHECK ====\n";
// a couple of addresses drawn from the published ranges embedded in lib/admin.php
check('104.16.0.1 is a Cloudflare edge (104.16.0.0/13)', captive_ip_is_cloudflare('104.16.0.1'));
check('172.68.1.1 is a Cloudflare edge (172.64.0.0/13)', captive_ip_is_cloudflare('172.68.1.1'));
check('2400:cb00::5 is a Cloudflare edge', captive_ip_is_cloudflare('2400:cb00::5'));
check('8.8.8.8 is NOT a Cloudflare edge', !captive_ip_is_cloudflare('8.8.8.8'));
check('192.168.1.1 is NOT a Cloudflare edge', !captive_ip_is_cloudflare('192.168.1.1'));

echo "\n==== SAME-NETWORK COMPARISON ====\n";
// IPv4: exact match only
check('identical v4 -> same network', captive_ip_same_network('81.2.3.4', '81.2.3.4'));
check('different v4 -> NOT same network', !captive_ip_same_network('81.2.3.4', '81.2.3.5'));
// IPv6: same /64 prefix even when the host portion differs (same LAN)
check('v6 same /64, different host -> same network',
    captive_ip_same_network('2a00:1450:4009:81f::1', '2a00:1450:4009:81f:abcd:ef01:2345:6789'));
check('v6 different /64 -> NOT same network',
    !captive_ip_same_network('2a00:1450:4009:81f::1', '2a00:1450:4009:820::1'));
check('v6 identical -> same network',
    captive_ip_same_network('2a00:1450:4009:81f::1', '2a00:1450:4009:81f::1'));
// mixed families are never the same network
check('v4 vs v6 -> NOT same network', !captive_ip_same_network('81.2.3.4', '2a00:1450:4009:81f::1'));
// junk never throws
check('garbage vs valid -> false', !captive_ip_same_network('nope', '81.2.3.4'));

echo "\n" . ($fail === 0 ? "ALL PASS ($pass)\n" : "$fail FAILED, $pass passed\n");
exit($fail === 0 ? 0 : 1);
