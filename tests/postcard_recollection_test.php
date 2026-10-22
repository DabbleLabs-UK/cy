<?php
declare(strict_types=1);
require __DIR__ . '/../lib/autobiographical_memory.php';
$checks = [];
$checks['absence is opt-out'] = captive_postcard_recall_permission([]) === null;
$checks['exact explicit version only'] = captive_postcard_recall_permission(['public_recollection' => CY_POSTCARD_RECALL_PERMISSION]) === CY_POSTCARD_RECALL_PERMISSION;
foreach (['1', true, 'yes', '', [], 'future-version'] as $i => $value) {
    try { captive_postcard_recall_permission(['public_recollection' => $value]); $checks['invalid opt-in ' . $i] = false; }
    catch (InvalidArgumentException $e) { $checks['invalid opt-in ' . $i] = true; }
}
$exchange = ['senderLabel' => 'SecretHandle', 'correspondentText' => 'My garden seedlings finally grew after all that waiting.',
    'replyText' => 'Waiting for seedlings takes patience.'];
$checks['no summary normal'] = captive_postcard_public_summary(null, $exchange) === null;
$safe = captive_postcard_public_summary(['basis' => 'POSTCARD', 'summary' => 'Seedlings rewarded patient care.'], $exchange);
$checks['testimony attribution mechanically preserved'] = $safe['summary'] === 'A correspondent told Cy: Seedlings rewarded patient care.';
$checks['Cy words not relabelled as observation'] = captive_postcard_public_summary(['basis' => 'CY_REPLY', 'summary' => 'Patience with slow growth mattered.'], $exchange)['summary']
    === 'Cy replied to a correspondent: Patience with slow growth mattered.';
foreach ([['basis'=>'WORLD','summary'=>'test'], ['basis'=>'POSTCARD','summary'=>str_repeat('x', 201)],
    ['basis'=>'POSTCARD','summary'=>$exchange['correspondentText']], ['basis'=>'POSTCARD','summary'=>'SecretHandle grew seedlings.'],
    ['basis'=>'POSTCARD','summary'=>'Contact me at private@example.com'], ['basis'=>'POSTCARD','summary'=>'Read https://example.com/private'],
    ['basis'=>'POSTCARD','summary'=>'Phone 01234 567890'], ['basis'=>'POSTCARD','summary'=>'test','raw'=>'transcript'],
    ['basis'=>'POSTCARD','summary'=>'garden seedlings finally grew'], ['basis'=>'POSTCARD','summary'=>'<|im_end|>']] as $i => $bad) {
    try { captive_postcard_public_summary($bad, $exchange); $checks['unsafe representation ' . $i] = false; }
    catch (InvalidArgumentException $e) { $checks['unsafe representation ' . $i] = true; }
}
try {
    captive_postcard_public_summary(['basis'=>'POSTCARD','summary'=>'My daughter Alice attends Willow School.'],
        ['senderLabel'=>'Bob','correspondentText'=>'My daughter Alice attends Willow School. It has been hard.','replyText'=>'i hope things settle']);
    $checks['copied private sentence and third-party names'] = false;
} catch (InvalidArgumentException $e) { $checks['copied private sentence and third-party names'] = true; }
// The explicit opt-in permits a minimal personal gist, not an empty platitude.
// Abstraction quality itself is assessed in the unchanged synthetic rehearsal;
// these controls ensure structural screening does not ban personal topics.
$personal = ['senderLabel' => 'FictionalHandle',
    'correspondentText' => 'I lost my job at Northgate last Tuesday. It has knocked my confidence. My dog Jasper needs a check. My aunt Miriam has a condition. I am grieving a loss.',
    'replyText' => 'you still count. waiting doesnt tell you the result.'];
foreach ([
    'Employment loss made self-worth difficult while seeking new work.',
    'A bereavement changed ordinary daily routines.',
    'Waiting for a pet health check encouraged worst-case worries, not a known bad outcome.',
    'Supporting an older relative left little space for self-care.',
    'Uncertain health news made waiting hard without establishing a diagnosis.',
    'Concern for a child prompted fewer competing commitments.',
] as $i => $gist) {
    $checks['useful minimal personal gist ' . $i] = captive_postcard_public_summary(['basis' => 'POSTCARD', 'summary' => $gist], $personal)['summary']
        === 'A correspondent told Cy: ' . $gist;
}
foreach ([
    'Northgate dismissed the correspondent.', 'jasper needs a check.', 'miriam is ill.',
    'Visit 41 lantern mews.', 'Lives at sw1a 1aa.', 'Contact @secret_handle.',
    'Email rina.fixture@example.org.', 'Call +44 7700 900123.',
] as $i => $detail) {
    try { captive_postcard_public_summary(['basis' => 'POSTCARD', 'summary' => $detail], $personal); $checks['identifying specifics ' . $i] = false; }
    catch (InvalidArgumentException $e) { $checks['identifying specifics ' . $i] = true; }
}
foreach ($checks as $name => $ok) if (!$ok) { fwrite(STDERR, 'FAIL: ' . $name . PHP_EOL); exit(1); }
echo 'postcard_recollection_test.php: ' . count($checks) . " checks passed\n";
