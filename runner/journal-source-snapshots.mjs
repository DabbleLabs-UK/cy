// Offline prompt snapshots only. No provider, runner, server, or state imports.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CONTEXT_BROKER_SCHEMA, CONTEXT_CONSUMERS, createContextItem,
  renderWakingJournalContextPacket } from './context-broker.js';
import { buildDirectives, buildPrompt, selectJournalContinuation, ZONE_A } from './prompt.js';

export const fixture = JSON.parse(readFileSync(
  new URL('./fixtures/journal-source-boundaries-20261020.json', import.meta.url), 'utf8'));

export function sourceSnapshot(input) {
  const item = (id, provenanceClass, content) => createContextItem({
    id, sourceId: id, section: 'recent_events', provenanceClass, content,
    knowledgeScope: provenanceClass === 'SUBJECTIVE BELIEF' ? 'CY_BELIEVES' : 'CY_OBSERVED',
    privacyScope: 'INTERNAL_ONLY',
  });
  // The retained prompt already reflects broker selection/privacy/budgets.
  // Re-encode exactly those selected source contents; do not select new facts.
  const packet = { schema: CONTEXT_BROKER_SCHEMA, consumer: CONTEXT_CONSUMERS.CY_PROSE,
    sections: [{ items: [
      item('current', 'WORLD FACT', input.currentWorld),
      item('grounded-soma:current', 'MODEL ESTIMATE', input.soma),
      item('incident:current', 'SUBJECTIVE BELIEF', input.beliefs),
      ...input.worldObservations.map((content, i) => item(`observation:${i}`, 'OBSERVED BY CY', content)),
    ] }] };
  const ctx = {
    wakingJournalContext: true, sharedContext: renderWakingJournalContextPacket(packet),
    bans: input.bans, turn: input.turn, length: input.length,
    wingnoise: input.cues.find((s) => s.startsWith('THE WING')) || '',
    overheard: input.cues.find((s) => s.startsWith('YOU HALF HEAR IT')) || '',
  };
  const oldCue = 'Continue the next private thought in the same rough lower-case prison voice. Make it understandable on a first or second read; do not omit words needed to tell who or what you mean. No polished standard English, semicolons, analysis, explanation, or commentary about the material. Begin with the thought itself.';
  return {
    eventSeq: input.eventSeq, publishedAtBst: input.publishedAtBst,
    before: { system: fixture.beforeSystem, prompt: [
      'Earlier private writing by Cy (subjective, may be mistaken or outdated; not evidence that its claims are true):',
      selectJournalContinuation(input.priorWriting), '', input.beforeDirectives, oldCue,
    ].join('\n') },
    after: { system: ZONE_A, prompt: buildPrompt(input.priorWriting, 'journal', null,
      buildDirectives({}, 'journal', ctx)) },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(fixture.cases.map(sourceSnapshot), null, 2));
}
