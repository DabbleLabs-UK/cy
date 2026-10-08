// Real endpoints against an opt-in disposable DB; no provider/network inference.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('sender formation isolated budgets, replay receipts, privacy and canonical completion', {
  skip: process.env.CY_TEST_DB_ISOLATED !== '1',
}, async () => {
  const database = `cy_memory_cloud_${randomBytes(6).toString('hex')}`;
  const sql = (query, db = database) => {
    const result = spawnSync(process.env.CY_TEST_MARIADB_BIN, [
      `--defaults-file=${process.env.CY_TEST_DB_DEFAULTS}`, '-h','127.0.0.1','-P',process.env.CY_TEST_DB_PORT,
      '-u','root','--batch','--skip-column-names','--raw',...(db ? [db] : []),
    ], { input:query,encoding:'utf8',timeout:30000,windowsHide:true });
    assert.equal(result.status,0,result.stderr);
    return result.stdout.trim();
  };
  const web = await mkdtemp(join(tmpdir(),'cy-memory-cloud-'));
  let server;
  try {
    sql(`CREATE DATABASE ${database}`,null);
    sql(await readFile(join(root,'sql/schema.sql'),'utf8'));
    const migration = await readFile(join(root,'sql/029_memory_formation_inference.sql'),'utf8');
    sql(migration); sql(migration);
    await cp(join(root,'lib'),join(web,'lib'),{recursive:true});
    await cp(join(root,'public/api'),join(web,'public/api'),{recursive:true});
    await cp(join(root,'config'),join(web,'config'),{recursive:true});
    await writeFile(join(web,'config/config.php'),`<?php return [
      'db'=>['host'=>'127.0.0.1;port=${process.env.CY_TEST_DB_PORT}','name'=>'${database}','user'=>'root','pass'=>'','charset'=>'utf8mb4'],
      'ingest_key'=>'test-key','cookie_secret'=>'test-cookie'];`);
    const listener = createServer();
    await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
    const port = listener.address().port;
    await new Promise(resolve=>listener.close(resolve));
    server = spawn(process.env.CY_TEST_PHP_BIN,['-d','extension=pdo_mysql','-S',`127.0.0.1:${port}`,'-t',join(web,'public')],
      {cwd:web,stdio:['ignore','ignore','pipe'],windowsHide:true});
    let errors = '';
    server.stderr.on('data',data=>{ errors += data; });
    const base = `http://127.0.0.1:${port}`;
    const endpoint = `${base}/api/memory-formation-inference.php`;
    for (let i=0;i<50;i++) {
      try { await fetch(endpoint); break; } catch { await new Promise(resolve=>setTimeout(resolve,100)); }
    }
    const post = async (path,body,expected=200,headers={}) => {
      const response = await fetch(`${base}/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json','X-Cy-Key':'test-key',...headers},body:JSON.stringify(body)});
      const data = await response.json();
      assert.equal(response.status,expected,JSON.stringify(data)+errors.slice(-1000));
      return data;
    };
    const api = (action,body={},expected=200)=>post('memory-formation-inference.php',{action,...body},expected);
    const memory = (action,body={},expected=200)=>post('memory.php',{action,...body},expected);
    const sender = 'a'.repeat(32);
    const source = id=>({sourceType:'POSTCARD',sourceId:id,subjectVisitorId:sender,sourceVisibility:'SENDER_RECALLABLE',text:'PRIVATE synthetic dog fact',tags:['postcard']});
    const newJob = async (id,type='POSTCARD') => {
      const value = {...source(id),sourceType:type};
      await memory('enqueue_source',{source:value});
      const job = (await memory('claim_source',{sender_only:true,visitor_id:sender})).job;
      assert.ok(job);
      return {...job,source:value};
    };
    const reserve = (job,more={})=>api('reserve',{job_id:Number(job.id),claim_token:job.claim_token,input_tokens:2000,max_output_tokens:260,
      cloud_available:true,configured_model:'deepseek-v4-flash',local_model:'local-fixture',...more});
    const settle = (job,request,more={})=>api('settle',{job_id:Number(job.id),claim_token:job.claim_token,request_id:request.request_id,
      actual_model:'deepseek-v4-flash-actual',status:'generated',reason:'generated',latency_ms:1200,...more});
    const finish = async (job,request,category,operations=[],extra={},expected=200)=>{
      const result = await memory('finish_source',{
        job_id:Number(job.id),claim_token:job.claim_token,result_category:category,operations,
        formation_request_id:request.request_id,...extra,
      },expected);
      // Keep old synthetic retries from competing with the next explicit case.
      if (result.status==='RETRYABLE') sql(`UPDATE autobiographical_memory_formation_queue SET available_at=NOW()+INTERVAL 1 DAY WHERE id=${Number(job.id)}`);
      return result;
    };
    const view = async range=>(await fetch(`${endpoint}?range=${range}`)).json();
    const settings = await view('24H');
    assert.equal(settings.settings.mode,'DEEPSEEK');
    assert.equal(settings.can_admin,false);
    await post('memory-formation-inference.php?111',{action:'settings',settings:{mode:'OFF'}},403,{Origin:base});
    await post('memory-formation-inference.php',{action:'reserve'},401,{'X-Cy-Key':'wrong'});

    // Create two active claims and race admissions through the real serialized endpoint.
    const first = await newJob('first');
    const second = await newJob('second','CY_REPLY');
    const [one,two] = await Promise.all([reserve(first),reserve(second)]);
    const admitted = one.execute ? {job:first,request:one} : {job:second,request:two};
    const held = one.execute ? {job:second,request:two} : {job:first,request:one};
    assert.equal(Number(one.execute)+Number(two.execute),1);
    assert.equal(held.request.reason,'concurrency_full');
    assert.equal((await reserve(admitted.job)).execute,false,'lost reservation response cannot authorize another paid call');
    assert.equal((await reserve(admitted.job)).request_id,admitted.request.request_id);
    assert.equal((await view('24H')).windows.hour.requests,1);
    assert.equal(sql(`SELECT ABS(TIMESTAMPDIFF(SECOND,created_at,UTC_TIMESTAMP()))<5 FROM memory_formation_inference_attempts WHERE request_id='${admitted.request.request_id}'`),'1',
      'reservation timestamps share the UTC clock used for caps and concurrency');
    await finish(held.job,held.request,'INVALID',[],{},422);
    const holdCompletion = await finish(held.job,held.request,'ERROR');
    assert.equal(holdCompletion.model_invalid_streak,0,'held work consumes no decision budget');
    assert.equal(holdCompletion.status,'RETRYABLE');
    await api('settle',{job_id:Number(admitted.job.id),claim_token:admitted.job.claim_token,request_id:admitted.request.request_id,
      status:'failed',reason:'PRIVATE raw provider body',latency_ms:1},422);
    await settle(admitted.job,admitted.request,{usage:{prompt_tokens:1000,completion_tokens:100,cached_tokens:500}});
    const firstCost = sql(`SELECT actual_gbp FROM memory_formation_inference_attempts WHERE request_id='${admitted.request.request_id}'`);
    assert.equal((await settle(admitted.job,admitted.request,{usage:{prompt_tokens:0,completion_tokens:0,cached_tokens:0}})).duplicate,true);
    assert.equal(sql(`SELECT actual_gbp FROM memory_formation_inference_attempts WHERE request_id='${admitted.request.request_id}'`),firstCost);
    const op = {decision:'CREATE',memoryId:randomUUID(),type:'PERSON',privacyScope:'SENDER_RECALLABLE',content:'The visitor has a dog called Alfie.',source:admitted.job.source};
    await finish(admitted.job,admitted.request,'CREATE',[{...op,privacyScope:'PUBLIC_RECALLABLE',publicSummary:'PRIVATE leak'}],{},422);
    assert.equal(sql(`SELECT COUNT(*) FROM autobiographical_memories WHERE id='${op.memoryId}'`),'0');
    assert.equal(sql(`SELECT completed_at IS NULL FROM memory_formation_inference_attempts WHERE request_id='${admitted.request.request_id}'`),'1');
    const completed = await finish(admitted.job,admitted.request,'CREATE',[op]);
    assert.equal(completed.formation_request_id,admitted.request.request_id);
    assert.equal((await finish(admitted.job,admitted.request,'CREATE',[op])).duplicate,true);
    assert.equal(sql(`SELECT COUNT(*) FROM autobiographical_memory_activity WHERE memory_id='${op.memoryId}'`),'1');
    assert.equal(sql(`SELECT CONCAT(decision,':',application_outcome) FROM memory_formation_inference_attempts WHERE request_id='${admitted.request.request_id}'`),'CREATE:PROCESSED');

    // Unknown provider usage retains the entire reservation, even on failure.
    const uncertain = await newJob('uncertain');
    const unknown = await reserve(uncertain);
    await settle(uncertain,unknown,{status:'failed',reason:'timeout',usage:null,actual_model:null});
    assert.equal(sql(`SELECT actual_gbp IS NULL FROM memory_formation_inference_attempts WHERE request_id='${unknown.request_id}'`),'1');
    await finish(uncertain,unknown,'TIMEOUT');
    assert.ok((await view('24H')).totals.uncertain_gbp>0);

    // Network ownership + same-origin are both required for paid settings.
    sql("INSERT INTO ingest_origin (id,ip,seen_at) VALUES (1,'127.0.0.1',NOW()) ON DUPLICATE KEY UPDATE ip=VALUES(ip),seen_at=VALUES(seen_at)");
    const change = values=>post('memory-formation-inference.php',{action:'settings',settings:values},200,{Origin:base});
    await post('memory-formation-inference.php',{action:'settings',settings:{mode:'OFF'}},403,{Origin:'https://elsewhere.invalid'});
    for (const [mode,more,reason,provider] of [
      ['OFF',{},'disabled',null],['DEEPSEEK',{cloud_available:false},'credentials_missing',null],
      ['DEEPSEEK',{configured_model:'other'},'model_mismatch',null],['LOCAL',{},'local_selected','ollama'],
    ]) {
      await change({mode});
      const job = await newJob(`mode-${mode}-${reason}`);
      const request = await reserve(job,more);
      assert.equal(request.provider,provider);
      assert.equal(request.reason,reason);
      assert.equal(request.execute,provider!==null);
      if (provider) {
        await settle(job,request,{actual_model:'local-fixture',status:'failed',reason:'local_busy',usage:null});
        const result = await finish(job,request,'ERROR');
        assert.equal(result.model_invalid_streak,0,'local pacing remains an operational hold');
        assert.equal(sql(`SELECT actual_gbp FROM memory_formation_inference_attempts WHERE request_id='${request.request_id}'`),'0.0000000000');
      }
      else await finish(job,request,'ERROR');
    }
    assert.equal((await view('24H')).windows.hour.requests,2,'holds and explicit local work do not consume paid quota');
    const localJob = await newJob('local-success');
    const localRequest = await reserve(localJob);
    assert.equal(localRequest.provider,'ollama');
    await settle(localJob,localRequest,{actual_model:'local-fixture',usage:null});
    await finish(localJob,localRequest,'NOTHING');
    assert.equal(sql("SELECT COUNT(*) FROM postcard_inference_attempts"),'0','reply budget remains independent');
    const defaults = settings.settings;
    for (const unit of ['hour','day','month']) {
      await change({...defaults,[`requests_${unit}`]:1});
      let job = await newJob(`request-cap-${unit}`);
      let request = await reserve(job);
      assert.equal(request.reason,`${unit}_request_cap`);
      await finish(job,request,'ERROR');
      await change({...defaults,[`gbp_${unit}`]:0});
      job = await newJob(`spend-cap-${unit}`);
      request = await reserve(job);
      assert.equal(request.reason,`${unit}_spend_cap`);
      await finish(job,request,'ERROR');
    }
    await change(defaults);

    // Non-correspondence/private-unlinked legacy sources never enter this route.
    const generic = {...source('generic'),sourceType:'CY_EXPRESSION',subjectVisitorId:null,sourceVisibility:'INTERNAL_ONLY'};
    await memory('enqueue_source',{source:generic});
    const genericJob = (await memory('claim_source',{})).job;
    assert.equal(genericJob.source_type,'CY_EXPRESSION');
    assert.equal((await reserve(genericJob)).reason,'claim_not_active');
    await memory('finish_source',{job_id:Number(genericJob.id),claim_token:genericJob.claim_token,result_category:'NOTHING',operations:[]});

    // Expired concurrency never refunds uncertain cost or re-executes a claim.
    const expiring = await newJob('expiring');
    const expires = await reserve(expiring);
    sql(`UPDATE memory_formation_inference_attempts SET created_at=UTC_TIMESTAMP()-INTERVAL 31 MINUTE WHERE request_id='${expires.request_id}'`);
    const after = await newJob('after-expiry');
    const next = await reserve(after);
    assert.equal(next.execute,true);
    assert.equal((await reserve(expiring)).execute,false);
    assert.equal((await view('24H')).windows.hour.requests,4);
    await settle(after,next,{usage:{prompt_tokens:100,completion_tokens:40,cached_tokens:0}});
    await finish(after,next,'INVALID',[],{rejection_code:'SCHEMA'});
    assert.equal(sql(`SELECT rejection_code FROM memory_formation_inference_attempts WHERE request_id='${next.request_id}'`),'SCHEMA');
    await api('settle',{request_id:next.request_id,job_id:Number(expiring.id),claim_token:expiring.claim_token,status:'failed',reason:'provider_error',latency_ms:1},422);
    const beforeMigration = sql('SELECT request_id,decision,application_outcome FROM memory_formation_inference_attempts ORDER BY request_id');
    sql(migration);
    assert.equal(sql('SELECT request_id,decision,application_outcome FROM memory_formation_inference_attempts ORDER BY request_id'),beforeMigration);
    for (const range of ['1H','24H','30D','ALL']) {
      const publicView = await view(range);
      assert.equal(publicView.range,range);
      assert.equal(publicView.totals.formed,1);
      assert.equal(publicView.totals.nothing,1);
      assert.equal(publicView.totals.invalid,1);
      assert.equal(publicView.status.actual_model,'deepseek-v4-flash-actual');
      assert.ok(publicView.buckets.length<=121);
      assert.ok(publicView.pending_count>0);
      assert.doesNotMatch(JSON.stringify(publicView),/PRIVATE|Alfie|claim_token|request_id|source_payload|subject_visitor|aaaaaaaa/);
    }
    assert.equal(sql('SELECT COUNT(*) FROM memory_formation_inference_settings_audit')!=='0',true);
  } finally {
    if (server && server.exitCode===null) { const exit=new Promise(resolve=>server.once('exit',resolve)); server.kill(); await exit; }
    sql(`DROP DATABASE IF EXISTS ${database}`,null);
    await rm(web,{recursive:true,force:true});
  }
});
