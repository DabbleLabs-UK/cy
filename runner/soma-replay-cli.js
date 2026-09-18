#!/usr/bin/env node

import { GOLDEN_SOMA_REPLAY_FIXTURES, goldenFixture } from './soma-replay-fixtures.js';
import { formatSomaReplay, runSomaReplay } from './soma-replay.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const requested = args.find((arg) => !arg.startsWith('--'));
const fixtures = requested
  ? [goldenFixture(requested)].filter(Boolean)
  : GOLDEN_SOMA_REPLAY_FIXTURES;

if (requested && fixtures.length === 0) {
  console.error(`Unknown fixture: ${requested}`);
  console.error(`Available: ${GOLDEN_SOMA_REPLAY_FIXTURES.map((item) => item.id).join(', ')}`);
  process.exitCode = 1;
} else {
  const reports = fixtures.map((fixture) => ({
    fixture: { id: fixture.id, title: fixture.title },
    report: runSomaReplay(fixture),
  }));
  if (json) {
    console.log(JSON.stringify(reports, null, 2));
  } else {
    for (const item of reports) {
      console.log(`\n=== ${item.fixture.title} (${item.fixture.id}) ===`);
      console.log(formatSomaReplay(item.report));
    }
  }
}
