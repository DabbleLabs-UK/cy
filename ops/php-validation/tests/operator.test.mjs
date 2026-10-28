import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { packageValidationOperators } from '../../journal-memory-leadtime/package-validation.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const tools = resolve(here, '..');
const php = process.env.CY_TEST_PHP || 'C:/php84/php.exe';
const cgi = process.env.CY_TEST_PHP_CGI || php.replace(/php(?:\.exe)?$/, 'php-cgi.exe');
const extension = process.env.CY_TEST_OPCACHE || 'C:/php84/ext/php_opcache.dll';
const candidate = '09b77356130d79f443b53ff74fa42f4557e76407';
const fixtureRoot = realpathSync(tmpdir());
const tmp = mkdtempSync(join(fixtureRoot, 'cy-php-validation-'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const phpString = value => "'" + value.replaceAll('\\', '/').replaceAll("'", "\\'") + "'";
const flags = ['-n', '-d', 'zend_extension='+extension, '-d', 'opcache.enable=1',
  '-d', 'opcache.enable_cli=1', '-d', 'opcache.validate_timestamps=1',
  '-d', 'opcache.file_update_protection=0', '-d', 'display_errors=1', '-d', 'log_errors=0'];
const cli = (path, args=[], env={}) => spawnSync(php, [...flags, path, ...args],
  { encoding:'utf8', windowsHide:true, env:{...process.env,...env} });
let child, port, plan, stderr = '';
function params(input) {
  const chunks=[];
  const length=n=>n<128?Buffer.from([n]):(()=>{const b=Buffer.alloc(4);b.writeUInt32BE(n|0x80000000);return b;})();
  for(const [k,v] of Object.entries(input)){
    const key=Buffer.from(k),value=Buffer.from(String(v));chunks.push(length(key.length),length(value.length),key,value);
  }
  return Buffer.concat(chunks);
}
function frame(type, body=Buffer.alloc(0)) {
  const head=Buffer.alloc(8);head[0]=1;head[1]=type;head.writeUInt16BE(1,2);head.writeUInt16BE(body.length,4);
  return Buffer.concat([head,body]);
}
async function request(script, phase='preflight', extra={}) {
  return new Promise((resolveRequest,reject)=>{
    const socket=net.connect(port,'127.0.0.1');let buffer=Buffer.alloc(0),stdout='',errors='';
    const fail=error=>{socket.destroy();reject(error);};socket.setTimeout(10000,()=>fail(new Error('fixture FastCGI timeout')));
    socket.on('error',fail);
    socket.on('connect',()=>{
      const begin=Buffer.alloc(8);begin.writeUInt16BE(1);
      socket.write(Buffer.concat([frame(1,begin),frame(4,params({SCRIPT_FILENAME:script,
        SCRIPT_NAME:'/private-fixture',REQUEST_METHOD:'GET',SERVER_PROTOCOL:'HTTP/1.1',
        REDIRECT_STATUS:'200',CY_PHASE:phase,...extra})),frame(4),frame(5)]));
    });
    socket.on('data',data=>{
      buffer=Buffer.concat([buffer,data]);
      while(buffer.length>=8){
        const size=buffer.readUInt16BE(4),padding=buffer[6],type=buffer[1];
        if(buffer.length<8+size+padding)return;
        const body=buffer.subarray(8,8+size);buffer=buffer.subarray(8+size+padding);
        if(type===6)stdout+=body.toString();if(type===7)errors+=body.toString();
        if(type===3){socket.destroy();resolveRequest({stdout,errors,status:body.readUInt32BE(0)});return;}
      }
    });
  });
}
function verify(phase, response) {
  return cli(join(tmp,'verify.php'),[tmp,phase,Buffer.from(response.stdout).toString('base64')]);
}
async function checked(phase) {
  const response=await request(join(tmp,'probe.php'),phase);
  const result=verify(phase,response);
  assert.equal(result.status,0,result.stdout+result.stderr);
  return JSON.parse(result.stdout);
}
function add(name, source, entry={action:'load',functions:[]}) {
  const path=join(tmp,name+'.php');writeFileSync(path,source);
  plan.checks[name]={path,sha256:sha(readFileSync(path)),...entry};
  writeFileSync(join(tmp,'validation-plan.json'),JSON.stringify(plan));
  return path;
}
before(async()=>{
  assert.ok(existsSync(php)&&existsSync(cgi)&&existsSync(extension),'real PHP/FastCGI/OPcache required; no skip');
  for(const p of ['lib/autobiographical_memory.php','lib/journal_memory_preparation.php','lib/postcard_recollection.php','public/api/memory.php']){
    const target=join(tmp,p);mkdirSync(dirname(target),{recursive:true});
    writeFileSync(target,execFileSync('git',['show',candidate+':'+p],{cwd:repo}));
  }
  copyFileSync(join(tools,'probe.php'),join(tmp,'probe.php'));
  copyFileSync(join(here,'old-double-load.php'),join(tmp,'old.php'));
  writeFileSync(join(tmp,'verify.php'),`<?php require ${phpString(join(tools,'client.php'))};
echo json_encode(cy_php_validation_request($argv[1],$argv[2],'unused',fn()=>base64_decode($argv[3])),JSON_THROW_ON_ERROR);`);
  plan={schema:'cy.php-validation.v1',checks:{}};
  for(const [i,p] of ['lib/journal_memory_preparation.php','lib/autobiographical_memory.php','public/api/memory.php'].entries()){
    plan.checks['compile-'+i]={path:join(tmp,p),sha256:sha(readFileSync(join(tmp,p))),action:'compile'};
  }
  plan.checks.library={...plan.checks['compile-1'],action:'load',
    functions:['captive_journal_preparation_validate','captive_memory_claim_surfacing']};
  writeFileSync(join(tmp,'validation-plan.json'),JSON.stringify(plan));
  const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  port=server.address().port;await new Promise(r=>server.close(r));
  child=spawn(cgi,[...flags,'-b','127.0.0.1:'+port],{windowsHide:true,env:{...process.env,PHP_FCGI_MAX_REQUESTS:'0'}});
  child.stderr.on('data',data=>{stderr+=data;});
  for(let i=0;i<100;i++){
    assert.equal(child.exitCode,null,'fixture exited: '+stderr);
    try{await checked('preflight');return;}catch(error){if(i===99)throw error;await new Promise(r=>setTimeout(r,50));}
  }
});
after(async()=>{
  if(child&&child.exitCode===null){await new Promise(resolveExit=>{child.once('exit',resolveExit);child.kill();});}
  assert.ok(!child||child.exitCode!==null||child.signalCode!==null,'owned FastCGI fixture stopped');
  assert.equal(dirname(realpathSync(tmp)),fixtureRoot,'delete only the owned direct-child fixture directory');
  rmSync(tmp,{recursive:true,force:true});
  assert.equal(existsSync(tmp),false);
  console.log('Owned FastCGI PID '+child?.pid+' stopped; private fixtures removed.');
});

test('real CLI OPcache reproduces old compile then require fatal on exact candidate library',()=>{
  const old=cli(join(tmp,'old.php'),[join(tmp,'lib/autobiographical_memory.php')]);
  assert.notEqual(old.status,0);assert.match(old.stdout,/bool\(true\)[\s\S]*bool\(true\)/);
  assert.match(old.stdout+old.stderr,/Cannot redeclare.*captive_memory_is_journal_surfacing/i);
});
test('same old sequence also fails in a real persistent FastCGI worker',async()=>{
  const old=await request(join(tmp,'old.php'),'preflight',{OLD_LIBRARY:join(tmp,'lib/autobiographical_memory.php')});
  assert.match(old.stdout,/Cannot redeclare.*captive_memory_is_journal_surfacing/i);
});
test('preflight reports actual FastCGI PHP and enabled timestamp-validating OPcache',async()=>{
  const result=await checked('preflight');assert.match(result.php,/^8\./);
  assert.equal(result['opcache.enable'],'1');assert.equal(result['opcache.validate_timestamps'],'1');
});
test('all exact staged candidate PHP files compile in separate requests without executing API',async()=>{
  for(let i=0;i<3;i++){const result=await checked('compile-'+i);assert.equal(result.compiled,true);assert.equal(result.loaded,undefined);}
});
test('single library load verifies real required functions without explicit precompilation',async()=>{
  const result=await checked('library');assert.equal(result.loaded,true);assert.equal(result.compiled,undefined);
});
test('repeated fresh requests on the same FastCGI process never redeclare library symbols',async()=>{
  for(let i=0;i<4;i++){await checked('compile-1');await checked('library');}
  assert.equal(child.exitCode,null);
});
test('compile-only API with a sentinel side effect never runs that handler',async()=>{
  const marker=join(tmp,'must-not-exist');add('handler',`<?php file_put_contents(${phpString(marker)},'WRONG');`,{action:'compile'});
  await checked('handler');assert.equal(existsSync(marker),false);
});
test('invalid staged PHP syntax is rejected before any publish step',async()=>{
  add('syntax','<?php function broken( {',{action:'compile'});
  const response=await request(join(tmp,'probe.php'),'syntax');assert.notEqual(verify('syntax',response).status,0);
});
test('missing library dependency cannot produce a successful receipt',async()=>{
  add('missing-dependency',`<?php require_once ${phpString(join(tmp,'absent.php'))};`);
  const response=await request(join(tmp,'probe.php'),'missing-dependency');assert.notEqual(verify('missing-dependency',response).status,0);
});
test('load-time exception is detected, not confused with successful syntax compilation',async()=>{
  add('runtime-error',"<?php throw new RuntimeException('fixture failure');");
  const response=await request(join(tmp,'probe.php'),'runtime-error');assert.notEqual(verify('runtime-error',response).status,0);
});
test('missing required function fails closed',async()=>{
  add('missing-symbol','<?php function present_fixture() {}',{action:'load',functions:['missing_fixture']});
  const response=await request(join(tmp,'probe.php'),'missing-symbol');assert.notEqual(verify('missing-symbol',response).status,0);
});
test('ordinary require_once dependency graph and required classes remain supported',async()=>{
  const dep=add('dependency','<?php class FixtureDependency {}');
  add('graph',`<?php require_once ${phpString(dep)}; require_once ${phpString(dep)}; function fixture_available() {}`,
    {action:'load',functions:['fixture_available'],classes:['FixtureDependency']});
  assert.equal((await checked('graph')).loaded,true);
  plan.checks.graph.classes=['AbsentFixtureClass'];writeFileSync(join(tmp,'validation-plan.json'),JSON.stringify(plan));
  const response=await request(join(tmp,'probe.php'),'graph');assert.notEqual(verify('graph',response).status,0);
});
test('source hash mismatch fails before loading the library',async()=>{
  const marker=join(tmp,'wrong-hash-not-run');add('hash',`<?php file_put_contents(${phpString(marker)},'WRONG');`);
  plan.checks.hash.sha256='0'.repeat(64);writeFileSync(join(tmp,'validation-plan.json'),JSON.stringify(plan));
  const response=await request(join(tmp,'probe.php'),'hash');assert.notEqual(verify('hash',response).status,0);assert.equal(existsSync(marker),false);
});
test('unexpected library output and unknown phases fail instead of salvaging JSON',async()=>{
  add('output',"<?php echo 'debug';");
  for(const phase of ['output','absent']){const response=await request(join(tmp,'probe.php'),phase);assert.notEqual(verify(phase,response).status,0);}
});
test('strict client rejects failed, incomplete or mismatched receipts',()=>{
  const valid={ok:true,phase:'library',action:'load',loaded:true,sha256:plan.checks.library.sha256};
  const responses=[
    'Status: 500 Internal Server Error\r\n\r\n'+JSON.stringify(valid),
    'Content-Type: application/json\r\n\r\n'+JSON.stringify({...valid,phase:'other'}),
    'Content-Type: application/json\r\n\r\n'+JSON.stringify({...valid,sha256:'0'.repeat(64)}),
    'Content-Type: application/json\r\n\r\n'+JSON.stringify({...valid,loaded:false}),
    'Content-Type: application/json\r\n\r\n'+JSON.stringify({...valid,action:'compile'}),
    'Content-Type: application/json\r\n\r\nFatal error: nope',
    'Content-Type: application/json\r\n\r\n'+JSON.stringify(valid)+' trailing error',
  ];
  for(const stdout of responses)assert.notEqual(verify('library',{stdout}).status,0);
});
test('generic plan and staged driver preserve validation order and stop on failure',()=>{
  const fixture=join(tmp,'sequence.php');
  writeFileSync(fixture,`<?php require ${phpString(join(tools,'client.php'))};
$files=[['path'=>'lib/a.php','newSha256'=>str_repeat('a',64)],['path'=>'api/b.php','newSha256'=>str_repeat('b',64)]];
$plan=cy_php_validation_plan($files,'/stage','/root/',['lib/a.php'=>['functions'=>['a']]]);
file_put_contents($argv[1].'/validation-plan.json',json_encode($plan));$calls=[];
try {cy_php_validate_staged($files,$argv[1],'unused',function($phase)use(&$calls,$plan){
 $calls[]=$phase;if($phase==='staged-1')throw new RuntimeException('bad staged syntax');
 $result=['ok'=>true,'phase'=>$phase];if($phase!=='preflight')$result+=['action'=>'compile','compiled'=>true,'sha256'=>$plan['checks'][$phase]['sha256']];
 return "Content-Type: application/json\\r\\n\\r\\n".json_encode($result);
});throw new RuntimeException('failure swallowed');}catch(RuntimeException $e){echo json_encode(['calls'=>$calls,'error'=>$e->getMessage(),'plan'=>$plan]);}`);
  const separate=join(tmp,'sequence');mkdirSync(separate);const result=cli(fixture,[separate]);assert.equal(result.status,0,result.stderr);
  const value=JSON.parse(result.stdout);assert.deepEqual(value.calls,['preflight','staged-0','staged-1']);
  assert.equal(value.error,'bad staged syntax');assert.equal(value.plan.checks['live-0'].action,'load');assert.equal(value.plan.checks['live-1'].action,'compile');
});
test('actual wrapper validates all staged PHP before its first publication and has no double-load call',()=>{
  const source=readFileSync(join(repo,'ops/journal-memory-leadtime/server-operator.php'),'utf8');
  const install=source.slice(source.indexOf("}elseif($mode==='install')"));
  assert.ok(install.indexOf('cy_php_validate_staged(')<install.indexOf('rename($tmp,$target)'));
  assert.match(source,/cy_php_validation_request\(\$probe,'live-'\.\$i,\$socket\)/);
  assert.doesNotMatch(source,/opcache_compile_file|fpm_phase\(/);
  const probe=readFileSync(join(tools,'probe.php'),'utf8');
  assert.match(probe,/if \(\$entry\['action'\] === 'compile'\)[\s\S]*} else \{/);
  for(const p of ['probe.php','client.php'])assert.doesNotMatch(readFileSync(join(tools,p),'utf8'),/journal_memory|autobiographical|PDO|acquireSharedLease|rawGenerate/);
});
test('operator-only package members retain exact reviewed source bytes',()=>{
  const packageDir=join(tmp,'package');mkdirSync(packageDir);
  const members=[['probe.php',join(tools,'probe.php')],['php-validation-client.php',join(tools,'client.php')],
    ['server-operator.php',join(repo,'ops/journal-memory-leadtime/server-operator.php')]];
  const receipt=packageValidationOperators(packageDir);
  assert.deepEqual(receipt.map(m=>m.path),['server-operator.php','probe.php','php-validation-client.php']);
  for(const member of receipt)assert.equal(member.hash,sha(readFileSync(join(packageDir,member.path))));
  assert.throws(()=>packageValidationOperators(packageDir),/EEXIST/,'never overwrite a frozen package');
  const archive=join(tmp,'operator-only.tar');execFileSync('tar',['-cf',archive,'-C',packageDir,...members.map(m=>m[0])]);
  const listed=execFileSync('tar',['-tf',archive],{encoding:'utf8'}).trim().split(/\r?\n/);assert.deepEqual(listed,members.map(m=>m[0]));
  for(const [name,path]of members)assert.equal(sha(execFileSync('tar',['-xOf',archive,name])),sha(readFileSync(path)));
});
