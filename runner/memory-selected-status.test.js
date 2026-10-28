import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as memoryModule from './autobiographical-memory.js';
import { AutobiographicalMemoryRuntime, memoryContextFingerprint } from './memory-runtime.js';
import { journalFromWorking } from './fixtures/memory-status-journal.mjs';
import { beforeJournalTerminationTelemetry } from './fixtures/journal-termination-source.mjs';
import { assertUnchangedMemoryBoundaries } from './fixtures/journal-memory-leadtime-source.mjs';

const BASE='a8d4d0ea0cbbb35f399536bed8f1fb2cfbe3ad51';
const original=path=>execFileSync('git',['show',`${BASE}:${path}`],{encoding:'utf8'}).replace(/\r\n/g,'\n');
const oldSource=original('runner/autobiographical-memory.js');
const oldModule=await import('data:text/javascript;base64,'+Buffer.from(oldSource.replace("from './warden.js'",
  `from '${new URL('./warden.js',import.meta.url).href}'`)).toString('base64'));
const candidate={id:'00000000-0000-4000-8000-000000000001',type:'EPISODIC',status:'ACTIVE',
  privacyScope:'INTERNAL_ONLY',subjectVisitorId:null,content:'Cy remembers walking in the exercise yard.',
  consistencyStatus:'UNCERTAIN',originKind:'ENVIRONMENT_EVENT',tags:['yard'],reasons:['CURRENT_EVENT']};
const context={text:'yard',location:'cell',generationRef:'journal:1000'};
const set=selected=>({id:'set-offline',context_fingerprint:memoryContextFingerprint(context),selected_memories:selected});
function fixture({candidates=[candidate],output='{"memoryRefs":["C1"]}',complete=null}={}) {
  const calls={completed:[],query:0,model:0,consumed:[]};
  const client={
    async getPreparedMemorySet(){return{prepared_set:null};},async enqueueMemorySurfacing(){},
    async queryMemories(){calls.query++;return{candidates:structuredClone(candidates)};},
    async completeMemorySurfacing(value){calls.completed.push(structuredClone(value));return complete||{status:value.result_category};},
    async recordMemoryQuery(){},async consumePreparedMemorySet(value){calls.consumed.push(value);},
  };
  const runtime=new AutobiographicalMemoryRuntime({client,makeId:()=> 'set-offline',
    generate:async()=>{calls.model++;return output;}});
  return{runtime,calls,client};
}

