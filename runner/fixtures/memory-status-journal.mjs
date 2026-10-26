// Execute actual journal context builders with deterministic in-memory state.
// No runner main, provider, filesystem state mutation or publication.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as broker from '../context-broker.js';
import { buildDirectives, buildPrompt } from '../prompt.js';
import { memoryEpistemicNature } from '../autobiographical-memory.js';
import { sanitizeCharacterContext, stripMalformedProseControls } from '../warden.js';

const source=readFileSync(new URL('../run.js',import.meta.url),'utf8');
const extract=(start,end)=>{
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,'actual journal source boundary '+start);
  return source.slice(a,b);
};
const functions=extract('  function brokerItems(', '  const genericMemoryAvailability =')
  +extract('  function buildCtx(', '  // ---- postcard mode:');

export function journalFromWorking(runtime) {
  const inspections=[];
  const make=runInNewContext(`(function() {
    let genCount=0,forceCost=false,officerCue=null,overheardCue=null,wingNoiseCue=null;
    const COST_EVERY=1000;
    ${functions}
    return buildCtx;
  })()`,{
    ...broker, autobiographicalMemory:runtime,
    vitals:{locationRegime:{current:{id:'CELL',entered_at:'2026-10-26T12:00:00.000Z',regime_activity:'lockup'}}},
    recentWorldHistory:[],londonParts:()=>({mins:720}),regimeDirective:()=> 'In the cell.',
    locationContextId:()=> 'cell',contextText:()=> 'a prior subjective thought.',
    sanitizeCharacterContext,stripMalformedProseControls,memoryEpistemicNature,
    emit:event=>inspections.push(event),console,
  });
  const context=make({groundedDirective:'',groundedContext:{}},{
    generationRef:'journal-prose:1000',wakingJournalContext:true,
  });
  const prompt=buildPrompt('a prior subjective thought.','journal',null,buildDirectives({},'journal',context));
  return {context,prompt,inspections};
}
