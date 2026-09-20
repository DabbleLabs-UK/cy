// soma-replay-api.js - pure request/response builders for the replay JSON
// API. No HTTP, no process, no filesystem beyond the fixtures already loaded
// in memory. Shared by two callers that must behave IDENTICALLY:
//   - soma-replay-server.js (the local Node HTTP dev server)
//   - soma-replay-api-cli.mjs (the subprocess entrypoint public/replay/api.php
//     shells out to on the hosted vps3 deployment - see docs/dev-admin-ui-hosting.md)
// Keeping this logic in one place means the hosted and local-dev paths can
// never silently diverge.

import { GOLDEN_SOMA_REPLAY_FIXTURES, goldenFixture } from './soma-replay-fixtures.js';
import { runSomaReplay, fullDayWindowMs, DEFAULT_REPLAY_SAMPLE_INTERVAL_MS } from './soma-replay.js';
import { computeCandidateTrajectory, candidateModelMetadata } from './candidate-threat-anticipation-load.js';

export function fixtureSummary(fixture) {
  return {
    id: fixture.id,
    title: fixture.title,
    startMs: fixture.startMs,
    endMs: fixture.endMs,
    eventCount: fixture.records.length,
  };
}

export function resolveSampleParam(raw) {
  if (raw == null || raw === '' || raw === 'off' || raw === '0') return null;
  if (raw === 'default') return true;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) return true;
  return minutes * 60 * 1000;
}

export function buildFixturesResponse() {
  return {
    defaultSampleIntervalMs: DEFAULT_REPLAY_SAMPLE_INTERVAL_MS,
    fixtures: GOLDEN_SOMA_REPLAY_FIXTURES.map(fixtureSummary),
  };
}

// Throws an Error with a numeric `.status` (matching the HTTP status the
// caller should report) on an unknown fixture - both the HTTP server and the
// CLI/PHP bridge map this the same way.
export function buildReplayResponse({ fixtureId, sampleMinutes, fullDay = false } = {}) {
  const fixture = fixtureId ? goldenFixture(fixtureId) : null;
  if (!fixture) {
    const error = new Error(`unknown fixture: ${fixtureId || '(none supplied)'}`);
    error.status = 404;
    throw error;
  }
  let sampleIntervalMs = resolveSampleParam(sampleMinutes);
  const replayArgs = { ...fixture, sampleIntervalMs };
  if (fullDay) {
    // Widen only the plotted interval to the whole day; records/initialState/
    // coverage are untouched (see fullDayWindowMs in soma-replay.js), so every
    // per-event snapshot stays identical to EVENT WINDOW. A 24h span with
    // sampling off would render as just two endpoints, so full-day sampling
    // defaults to the documented interval when the caller left it off.
    const window = fullDayWindowMs(fixture);
    replayArgs.startMs = window.startMs;
    replayArgs.endMs = window.endMs;
    if (!sampleIntervalMs) sampleIntervalMs = true;
    replayArgs.sampleIntervalMs = sampleIntervalMs;
  }
  const report = runSomaReplay(replayArgs);
  // The candidate is a pure post-process over the already-computed CURRENT
  // report - no second replay run, no Soma state mutation, no new grounded
  // input. See candidate-threat-anticipation-load.js.
  const candidate = computeCandidateTrajectory(report);
  return {
    fixture: fixtureSummary(fixture),
    report,
    candidate: { model: candidateModelMetadata(), trajectory: candidate },
  };
}
