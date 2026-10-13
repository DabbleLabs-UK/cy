import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  awgCaptureArmed, captureAwgRequest, captureAwgResponse, captureAwgOutcome,
} from './awg-capture.js';

const freshDir = () => mkdtempSync(join(tmpdir(), 'awgcap-'));
const ARM = '.awg-capture-arm';
function samplePkg() {
  const call = {
    system: 'SYS', prompt: 'PROMPT',
    format: { oneOf: [{ a: 1 }, { b: 2 }] },
    options: { temperature: 0.65 }, purpose: 'ambient_world_generation',
  };
  return {
    call, opts: { temperature: 0.65, num_ctx: 3072, stop: ['x'] },
    model: 'test-model', providerId: 'ollama',
    recentWorldHistory: [{ id: 'e1', summary: 's1' }, { id: 'e2', summary: 's2' }],
    worldSimulation: { threads: [], objects: [] }, locationRegime: { current: { id: 'CELL' } },
    plausibleCastIds: ['bill', 'cy'], currentLocation: 'cell',
    contextRendering: 'CTX', contextInspection: { summary: {} },
  };
}

test('disabled by default: no arm file -> captures nothing and returns null', () => {
  const dir = freshDir();
  assert.equal(awgCaptureArmed(dir), false);
  assert.equal(captureAwgRequest(dir, samplePkg()), null);
  assert.equal(existsSync(join(dir, 'awg-capture')), false);
});

test('captureAwgResponse is request-preserving: returns the identical resolution/rejection', async () => {
  // null token (disarmed) -> returns the SAME promise, untouched
  const p = Promise.resolve('RAW');
  assert.equal(captureAwgResponse(null, p), p);
  assert.equal(await captureAwgResponse(null, Promise.resolve('RAW2')), 'RAW2');
  // with a token, the resolved value is byte-identical and a rejection still rejects
  const dir = join(freshDir(), 'cap'); mkdirSync(dir, { recursive: true });
  const raw = 'EXACT-MODEL-OUTPUT';
  assert.equal(await captureAwgResponse(dir, Promise.resolve(raw)), raw);
  assert.equal(JSON.parse(readFileSync(join(dir, 'response.json'), 'utf8')).raw, raw);
  await assert.rejects(() => captureAwgResponse(dir, Promise.reject(new Error('boom'))), /boom/);
});

// NOTE: the module enforces ONE successful capture per process (one-shot guard),
// so exactly one test may perform a successful capture. This is that test; it also
// asserts non-mutation, disarm, blocking, and outcome recovery. Keep it LAST.
test('one-shot: armed -> captures once (no mutation, records hashes, disarms); further requests are null', () => {
  const dir = freshDir();
  writeFileSync(join(dir, ARM), '1');
  assert.equal(awgCaptureArmed(dir), true);

  const pkg = samplePkg();
  const callBefore = JSON.stringify(pkg.call);
  const capDir = captureAwgRequest(dir, pkg);
  assert.ok(capDir && existsSync(join(capDir, 'request.json')), 'request.json written');
  assert.equal(JSON.stringify(pkg.call), callBefore, 'the built request is observed, not altered');
  assert.equal(existsSync(join(dir, ARM)), false, 'arm file deleted -> disarmed');

  const rec = JSON.parse(readFileSync(join(capDir, 'request.json'), 'utf8'));
  assert.equal(rec.request.system, 'SYS');
  assert.equal(rec.recentWorldHistoryCount, 2);
  assert.ok(rec.hashes.system && rec.hashes.prompt && rec.hashes.postBody, 'component + body hashes present');
  assert.equal(rec.lengths.schema_branches, 2);

  // re-arm and confirm the in-process guard still blocks a second capture
  writeFileSync(join(dir, ARM), '1');
  assert.equal(captureAwgRequest(dir, pkg), null, 'one-shot: no second capture this process');

  // outcome append works and recovers nowMs from ranAt
  captureAwgOutcome(capDir, { status: 'REJECTED', latencyMs: 1234, run: { ranAt: '2026-10-13T19:16:34.490Z', validationStatus: 'REJECTED', candidateType: 'EVENT', rejectionReason: 'NAMED_CAST_NOT_PARTICIPANT' } });
  const out = JSON.parse(readFileSync(join(capDir, 'outcome.json'), 'utf8'));
  assert.equal(out.nowMs, Date.parse('2026-10-13T19:16:34.490Z'));
  assert.equal(out.validationStatus, 'REJECTED');
});
