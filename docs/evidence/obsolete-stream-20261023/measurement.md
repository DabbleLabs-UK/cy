# Reproduction of the obsolete-generator measurements

This is measurement tooling, not a runtime module. Copy the script below to
an external `measure.mjs`, outside either measured worktree, so measurement code
is not counted as application source. Use clean worktrees for the base and the
cleanup feature. Source metrics use LF-normalized UTF-8. All timing samples and
the complete argument arrays (including every full-suite file) are in the JSON
records beside this file. No model requests are made.

The original shell set TEMP and TMP to the existing owned workspace test-temp
directory. Equivalent bash commands from this Windows installation:

```bash
export TEMP='C:/Users/jodyf/Documents/Codex/2026-09-03/som/cy-test-temp'
export TMP="$TEMP"
node measure.mjs before /path/to/base-worktree before.json
node measure.mjs after /path/to/cleanup-worktree after.json
node measure.mjs before /path/to/unchanged-base-worktree warm-control.json
```

Base production tree: `172a991855c8a4a4e8020a17b648878ddc5a69ba`.
The warm control reused a clean existing checkout at `9b07134`, whose tree is
identical to production merge `ac182f1`. The after snapshot was taken before the
cleanup commit, so its revision field still says `ac182f1`; its recorded source
hash and the final feature diff identify the changed working source exactly.
The hashes and metrics distinguish these two source states unambiguously.

Fixed searches are application-code searches, excluding tests as alternative
implementations. The context proxy's five files are an explicit inspection set,
not measured hidden Codex input. The narrower generator-block proxy spans the
old/new generator documentation and definitions up to `rawGenerate`.

Tracked source means files ending js/mjs/cjs/php/ps1/vbs/bat/sh/css plus the
extensionless cy-restart helper, including tests. It excludes JSON and Markdown
archives, binary assets and generated/private state. Top-level non-test runner
source is a separate count. No assertion about total repository shrinkage is
implied; the durable audit adds documentation/evidence bytes.

```javascript
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const [phase, rootArg, outputArg] = process.argv.slice(2);
assert.ok(['before', 'after'].includes(phase));
const root = resolve(rootArg);
const output = resolve(outputArg);
const exec = (bin, args) => execFileSync(bin, args, { cwd: root, encoding: 'utf8' });
const text = path => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
const size = content => ({ bytes: Buffer.byteLength(content), lines: content ? content.split('\n').length - Number(content.endsWith('\n')) : 0 });
const total = files => files.reduce((sum, p) => { const n = size(text(p)); return { files: sum.files + 1, bytes: sum.bytes + n.bytes, lines: sum.lines + n.lines }; }, { files: 0, bytes: 0, lines: 0 });
const tracked = exec('git', ['ls-files', '-z']).split('\0').filter(Boolean);
const run = text('runner/run.js');
const legacy = run.indexOf('  // ---- stream one generation from the ACTIVE provider ----');
const modern = run.indexOf('  // Generate waking Cy prose behind a complete-candidate boundary.');
const raw = run.indexOf('  // A one-shot, non-streaming generation whose text');
assert.ok(modern >= 0 && raw > modern);
const contextFiles = ['runner/run.js', 'runner/character-output.js', 'runner/provider.js', 'runner/warden.js', 'runner/inference-coordinator.js'];
const fixedSearches = [
  ['rg', '-n', 'async function (legacyStreamGenerate|streamGenerate)\\b', 'runner', '--glob', '*.js', '--glob', '!*.test.js'],
  ['rg', '-n', '\\b(legacyStreamGenerate|streamGenerate)\\b', 'runner/run.js'],
  ['rg', '-n', '\\blegacyStreamGenerate\\b', 'runner', 'scripts', 'config', 'public', 'lib', '--glob', '!*.test.js'],
];
const searches = fixedSearches.map(([bin, ...args]) => {
  const r = spawnSync(bin, args, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.ok(r.status === 0 || r.status === 1, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/).filter(Boolean);
  return { command: [bin, ...args], hits: lines.length, output: lines };
});
const focusFiles = ['character-output', 'journal-editorial-boundary', 'journal-continuation-instruction-boundary', 'inference-coordinator', 'provider', 'postcard-inference', 'repeatguard', 'boundary', 'dream-world-isolation', 'abort']
  .map(name => `runner/${name}.test.js`);
for (const p of focusFiles) readFileSync(resolve(root, p));
const fullFiles = tracked.filter(p => /^runner\/[^/]+\.test\.js$/.test(p)).sort();
const sourceFiles = tracked.filter(p => /\.(?:[cm]?js|php|ps1|vbs|bat|sh|css)$/.test(p) || p === 'runner/cy-restart');
const runtimeFiles = tracked.filter(p => /^runner\/[^/]+\.[cm]?js$/.test(p) && !p.endsWith('.test.js'));
const inspection = total(contextFiles);
const alternatives = run.slice(legacy >= 0 ? legacy : modern, raw);
const data = { phase, startedAt: new Date().toISOString(), revision: exec('git', ['rev-parse', 'HEAD']).trim(), node: process.version,
  platform: process.platform, runSourceSha256: createHash('sha256').update(run).digest('hex'), searches,
  contextProxy: { definition: 'fixed five-file source set; LF-normalized UTF-8 bytes / 4 rounded up is a heuristic token proxy, NOT measured agent context', paths: contextFiles, ...inspection, byteQuarterTokenProxy: Math.ceil(inspection.bytes / 4) },
  generatorBlocksProxy: { ...size(alternatives), byteQuarterTokenProxy: Math.ceil(Buffer.byteLength(alternatives) / 4) },
  obsoleteBlock: size(legacy >= 0 ? run.slice(legacy, modern) : ''),
  repository: { trackedSource: total(sourceFiles), runnerTopLevelSource: total(runtimeFiles), testFilesCollected: fullFiles.length },
  commands: { syntax: ['node', '--check', 'runner/run.js'], focused: ['node', '--test', '--test-concurrency=2', ...focusFiles], full: ['node', '--test', '--test-concurrency=2', ...fullFiles] },
  syntax: [], focused: [], full: [], complete: false };
const save = () => writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
save();
for (const [kind, repeats] of [['syntax', 9], ['focused', 5], ['full', 3]]) {
  for (let i = 0; i < repeats; i++) {
    const [bin, ...args] = data.commands[kind];
    const t0 = performance.now();
    const r = spawnSync(bin, args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
    const wallMs = performance.now() - t0;
    assert.equal(r.status, 0, `${kind} failed: ${r.stderr}\n${r.stdout.slice(-16000)}`);
    const metric = pattern => Number(r.stdout.match(pattern)?.[1] ?? NaN);
    data[kind].push({ wallMs, ...(kind === 'syntax' ? {} : { tests: metric(/^# tests (\d+)/m), pass: metric(/^# pass (\d+)/m), fail: metric(/^# fail (\d+)/m), reportedDurationMs: metric(/^# duration_ms ([\d.]+)/m) }) });
    save();
    console.log(`${phase} ${kind} ${i + 1}/${repeats}: ${wallMs.toFixed(1)} ms${kind === 'syntax' ? '' : `; ${data[kind].at(-1).pass}/${data[kind].at(-1).tests} passed`}`);
  }
}
assert.equal(text('runner/run.js'), run, 'source changed during measurement');
data.complete = true; data.completedAt = new Date().toISOString(); save();
console.log(`Saved ${output}`);
```
