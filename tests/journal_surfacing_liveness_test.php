<?php
declare(strict_types=1);
require __DIR__ . '/../lib/autobiographical_memory.php';
$checks = [];
$checks['explicit no-sender journal'] = captive_memory_is_journal_surfacing(['context'=>['generationRef'=>'journal:123']]);
foreach (['postcard:123', 'other:123', 'journal:abc', 'JOURNAL:123', "journal:123\n", ''] as $ref) {
    $checks['not journal ' . json_encode($ref)] = !captive_memory_is_journal_surfacing(['context'=>['generationRef'=>$ref]]);
}
$checks['persisted payload recognized'] = captive_memory_is_journal_surfacing(['context_payload'=>'{"generationRef":"journal:123"}']);
$checks['unknown payload preserved'] = !captive_memory_is_journal_surfacing(['context_payload'=>'{}']);
$checks['sender scope preserved'] = !captive_memory_is_journal_surfacing(['subject_visitor_id'=>str_repeat('a',32),'context'=>['generationRef'=>'journal:123']]);
class NoQueryPDO extends PDO {
    public function __construct() {}
    public function beginTransaction(): bool { throw new LogicException('must reject before transaction'); }
}
foreach (['', 'bad', 123, [], strtoupper(str_repeat('a',64))] as $i=>$value) {
    try { captive_memory_claim_surfacing(new NoQueryPDO(), ['journal_context_fingerprint'=>$value]); $checks['reject malformed authority '.$i]=false; }
    catch (InvalidArgumentException) { $checks['reject malformed authority '.$i]=true; }
}
foreach ($checks as $label=>$ok) if (!$ok) { fwrite(STDERR,'FAIL: '.$label.PHP_EOL);exit(1); }
echo 'journal_surfacing_liveness_test.php: '.count($checks)." checks passed\n";
