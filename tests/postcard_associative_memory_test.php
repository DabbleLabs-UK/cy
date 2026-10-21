<?php
declare(strict_types=1);
require __DIR__ . '/../lib/postcard_associative_memory.php';
$sender = str_repeat('a', 32); $other = str_repeat('b', 32);
$row = ['id'=>'1','memory_type'=>'EPISODIC','status'=>'ACTIVE','privacy_scope'=>'PUBLIC_RECALLABLE',
    'subject_visitor_id'=>$other,'origin_kind'=>'POSTCARD','consistency_status'=>'UNCERTAIN',
    'content'=>'SECRET ORIGINAL','public_summary'=>'A correspondent described their garden and seedlings.',
    'tags'=>'garden,postcard','source_count'=>1,'version'=>1];
$source = ['source_type'=>'POSTCARD','source_id'=>'postcard:1','source_timestamp'=>'2026-10-01',
    'source_visibility'=>'SENDER_RECALLABLE'];
$sources = ['1'=>[$source]];
$query = ['text'=>'how are the garden seedlings?'];
$rank = static fn(array $rows, array $q = []) => captive_associative_rank($rows, $sources, $q ?: $query, $sender);
$checks = [];
$ranked = $rank([$row]); $selected = captive_associative_select($ranked, $sources);
$checks['explicit public safe summary alone reaches reply'] = count($selected)===1
    && $selected[0]['content']===$row['public_summary'] && !str_contains(json_encode($selected), 'SECRET ORIGINAL');
$checks['private source does not become public; approved recollection is separate'] = $selected[0]['privacyScope']==='PUBLIC_RECALLABLE'
    && $source['source_visibility']==='SENDER_RECALLABLE';
$checks['summary absent never falls back to private content'] = !$rank([array_replace($row,['public_summary'=>null])]);
$checks['sender-only excluded even with a public-looking summary'] = !$rank([array_replace($row,['privacy_scope'=>'SENDER_RECALLABLE'])]);
$checks['public source/anonymous wording cannot grant permission'] = !$rank([array_replace($row,['privacy_scope'=>'INTERNAL_ONLY','subject_visitor_id'=>null])]);
$checks['private words and tags cannot make an unrelated summary relevant'] = !$rank([$row], ['text'=>'secret original']);
$checks['no topic match'] = !$rank([$row], ['text'=>'exercise missed']);
$checks['social greeting yields no candidates'] = !$rank([$row], ['text'=>'hello how are you']);
$checks['long summary is omitted, not cut before its qualification'] = !$rank([array_replace($row,['public_summary'=>str_repeat('garden ',40)])]);
$checks['same sender not repeated in the separate lane'] = !$rank([array_replace($row,['subject_visitor_id'=>$sender])]);
$checks['archived excluded'] = !$rank([array_replace($row,['status'=>'ARCHIVED'])]);
$checks['unlinked source excluded'] = !captive_associative_rank([$row], [], $query, $sender);
$checks['partial source list excluded'] = !$rank([array_replace($row,['source_count'=>2])]);
$checks['unknown origin excluded'] = !$rank([array_replace($row,['origin_kind'=>'UNKNOWN'])]);
$checks['protected IDs excluded'] = !captive_associative_rank([$row], $sources, $query, $sender, ['1']);
$own = array_replace($row,['privacy_scope'=>'INTERNAL_ONLY','subject_visitor_id'=>null,'origin_kind'=>'ENVIRONMENT_EVENT',
    'content'=>'Cy saw seedlings in the garden.']);
$ownSources = ['1'=>[array_replace($source,['source_type'=>'ENVIRONMENT_EVENT','source_id'=>'env-1','source_visibility'=>'INTERNAL_ONLY'])]];
$checks['own prison experience eligible with its source'] = count(captive_associative_rank([$own], $ownSources, $query, $sender))===1;
$checks['mis-keyed private correspondence cannot masquerade as own experience'] = !captive_associative_rank([$own], $sources, $query, $sender);
$legacySources = ['1'=>[array_replace($ownSources['1'][0],['source_event_type'=>'postcard'])]];
$checks['legacy unlinked environment copy of postcard cannot bypass privacy'] = !captive_associative_rank([$own], $legacySources, $query, $sender);
$checks['mixed correspondence origin is not relabelled as experienced fact'] = !captive_associative_rank([array_replace($own,['privacy_scope'=>'PUBLIC_RECALLABLE'])], $legacySources, $query, $sender);
$new = array_replace($row,['id'=>'2','public_summary'=>'A visitor described seedlings.']);
$bothSources = $sources + ['2'=>[array_replace($source,['source_id'=>'postcard:2','source_timestamp'=>'2026-10-22'])]];
$both = captive_associative_rank([$new,$row], $bothSources, $query, $sender);
$checks['concrete relevance beats recency'] = $both[0]['id']==='1';
$reply = array_replace($row,['id'=>'3','origin_kind'=>'CY_REPLY']);
$bothSources['3'] = [array_replace($source,['source_type'=>'CY_REPLY','source_id'=>'postcard-reply:1'])];
$both = captive_associative_rank([$row,$reply,$new], $bothSources, $query, $sender);
$checks['postcard and its reply occupy one exchange slot'] = array_column(captive_associative_select($both,$bothSources),'id')===['1','2'];
$bridge = [['id'=>'A','_keys'=>['one','two']],['id'=>'B','_keys'=>['two','three']],['id'=>'C','_keys'=>['three']]];
foreach($bridge as &$b){$b=array_replace($row,$b,['_content'=>$row['public_summary']]);$bothSources[$b['id']]=[$source];} unset($b);
$checks['transitive provenance groups deduplicate before slots are chosen'] = count(captive_associative_select($bridge,$bothSources))===1;
$keys = captive_associative_source_keys(['source_type'=>'ENVIRONMENT_EVENT','source_id'=>'env-2','social_episode'=>'postcard:1']);
$checks['world correspondence episode joins the same exchange'] = in_array('exchange:1',$keys,true);
$checks['search stage records group by actual episode'] = in_array('episode:search-1',captive_associative_source_keys([
    'source_type'=>'ENVIRONMENT_EVENT','source_id'=>'env-3','search_episode'=>'search-1']),true);
$failed=0;foreach($checks as $label=>$ok){echo ($ok?'ok ':'FAIL ').$label."\n";if(!$ok)$failed++;}
echo count($checks).' checks, '.$failed." failures\n";exit($failed?1:0);
