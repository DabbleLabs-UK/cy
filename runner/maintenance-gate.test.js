import assert from 'node:assert/strict';
import test from 'node:test';
import { MaintenanceGate } from './maintenance-gate.js';

// In-memory fs double. request===undefined -> request.json is ENOENT.
function makeFs({ dirIsDir = true, request = undefined, failStat = false, failWrite = false } = {}) {
  const files = {};
  const enoent = () => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; };
  return {
    files,
    statSync(p) {
      if (failStat) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      if (String(p).endsWith('cy-status.json') && !(p in files)) enoent();
      return { isDirectory: () => dirIsDir };
    },
    readFileSync(p) {
      if (String(p).endsWith('request.json')) {
        if (request === undefined) enoent();
        return typeof request === 'string' ? request : JSON.stringify(request);
      }
      if (p in files) return files[p];
      enoent();
    },
    writeFileSync(p, data) { if (failWrite) throw new Error('disk full'); files[p] = data; },
    renameSync(a, b) { files[b] = files[a]; delete files[a]; },
  };
}
const status = (fs) => {
  const key = Object.keys(fs.files).find((k) => k.endsWith('cy-status.json'));
  return key ? JSON.parse(fs.files[key]) : null;
};

test('no directory configured: gate is inert (always running, admits, writes nothing)', () => {
  const g = new MaintenanceGate({ directory: '' });
  const s = g.refresh();
  assert.equal(s.state, 'running');
  const release = g.enter();
  assert.equal(typeof release, 'function');
  release();
});

test('directory present, no request: running, admits, and publishes status', () => {
  const fs = makeFs({});
  const g = new MaintenanceGate({ directory: 'MDIR', fs, pid: 7, now: () => 'T' });
  const s = g.refresh();
  assert.equal(s.state, 'running');
  assert.equal(status(fs).state, 'running');
  assert.equal(status(fs).pid, 7);
  const release = g.enter();
  assert.equal(typeof release, 'function');
  assert.equal(status(fs).active, 1);
  release();
  assert.equal(status(fs).active, 0);
});

test('fresh request with no in-flight work: HELD and refuses ordinary admission', () => {
  const fs = makeFs({ request: { version: 1, id: 'job-1' } });
  const g = new MaintenanceGate({ directory: 'MDIR', fs });
  const s = g.refresh();
  assert.equal(s.state, 'held');
  assert.equal(s.requestId, 'job-1');
  assert.equal(g.enter(), null, 'ordinary admission is refused while held');
});

test('held but drainExisting: admits, and reports DRAINING while work is in flight', () => {
  const fs = makeFs({ request: { version: 1, id: 'job-1' } });
  const g = new MaintenanceGate({ directory: 'MDIR', fs });
  const release = g.enter({ drainExisting: true });
  assert.equal(typeof release, 'function', 'drain admission is allowed');
  assert.equal(status(fs).state, 'draining');
  assert.equal(status(fs).active, 1);
  release();
  assert.equal(status(fs).state, 'held', 'returns to held once drained to zero');
});

test('additionalActive in-flight work keeps state draining, not held', () => {
  const fs = makeFs({ request: { version: 1, id: 'job-1' } });
  const g = new MaintenanceGate({ directory: 'MDIR', fs, additionalActive: () => 3 });
  assert.equal(g.refresh().state, 'draining');
  assert.equal(g.refresh().active, 3);
});

test('invalid request (bad version or id) is error, and never admits', () => {
  for (const bad of [{ version: 2, id: 'x' }, { version: 1, id: 'bad id!' }, 'not json']) {
    const fs = makeFs({ request: bad });
    const g = new MaintenanceGate({ directory: 'MDIR', fs });
    assert.equal(g.refresh().state, 'error');
    assert.equal(g.enter({ drainExisting: true }), null, 'error never admits, even draining');
  }
});

test('unavailable maintenance directory is treated as blocked/error (fail safe)', () => {
  const fs = makeFs({ failStat: true });
  const g = new MaintenanceGate({ directory: 'MDIR', fs });
  assert.equal(g.refresh().state, 'error');
  assert.equal(g.enter(), null);
});

test('a failed status write downgrades to error and refuses admission', () => {
  const fs = makeFs({ failWrite: true });
  const g = new MaintenanceGate({ directory: 'MDIR', fs });
  assert.equal(g.refresh().state, 'error', 'a stale status must not authorize admission');
  assert.equal(g.enter(), null);
});

test('release is idempotent', () => {
  const fs = makeFs({});
  const g = new MaintenanceGate({ directory: 'MDIR', fs });
  const release = g.enter();
  release();
  release();
  assert.equal(status(fs).active, 0);
});
