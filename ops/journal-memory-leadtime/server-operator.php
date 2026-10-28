<?php
declare(strict_types=1);
// Operator-only correction. This file is not an application runtime payload.
if (PHP_SAPI !== 'cli') throw new RuntimeException('CLI only');
require_once __DIR__ . '/php-validation-client.php';
function check(bool $ok,string $message):void {if(!$ok)throw new RuntimeException($message);}
$root='/home/dabblela/cy/';$stage=__DIR__;
$m=json_decode(file_get_contents($stage.'/manifest.json'),true,512,JSON_THROW_ON_ERROR);
check($m['candidate']==='09b77356130d79f443b53ff74fa42f4557e76407','Wrong candidate');
check($m['base']==='8363197d805e672ee59582ce0b1d0d88f14c3e48','Wrong base');
check(preg_match('/^[a-f0-9]{40}$/D',$m['merge'])===1,'Wrong merge');
$slug='journal-leadtime-'.substr($m['merge'],0,7);
$backup='/home/dabblela/cy-deploy-backups/'.$slug;
$probe='/run/cy-'.$slug;
$socket='/run/php/php8.5-fpm.sock';
$paths=['lib/journal_memory_preparation.php','lib/autobiographical_memory.php','public/api/memory.php','config/implementation-registry.json','docs/data-handling.json'];
check(array_column($m['serverFiles'],'path')===$paths,'Wrong server allowlist/order');
$mode=$argv[1]??'';check(in_array($mode,['before','install','post'],true),'Wrong mode');
foreach($m['serverUnchanged'] as $p=>$hash)check(hash_file('sha256',$root.$p)===$hash,'API drift: '.$p);
function verify_current_file(?string $expected,string $path):void {
 check($expected===null ? !file_exists($path) : (is_file($path) && hash_file('sha256',$path)===$expected),'File precondition: '.$path);
}
if($mode==='before'){
 foreach($m['serverFiles'] as $f)verify_current_file($f['oldSha256'],$root.$f['path']);
 check(!file_exists($backup),'Backup already exists');check(mkdir($backup,0700,true),'Backup mkdir');
 foreach($m['serverFiles'] as $f){
  if($f['oldSha256']===null)continue;
  $dest=$backup.'/'.$f['path'];check(is_dir(dirname($dest))||mkdir(dirname($dest),0700,true),'Backup parent');
  check(copy($root.$f['path'],$dest),'Backup copy');chmod($dest,0600);
  check(hash_file('sha256',$dest)===$f['oldSha256'],'Backup hash');
 }
 check(file_put_contents($backup.'/manifest.json',json_encode($m,JSON_THROW_ON_ERROR))!==false,'Backup manifest');
 chmod($backup.'/manifest.json',0600);
 check(!file_exists($probe),'Probe exists');check(mkdir($probe,0755),'Probe mkdir');
 check(copy($stage.'/probe.php',$probe.'/probe.php'),'Probe copy');chmod($probe.'/probe.php',0644);
 $plan=cy_php_validation_plan($m['serverFiles'],$stage,$root,[
  'lib/autobiographical_memory.php'=>['functions'=>['captive_journal_preparation_validate','captive_memory_claim_surfacing']],
 ]);
 check(file_put_contents($probe.'/validation-plan.json',json_encode($plan,JSON_THROW_ON_ERROR))!==false,'Probe plan');
 chmod($probe.'/validation-plan.json',0644);
 $receipts=cy_php_validate_staged($m['serverFiles'],$probe,$socket);
 echo json_encode(['at'=>gmdate('c'),'backup'=>$backup,'files'=>$paths,'fpm'=>$receipts]),PHP_EOL;
}elseif($mode==='install'){
 check(is_file($backup.'/manifest.json'),'Backup missing');
 $serving=[];
 foreach($m['serverFiles'] as $f){
  verify_current_file($f['oldSha256'],$root.$f['path']);
  if($f['oldSha256']!==null)check(hash_file('sha256',$backup.'/'.$f['path'])===$f['oldSha256'],'Backup drift');
  $payload=$stage.'/payload/'.$f['path'];check(hash_file('sha256',$payload)===$f['newSha256'],'Payload hash');
  if(str_ends_with($f['path'],'.json'))json_decode(file_get_contents($payload),true,512,JSON_THROW_ON_ERROR);
  else {exec(escapeshellarg(PHP_BINARY).' -l '.escapeshellarg($payload).' 2>&1',$output,$code);check($code===0,'PHP syntax');}
 }
 // All staged PHP is also compiled in serving FPM BEFORE the first rename.
 cy_php_validate_staged($m['serverFiles'],$probe,$socket);
 // Helper first, then compatible library, then API, then matching metadata.
 foreach($m['serverFiles'] as $i=>$f){
  $target=$root.$f['path'];$tmp=$target.'.'.$slug.'.tmp';check(!file_exists($tmp),'Temporary path occupied');
  check(copy($stage.'/payload/'.$f['path'],$tmp),'Stage copy');chmod($tmp,0644);
  check(hash_file('sha256',$tmp)===$f['newSha256'],'Staged hash');check(rename($tmp,$target),'Atomic file install');
  check(hash_file('sha256',$target)===$f['newSha256'],'Readback');
  if(str_ends_with($f['path'],'.php'))$serving[]=cy_php_validation_request($probe,'live-'.$i,$socket);
 }
 echo json_encode(['at'=>gmdate('c'),'files'=>$m['serverFiles'],'fpm'=>$serving]),PHP_EOL;
}else{
 foreach($m['serverFiles'] as $f)verify_current_file($f['newSha256'],$root.$f['path']);
 check(unlink($probe.'/probe.php'),'Probe cleanup');check(unlink($probe.'/validation-plan.json'),'Plan cleanup');check(rmdir($probe),'Probe directory cleanup');
 echo json_encode(['at'=>gmdate('c'),'files'=>$m['serverFiles'],'unchanged'=>$m['serverUnchanged']]),PHP_EOL;
}