test('status repair and protected privacy/formation boundaries remain intact after approved preparation wiring',()=>{
  const current=readFileSync(new URL('./autobiographical-memory.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
  assert.equal(current.replace('        status: memory.status, // Preserve eligibility metadata for later re-filtering.\n',''),oldSource);
  for(const path of ['runner/client.js','runner/run.js','runner/prompt.js',
    'runner/postcard-memory.js','runner/postcard-associative-memory.js']) {
    assert.equal(beforeJournalTerminationTelemetry(readFileSync(new URL('../'+path,import.meta.url),'utf8').replace(/\r\n/g,'\n')),original(path),path);
  }
  assertUnchangedMemoryBoundaries(path=>readFileSync(new URL('../'+path,import.meta.url),'utf8').replace(/\r\n/g,'\n'),original);
});

test('old projected selection reproduces empty activation; preserving status fixes it without a default',()=>{
  const old=oldModule.filterMemoriesBeforePrompt([candidate]);
  const projected=memoryModule.filterMemoriesBeforePrompt([candidate]);
  assert.equal(Object.hasOwn(old[0],'status'),false);
  assert.equal(projected[0].status,candidate.status);
  const{status,...rest}=projected[0];assert.deepEqual(rest,old[0]);
  const{runtime}=fixture();runtime.activatePrepared(set(old),context);
  assert.deepEqual(runtime.working.selected,[]);
  runtime.activatePrepared(set(JSON.parse(JSON.stringify(projected))),context);
  assert.equal(runtime.working.selected.length,1);
  assert.equal(runtime.working.selected[0].status,'ACTIVE');
  assert.deepEqual(memoryModule.filterMemoriesBeforePrompt(projected),projected,'projection is idempotent');
});

for(const status of ['ARCHIVED','DELETED','SUPERSEDED','INACTIVE','UNKNOWN','active','',null,undefined]) {
  test(`non-ACTIVE/missing status stays rejected: ${String(status)}`,()=>{
    const input={...candidate,status};
    if(status===undefined)delete input.status;
    assert.deepEqual(memoryModule.filterMemoriesBeforePrompt([input]),[]);
    const{runtime}=fixture();runtime.activatePrepared(set([input]),context);
    assert.deepEqual(runtime.working.selected,[]);
    assert.equal(runtime.working.directive,'');
  });
}

test('same-sender privacy and cross-sender public-summary abstraction are unchanged',()=>{
  const sender='a'.repeat(32),other='b'.repeat(32);
  const privateRecord={...candidate,privacyScope:'SENDER_RECALLABLE',subjectVisitorId:sender};
  for(const visitor of [null,other])assert.deepEqual(memoryModule.filterMemoriesBeforePrompt([privateRecord],{currentVisitorId:visitor}),[]);
  assert.equal(memoryModule.filterMemoriesBeforePrompt([privateRecord],{currentVisitorId:sender})[0].status,'ACTIVE');
  const publicRecord={...candidate,privacyScope:'PUBLIC_RECALLABLE',subjectVisitorId:sender,
    content:'private original',publicSummary:'Someone told Cy about waiting for news.',originKind:'POSTCARD'};
  const [safe]=memoryModule.filterMemoriesBeforePrompt([publicRecord],{currentVisitorId:other});
  assert.equal(safe.content,publicRecord.publicSummary);
  assert.equal(safe.status,'ACTIVE');
  assert.deepEqual(memoryModule.filterMemoriesBeforePrompt([{...candidate,privacyScope:'PRIVATE_UNKNOWN'}]),[]);
});

test('formation/selection model requests stay byte-identical; status is not model-facing',()=>{
  const source={sourceType:'ENVIRONMENT_EVENT',sourceId:'fixture',text:'Cy walked in the yard.',sourceVisibility:'INTERNAL_ONLY'};
  for(const sourceValue of [source,{...source,sourceType:'POSTCARD',sourceVisibility:'SENDER_RECALLABLE',subjectVisitorId:'a'.repeat(32)}]) {
    const row={...candidate,privacyScope:sourceValue.sourceVisibility,subjectVisitorId:sourceValue.subjectVisitorId||null};
    assert.deepEqual(memoryModule.buildFormationRequest(sourceValue,[row]),oldModule.buildFormationRequest(sourceValue,[row]));
  }
  assert.deepEqual(memoryModule.buildSurfacingRequest([candidate],{}),oldModule.buildSurfacingRequest([candidate],{}));
  assert.doesNotMatch(memoryModule.buildSurfacingRequest([candidate],{}).call.prompt,/"status"/);
});

test('eligible query -> selection -> serialized prepared result -> activation -> actual journal prompt',async()=>{
  const original=structuredClone(candidate);
  const{runtime,calls}=fixture();await runtime.requestWorkingContext(context);
  await runtime.processSurfacing({id:1,context,context_fingerprint:memoryContextFingerprint(context),subject_visitor_id:null});
  assert.equal(calls.query,1);assert.equal(calls.model,1,'deterministic fake selection only');
  assert.equal(calls.completed[0].selected_memories[0].status,'ACTIVE');
  assert.equal(runtime.working.selected.length,1);
  const result=journalFromWorking(runtime);
  assert.match(result.context.autobiographicalMemory,/subjective autobiographical memory/);
  const records=result.prompt.split('\n').filter(line=>line.startsWith('{')).map(JSON.parse);
  assert.equal(records.filter(row=>row.source==='recollection'&&row.content===candidate.content).length,1);
  assert.ok(!records.some(row=>row.source==='world_evidence'&&row.content.includes(candidate.content)));
  assert.doesNotMatch(result.prompt,/"status"|ACTIVE|00000000-0000/);
  assert.equal(calls.consumed.length,1);
  assert.deepEqual(candidate,original,'no durable/source mutation');
});

test('cached current prepared projection passes unchanged get/activate/consume path',async()=>{
  const {runtime,client,calls}=fixture();
  client.getPreparedMemorySet=async()=>JSON.parse(JSON.stringify({prepared_set:set(memoryModule.filterMemoriesBeforePrompt([candidate]))}));
  const working=await runtime.requestWorkingContext(context);
  assert.equal(working.selected.length,1);assert.equal(calls.query,0);assert.equal(calls.model,0);
  assert.match(journalFromWorking(runtime).prompt,/Cy remembers walking in the exercise yard/);
});

test('late prepared cache cannot replace a newer fingerprint',async()=>{
  const {runtime,client}=fixture();let release,started;
  const ready=new Promise(r=>{started=r;});const blocked=new Promise(r=>{release=r;});
  const projected=memoryModule.filterMemoriesBeforePrompt([candidate]);
  client.getPreparedMemorySet=async({contextFingerprint})=>{
    if(contextFingerprint===memoryContextFingerprint(context)){started();await blocked;return{prepared_set:set(projected)};}
    return{prepared_set:null};
  };
  const pending=runtime.requestWorkingContext(context);await ready;
  await runtime.requestWorkingContext({...context,text:'a different current situation',generationRef:'journal:2000'});
  release();await pending;
  assert.deepEqual(runtime.working.selected,[]);assert.equal(runtime.working.inspection.status,'PENDING');
});

for(const [candidates,output,category,model]of [[[candidate],'{"memoryRefs":[]}','PREPARED',1],[[],'{"memoryRefs":[]}','NO_CANDIDATES',0]]) {
  test(`empty selection remains empty: ${category}`,async()=>{
    const{runtime,calls}=fixture({candidates,output});await runtime.requestWorkingContext(context);
    await runtime.processSurfacing({id:1,context,context_fingerprint:memoryContextFingerprint(context)});
    assert.deepEqual(runtime.working.selected,[]);assert.equal(runtime.working.directive,'');
    assert.equal(calls.model,model);assert.equal(calls.completed[0].result_category,category);
    assert.doesNotMatch(journalFromWorking(runtime).prompt,/Cy remembers walking in the exercise yard/);
  });
}
