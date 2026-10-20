// Offline deterministic subject replay only. No provider, runner, DB or network.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { journalSubjectFromWorldRecord, selectJournalTurn } from './incidents.js';

export function replayJournalFreshness(fixture) {
  const records = new Map(fixture.records.map((r) => [r.world_event.id, r]));
  let lastJournalAtMs = Date.parse(fixture.previousPublishedAt);
  let seenKeys = [];
  const decisions = [];
  for (const input of fixture.inputs) {
    const worldEvents = input.worldEventIds.map((id) => {
      const r = records.get(id);
      if (!r) throw new Error(`Missing canonical fixture: ${id}`);
      return { id, cyObserved: r.cyObserved,
        journalSubject: journalSubjectFromWorldRecord(r, { cyObserved: r.cyObserved }) };
    });
    const turn = selectJournalTurn([], { lastJournalAtMs, seenKeys, worldEvents,
      nowMs: Date.parse(input.inputAt) });
    decisions.push({ seq: input.seq, oldFreshLine: input.oldFreshLine,
      fresh: !!turn.freshLine, freshLine: turn.freshLine, sourceEventId: turn.sourceEventId,
      reason: turn.reason });
    // The replay follows actual publication boundaries, not a made-up cadence.
    seenKeys = turn.seenKeys;
    lastJournalAtMs = Date.parse(input.publishedAt);
  }
  return {
    oldFresh: fixture.inputs.filter((x) => x.oldFreshLine).length,
    fresh: decisions.filter((x) => x.fresh).length,
    continuation: decisions.filter((x) => !x.fresh).length,
    decisions,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/journal-freshness-20261020.json', import.meta.url), 'utf8'));
  console.log(JSON.stringify(replayJournalFreshness(fixture), null, 2));
}
