# Reproduction of postcard retry cleanup measurements

The three gzip files preserve original JSON bytes; index.json records both
compressed and uncompressed SHA-256. Originals remain outside the measured repo
in maintainability-postcard-retry-20261023. Nothing was deleted to compress them.

Base/control: 4b15a37dd7d6298c92473dece08bcaff6ea3d0cb, tree
6949493d943ef66222652d797b71f54683fa0797. After was measured before commit,
so revision still names the base while queueLfSha256 identifies changed source.

Measurements ran sequentially before -> after -> unchanged warm control; no
other test suite ran concurrently. The two separately reported real-API checks
ran outside timing phases. Ordinary desktop load was not controlled/randomized.
This cannot establish a causal timing gain or actual agent-context consumption.

Copy the following unchanged script outside the measured repo. Set TEMP and TMP
to the same owned test-temp directory for all phases. On this Windows host:

```bash
export TEMP='C:/Users/jodyf/Documents/Codex/2026-09-03/som/cy-test-temp'
export TMP="$TEMP"
node measure.mjs before /path/to/base before.json
node measure.mjs after /path/to/cleanup after.json
node measure.mjs warm-control /path/to/unchanged-base warm-control.json
```

```javascript
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
const [phase, rootArg, outputArg] = process.argv.slice(2);
assert.ok(['before', 'after', 'warm-control'].includes(phase));
const root = resolve(rootArg), output = resolve(outputArg);
const exec = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const text = p => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n');
const size = t => ({ bytes: Buffer.byteLength(t), lines: t ? t.split('\n').length - Number(t.endsWith('\n')) : 0 });
const total = paths => paths.reduce((s, p) => { const n = size(text(p)); return { files: s.files + 1, bytes: s.bytes + n.bytes, lines: s.lines + n.lines }; }, { files: 0, bytes: 0, lines: 0 });
const hash = t => createHash('sha256').update(t).digest('hex');
const tracked = exec(['ls-files', '-z']).split('\0').filter(Boolean);
const queue = text('lib/postcard_queue.php');
const oldStart = queue.indexOf('/** @return array{attempts:int,retry:bool,mail_class:string,retry_after_seconds:int} */');
const oldEnd = queue.indexOf('// A retry is the same physical postcard');
const liveStart = queue.indexOf('function captive_postcard_defer(');
const liveEnd = queue.indexOf('/**\n * A runner has one reply generation lane.', liveStart);
assert.ok(oldEnd >= 0 && liveStart > oldEnd && liveEnd > liveStart);
const obsolete = oldStart >= 0 ? queue.slice(oldStart, oldEnd) : '';
const alternatives = obsolete + queue.slice(liveStart, liveEnd);
const contextFiles = ['lib/postcard_queue.php', 'public/api/ingest.php', 'public/api/inbox.php', 'public/api/postcard-inference.php', 'lib/postcard_inference.php', 'tests/postcard_queue_test.php', 'tests/postcard_retry_lifecycle_integration.test.mjs'];
const fixedSearches = [
  ['-n', '^function captive_postcard_(failed_attempt|defer)\\b', 'lib/postcard_queue.php'],
  ['-n', '\\bcaptive_postcard_(failed_attempt|defer)\\b', 'lib', 'public', 'scripts', 'config', '--glob', '*.php'],
  ['-n', '\\bcaptive_postcard_failed_attempt\\b', 'lib', 'public', 'scripts', 'config', '--glob', '*.php'],
  ['-n', "'fan_final'|CY_REPLY_MAX_ATTEMPTS|quality_failures", 'lib/postcard_queue.php'],
];
const searches = fixedSearches.map(args => {
  const r = spawnSync('rg', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.ok(r.status === 0 || r.status === 1, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/).filter(Boolean);
  return { command: ['rg', ...args], hits: lines.length, files: new Set(lines.map(l => l.match(/^(.+?):\d+:/)?.[1] || 'lib/postcard_queue.php')).size, output: lines };
});
const php = 'C:/php84/php.exe';
const sourceFiles = tracked.filter(p => /\.(?:[cm]?js|php|ps1|vbs|bat|sh|css)$/.test(p) || p === 'runner/cy-restart');
const runnerFiles = tracked.filter(p => /^runner\/[^/]+\.test\.js$/.test(p)).sort();
const phpFiles = tracked.filter(p => /^tests\/[^/]+_test\.php$/.test(p)).sort();
const focused = ['tests/postcard_queue_test.php', 'tests/postcard_inference_test.php', 'tests/postcard_archive_test.php'];
const inspection = total(contextFiles);
const data = { phase, startedAt: new Date().toISOString(), revision: exec(['rev-parse', 'HEAD']).trim(), tree: exec(['rev-parse', 'HEAD^{tree}']).trim(), node: process.version,
  phpVersion: execFileSync(php, ['-v'], { encoding: 'utf8' }).split(/\r?\n/)[0], platform: process.platform, queueLfSha256: hash(queue), searches,
  contextProxy: { definition: 'fixed seven-file LF-normalized inspection set, not measured agent context; ceil(UTF-8 bytes / 4) heuristic, not tokenizer count', paths: contextFiles, ...inspection, byteQuarterTokenProxy: Math.ceil(inspection.bytes / 4) },
  retryImplementationProxy: { ...size(alternatives), byteQuarterTokenProxy: Math.ceil(Buffer.byteLength(alternatives) / 4) }, obsoleteBlock: size(obsolete),
  repository: { trackedSource: total(sourceFiles), phpLibrary: total(tracked.filter(p => /^lib\/.*\.php$/.test(p))), runnerTestFiles: runnerFiles.length, phpTestFiles: phpFiles.length },
  commands: { syntax: [[php, '-l', 'lib/postcard_queue.php']], focused: focused.map(p => [php, p]), php: phpFiles.map(p => [php, p]), full: [['node', '--test', '--test-concurrency=2', ...runnerFiles]] },
  syntax: [], focused: [], php: [], full: [], complete: false };
const save = () => writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
save();
for (const [kind, repeats] of [['syntax', 9], ['focused', 5], ['php', 3], ['full', 3]]) {
  for (let i = 0; i < repeats; i++) {
    const t0 = performance.now(), steps = [];
    for (const [bin, ...args] of data.commands[kind]) {
      const r = spawnSync(bin, args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 24 * 1024 * 1024 });
      assert.equal(r.status, 0, `${kind} failed: ${bin} ${args.join(' ')}\n${r.stderr}\n${r.stdout.slice(-18000)}`);
      const metric = re => Number(r.stdout.match(re)?.[1] ?? NaN);
      steps.push({ tests: metric(/^# tests (\d+)/m), pass: metric(/^# pass (\d+)/m), fail: metric(/^# fail (\d+)/m), reportedDurationMs: metric(/^# duration_ms ([\d.]+)/m),
        phpCheckLines: (r.stdout.match(/^\s+ok\s/gm) || []).length, outputSha256: hash(r.stdout), tail: r.stdout.trim().split(/\r?\n/).slice(-4) });
    }
    const result = { wallMs: performance.now() - t0, steps };
    data[kind].push(result); save();
    console.log(`${phase} ${kind} ${i + 1}/${repeats}: ${result.wallMs.toFixed(1)}ms; ${kind === 'full' ? `${steps[0].pass}/${steps[0].tests}` : `${steps.length} command(s) passed`}`);
  }
}
assert.equal(text('lib/postcard_queue.php'), queue, 'source changed during measurement');
data.complete = true; data.completedAt = new Date().toISOString(); save();
```

