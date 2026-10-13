// awg-capture.js - one-shot, behaviour-neutral capture of ONE real production
// AWG request (+ its raw response and production validation outcome), for
// byte-faithful offline reproduction on an isolated host.
//
// DISABLED BY DEFAULT. It records nothing unless an operator-only arm file
// exists at <stateDir>/.awg-capture-arm. On the first armed, naturally-admitted
// AWG request it writes the evidence and DELETES the arm file, so it is strictly
// one-shot and cannot continually record. It never reconstructs or alters the
// request: it observes the already-built values, leaves the same request going
// to the same provider, adds no tokens, changes no timing/scheduling/validation,
// and returns the model response promise unchanged. Any file-write failure is
// swallowed so production behaviour stays safe and ordinary.
//
// Evidence is written locally under <stateDir>/awg-capture/ only; nothing is
// sent to VPS3 and nothing is user-facing.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ARM_BASENAME = '.awg-capture-arm';
let capturedThisProcess = false; // in-process guard against a double-capture race

const sha = (s) => createHash('sha256').update(s).digest('hex');

function moduleFingerprint() {
  // sha256 of this module + the AWG generator it depends on, as a code identity.
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const self = readFileSync(join(here, 'awg-capture.js'));
    const awg = readFileSync(join(here, 'ambient-world-generator.js'));
    return { awgCaptureSha: sha(self), ambientWorldGeneratorSha: sha(awg) };
  } catch { return { awgCaptureSha: null, ambientWorldGeneratorSha: null }; }
}

export function awgCaptureArmed(stateDir) {
  try { return existsSync(join(stateDir, ARM_BASENAME)); } catch { return false; }
}

// Called in the AWG generate callback, AFTER the request is fully built, BEFORE
// it is sent. Observes the exact values. Returns a capture directory token on a
// successful one-shot capture, else null. Never throws.
export function captureAwgRequest(stateDir, pkg) {
  if (capturedThisProcess) return null;
  if (!awgCaptureArmed(stateDir)) return null;
  try {
    capturedThisProcess = true; // claim the one-shot before any slow IO
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = join(stateDir, 'awg-capture', `capture-${stamp}`);
    mkdirSync(dir, { recursive: true });
    const { call, opts, model, providerId, recentWorldHistory, worldSimulation,
      locationRegime, plausibleCastIds, currentLocation, contextRendering,
      contextInspection, modelBlobSha256 } = pkg;
    // The exact /api/generate body shape the provider sends (transport-only
    // fields like keep_alive are recorded separately, proven irrelevant to output).
    const postBody = { model, system: call.system, prompt: call.prompt, format: call.format, options: opts };
    const record = {
      schema: 'cy.awg-capture.v1',
      capturedAt: new Date().toISOString(),
      code: moduleFingerprint(),
      model, providerId, modelBlobSha256: modelBlobSha256 || null,
      currentLocation,
      plausibleCastIds,
      request: {
        system: call.system, prompt: call.prompt, format: call.format,
        options: opts, purpose: call.purpose,
      },
      postBody,
      hashes: {
        system: sha(call.system), prompt: sha(call.prompt),
        format: sha(JSON.stringify(call.format)), options: sha(JSON.stringify(opts)),
        postBody: sha(JSON.stringify(postBody)),
      },
      lengths: { system_chars: call.system.length, prompt_chars: call.prompt.length,
        schema_branches: Array.isArray(call.format?.oneOf) ? call.format.oneOf.length : null },
      // state/context inputs needed to reproduce materialisation + validation
      recentWorldHistory: Array.isArray(recentWorldHistory) ? recentWorldHistory.slice() : [],
      recentWorldHistoryCount: Array.isArray(recentWorldHistory) ? recentWorldHistory.length : 0,
      worldSimulation,
      locationRegime,
      contextRendering,
      contextInspection: contextInspection || null,
    };
    writeFileSync(join(dir, 'request.json'), JSON.stringify(record, null, 2));
    // disarm: remove the arm file so no further AWG request is ever recorded.
    try { rmSync(join(stateDir, ARM_BASENAME), { force: true }); } catch { /* best-effort */ }
    return dir;
  } catch {
    // On failure leave production untouched; allow a later opportunity to retry.
    capturedThisProcess = false;
    return null;
  }
}

// Wraps the model-response promise WITHOUT altering it: records the raw response
// (or error) and returns the identical resolution/rejection.
export function captureAwgResponse(captureDir, responsePromise) {
  if (!captureDir) return responsePromise;
  return responsePromise.then(
    (raw) => {
      try {
        const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
        writeFileSync(join(captureDir, 'response.json'),
          JSON.stringify({ capturedAt: new Date().toISOString(), raw: text, sha256: sha(text), chars: text.length }, null, 2));
      } catch { /* swallow */ }
      return raw;
    },
    (err) => {
      try {
        writeFileSync(join(captureDir, 'response.json'),
          JSON.stringify({ capturedAt: new Date().toISOString(), error: String(err && err.message || err) }, null, 2));
      } catch { /* swallow */ }
      throw err;
    },
  );
}

// Records the production materialise/validate outcome for the SAME opportunity,
// plus the exact nowMs (recovered from the run's ranAt). Observes only.
export function captureAwgOutcome(captureDir, result) {
  if (!captureDir) return;
  try {
    const run = result && result.run ? result.run : {};
    const ranAt = run.ranAt || null;
    writeFileSync(join(captureDir, 'outcome.json'), JSON.stringify({
      capturedAt: new Date().toISOString(),
      status: result && result.status, ranAt,
      nowMs: ranAt ? Date.parse(ranAt) : null,
      candidateType: run.candidateType || null,
      validationStatus: run.validationStatus || null,
      rejectionReason: run.rejectionReason || null,
      threadChanges: run.threadChanges || [],
      candidateOutput: run.candidateOutput || null,
      modelLatencyMs: run.modelLatencyMs ?? null,
      totalLatencyMs: result ? result.latencyMs : null,
    }, null, 2));
  } catch { /* swallow */ }
}
