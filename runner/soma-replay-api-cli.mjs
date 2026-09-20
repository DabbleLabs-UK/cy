#!/usr/bin/env node
// soma-replay-api-cli.mjs - JSON-over-stdout subprocess entrypoint for the
// replay API. This is what public/replay/api.php shells out to on the hosted
// vps3 deployment (see docs/dev-admin-ui-hosting.md and lib/replay_workbench.php)
// so the workbench needs no persistent Node service, no open port, and no
// DELL/LENO compute: the replay engine only ever replays the six synthetic
// golden fixtures already checked into this repo, which is fast enough to run
// fresh, per admin request, as a short-lived subprocess.
//
// Success:  exit 0, the JSON response body on stdout.
// Failure:  non-zero exit, {"error": "..."} on stderr (never on stdout, so a
//           caller can always tell success from failure by exit code alone).
//
//   node soma-replay-api-cli.mjs fixtures
//   node soma-replay-api-cli.mjs replay <fixtureId> [sampleMinutes] [full-day]

import { buildFixturesResponse, buildReplayResponse } from './soma-replay-api.js';

const [action, ...rest] = process.argv.slice(2);

try {
  let body;
  if (action === 'fixtures') {
    body = buildFixturesResponse();
  } else if (action === 'replay') {
    const [fixtureId, sampleMinutes, viewArg] = rest;
    body = buildReplayResponse({ fixtureId, sampleMinutes, fullDay: viewArg === 'full-day' });
  } else {
    throw new Error(`unknown action: ${action || '(none supplied)'}`);
  }
  process.stdout.write(JSON.stringify(body));
} catch (error) {
  process.stderr.write(JSON.stringify({ error: String(error && error.message || error) }));
  process.exitCode = 1;
}