# Extra real-API validation

The existing test is unchanged; it runs without skips against an owned disposable
MariaDB instance using this harness. Create client.cnf containing only [client]
beside it. No existing DB service or production host is used. Only the process
this harness started is stopped. The temporary web fixture is owned by the test.

```powershell
param([Parameter(Mandatory=$true)][string]$Repo)
$ErrorActionPreference='Stop'
$workspace='C:\Users\jodyf\Documents\Codex\2026-09-03\som'
$data=Join-Path $workspace ('postcard-retry-replication-db-'+[guid]::NewGuid().ToString('N'))
$bin='C:\wamp\bin\mariadb\mariadb10.10.2\bin'
$defaults=Join-Path $PSScriptRoot 'client.cnf'
if(Test-Path -LiteralPath $data){throw 'Refusing to reuse any database directory'}
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$listener.Start();$port=$listener.LocalEndpoint.Port;$listener.Stop()
& "$bin\mariadb-install-db.exe" "--datadir=$data" "--port=$port" --silent
if($LASTEXITCODE -ne 0){throw 'Disposable database initialization failed'}
$dbProcess=$null
try {
 $dbProcess=Start-Process -FilePath "$bin\mariadbd.exe" -ArgumentList @('--no-defaults',"--datadir=$data","--port=$port",'--bind-address=127.0.0.1','--innodb-buffer-pool-size=64M','--max-connections=12',"--pid-file=$data\owned.pid",'--skip-log-bin','--skip-name-resolve',"--log-error=$data\owned.err") -WindowStyle Hidden -PassThru
 $ready=$false
 for($i=0;$i -lt 60;$i++){
  if($dbProcess.HasExited){throw 'Owned database exited'}
  if(Test-Path -LiteralPath "$data\owned.pid"){
   $identity=& "$bin\mariadb.exe" --no-defaults -h 127.0.0.1 -P $port -u root --batch --raw --skip-column-names -e 'SELECT @@datadir' 2>$null
   if($LASTEXITCODE -eq 0){
    $resolved=[IO.Path]::GetFullPath(([string]$identity).Replace([char]47,[char]92)).TrimEnd([char]92)
    if($resolved -ne $data){throw 'Database directory identity mismatch'}
    if([int](Get-Content "$data\owned.pid") -ne $dbProcess.Id){throw 'Database PID mismatch'}
    $ready=$true;break
   }
  }
  Start-Sleep -Milliseconds 200
 }
 if(!$ready){throw 'Owned database not ready'}
 $env:CY_TEST_DB_ISOLATED='1';$env:CY_TEST_DB_PORT=[string]$port
 $env:CY_TEST_MARIADB_BIN="$bin\mariadb.exe";$env:CY_TEST_PHP_BIN='C:\php84\php.exe'
 $env:CY_TEST_DB_DEFAULTS=$defaults
 $env:TEMP=Join-Path $workspace 'cy-test-temp';$env:TMP=$env:TEMP
 Write-Output "Owned disposable database PID=$($dbProcess.Id) port=$port datadir=$data"
 Push-Location -LiteralPath $Repo
 try {
  & node --test --test-concurrency=1 tests/postcard_retry_lifecycle_integration.test.mjs
  if($LASTEXITCODE -ne 0){throw 'Canonical retry lifecycle integration failed'}
 } finally {Pop-Location}
} finally {
 if($dbProcess -and !$dbProcess.HasExited){
  Stop-Process -Id $dbProcess.Id
  $dbProcess.WaitForExit()
 }
 if($dbProcess){Write-Output "Owned database stopped: $($dbProcess.HasExited)"}
}
```
