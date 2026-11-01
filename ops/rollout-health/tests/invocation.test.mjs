import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { CHECKER_HASHES, readChecker, createInvocation, readSuccessReceipt } from '../invoke-health.mjs';

const operatorRoot = new URL('../', import.meta.url);
const launcher = fileURLToPath(new URL('invoke-health.mjs', operatorRoot));
const sha = value => createHash('sha256').update(value).digest('hex');
const windowsOnly = { skip: process.platform !== 'win32' };
function fixture(t, name = "path with spaces ; &$() ' brackets [x]") {
  const parent = resolve(tmpdir());
  const root = mkdtempSync(join(parent, 'cy-health-invocation-'));
  t.after(() => {
    assert.equal(dirname(root), parent);
    assert.match(basename(root), /^cy-health-invocation-[A-Za-z0-9]+$/);
    rmSync(root, { recursive: true, force: true });
  });
  const directory = join(root, name); mkdirSync(directory);
  for (const [name, hash] of Object.entries(CHECKER_HASHES)) {
    const bytes = Buffer.from(readFileSync(new URL(name, operatorRoot), 'utf8').replaceAll('\r\n', '\n'));
    assert.equal(sha(bytes), hash, 'checked-in logical source changed');
    writeFileSync(join(directory, name), bytes);
  }
  return directory;
}
function execute(request) {
  return spawnSync(request.executable, request.args, request.options);
}

// Only deterministic command doubles. No live CIM, native TCP, executable hash,
// HTTP, spool, runner or service inspection happens in this fixture program.
const doubles = String.raw`
$script:BadApi=$false
Add-Type -TypeDefinition @'
public class CyRolloutNativeListeners {
    public class Row { public int Family,LocalPort,RawState,OwningProcess; public string LocalAddress; }
    public static Row[] Read(int family) {
        if(family==23) return new Row[0];
        return new Row[] {
            new Row {Family=2,LocalAddress="127.0.0.1",LocalPort=11434,RawState=1,OwningProcess=100},
            new Row {Family=2,LocalAddress="127.0.0.1",LocalPort=11435,RawState=0,OwningProcess=101}
        };
    }
}
'@
function Get-CimInstance {
    param($ClassName,$ErrorAction)
    [pscustomobject]@{ProcessId=100;Name='ollama.exe';ExecutablePath='C:\dev\inference-runtime\ollama-0.34.1\ollama.exe';CommandLine='ollama.exe serve';CreationDate='fixed-ollama'}
    [pscustomobject]@{ProcessId=101;Name='node.exe';ExecutablePath='C:\Program Files\nodejs\node.exe';CommandLine='node.exe /home/user/.local/lib/shared-ollama-arbiter/releases/awg-preempt-1/server.js';CreationDate='fixed-arbiter'}
    [pscustomobject]@{ProcessId=900;Name='node.exe';CommandLine='node runner/run.js';CreationDate='fixed-runner'}
}
function Get-NetTCPConnection {
    param($ErrorAction)
    foreach($pair in @(@(11434,100),@(11435,101))) {
        [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=$pair[0];RemoteAddress='0.0.0.0';RemotePort=0;OwningProcess=$pair[1];State=$null;CimInstanceProperties=@{State=@{Value=0}}}
    }
}
function Get-FileHash {param($LiteralPath,$Algorithm,$ErrorAction) @{Hash='1ff56c8b2c791bff69b6457d25aa63ed11073562cd47b14f42dd16dfa4353e05'}}
function Invoke-RestMethod {
    param($Uri,$TimeoutSec)
    if($Uri -like '*/api/version') {@{version='0.34.1'}} else {@{ok=(-not $script:BadApi)}}
}
function Invoke-WebRequest {param([switch]$UseBasicParsing,$Uri,$TimeoutSec) @{StatusCode=200}}
function Get-Item {param($LiteralPath) foreach($p in $LiteralPath) {[pscustomobject]@{Name=[IO.Path]::GetFileName($p);Length=0;LastWriteTimeUtc='fixed'}}}
function Test-Path {param($LiteralPath) $false}
`;
function legacyCommand(source, request) {
  // Exact prior successful command convention, no -File or policy setting.
  const bootstrap = "$ProgressPreference='SilentlyContinue'; & ([scriptblock]::Create([Console]::In.ReadToEnd()))";
  return spawnSync(request.executable, ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text',
    '-EncodedCommand', Buffer.from(bootstrap, 'utf16le').toString('base64')],
  { ...request.options, input: source });
}

test('both approved checker hashes and helper text remain exact', t => {
  const directory = fixture(t);
  const source = readChecker(directory);
  const helper = readFileSync(join(directory, 'endpoint-ownership.ps1'), 'utf8');
  const wrapper = readFileSync(join(directory, 'health.ps1'), 'utf8');
  assert.equal(source, wrapper.split('. "$PSScriptRoot/endpoint-ownership.ps1"').join(helper));
  assert.ok(source.includes("'(?i)\\bserve\\s*$'"), 'literal dollar/apostrophe pattern must not expand as JS replacement syntax');
});
test('package path is data, never PowerShell or shell syntax', t => {
  const directory = fixture(t, "spaces ; & $HOME $(bad) ' [x] " + '\u00a3');
  const request = createInvocation(readChecker(directory));
  assert.equal(request.options.shell, false);
  assert.ok(!request.args.join(' ').includes(directory));
  const command = Buffer.from(request.args.at(-1), 'base64').toString('utf16le');
  assert.ok(!command.includes(directory));
  assert.doesNotMatch(command, /Set-ExecutionPolicy|ExecutionPolicy\s+Bypass|Unblock-File|Set-AuthenticodeSignature/i);
  assert.ok(!request.args.some(arg => /^-(File|ExecutionPolicy)$/i.test(arg)));
  assert.match(command, /ComputeHash/);
  assert.match(command, /Scriptblock\]::Create/i);
  assert.ok(command.indexOf('ComputeHash') < command.indexOf('scriptblock]::Create'));
});
test('missing, relative, changed or incomplete checker package fails before invocation', t => {
  assert.throws(() => readChecker(undefined), /absolute/);
  assert.throws(() => readChecker('relative-directory'), /absolute/);
  const directory = fixture(t);
  writeFileSync(join(directory, 'health.ps1'), '');
  assert.throws(() => readChecker(directory), /Unreviewed checker bytes/);
  rmSync(join(directory, 'endpoint-ownership.ps1'));
  assert.throws(() => readChecker(directory));
});
test('helper substitution or CRLF transport mutation cannot silently change a pinned package', t => {
  const directory = fixture(t);
  const path = join(directory, 'endpoint-ownership.ps1');
  const bytes = readFileSync(path, 'utf8');
  writeFileSync(path, bytes.replaceAll('\n', '\r\n'));
  assert.throws(() => readChecker(directory), /Unreviewed checker bytes/);
  writeFileSync(path, bytes + '\nthrow "modified"');
  assert.throws(() => readChecker(directory), /Unreviewed checker bytes/);
});
test('empty command and empty/partial/extra output cannot be success', () => {
  assert.throws(() => createInvocation(''), /Empty/);
  for (const stdout of ['', '{', '{}', 'null', '[]', '{}\n{}']) {
    assert.throws(() => readSuccessReceipt({ status: 0, stdout }));
  }
});
test('failure, signal and timeout cannot be hidden by an otherwise valid stdout receipt', () => {
  const stdout = JSON.stringify({ observedAtUtc: 'fixed', runners: [{}], listeners: [{}, {}], http: [{}, {}],
    spools: [], ollama: {}, arbiter: {}, restartRequestPresent: false });
  assert.equal(readSuccessReceipt({ status: 0, stdout }).observedAtUtc, 'fixed');
  for (const failure of [{ status: 1 }, { status: null }, { status: 0, signal: 'SIGTERM' },
    { status: 0, error: new Error('ETIMEDOUT') }]) {
    assert.throws(() => readSuccessReceipt({ ...failure, stdout }), /Health checker failed/);
  }
});
test('policy-constrained process double refuses -File but permits only the unchanged command invocation', t => {
  const request = createInvocation(readChecker(fixture(t)));
  const constrained = args => args.includes('-File') ? { status: 1, stderr: 'running scripts is disabled' } :
    { status: 0, stdout: 'command permitted' };
  assert.equal(constrained(['-File', 'health.ps1']).status, 1);
  assert.equal(constrained(request.args).status, 0);
  assert.deepEqual(request.args.slice(0, -1), ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand']);
});
test('actual approved checker receipt is identical to existing command convention with offline doubles', windowsOnly, t => {
  const source = doubles + readChecker(fixture(t));
  const request = createInvocation(source);
  const actual = execute(request);
  const old = legacyCommand(source, request);
  assert.equal(actual.status, 0, actual.stderr);
  assert.equal(old.status, 0, old.stderr);
  const currentReceipt = readSuccessReceipt(actual);
  const oldReceipt = readSuccessReceipt(old);
  // This is the sole nondeterministic clock field, unchanged in checker source.
  delete currentReceipt.observedAtUtc; delete oldReceipt.observedAtUtc;
  assert.deepEqual(currentReceipt, oldReceipt);
  assert.deepEqual(currentReceipt.listeners.map(x => [x.LocalPort, x.OwningProcess]), [[11434, 100], [11435, 101]]);
});
test('actual approved checker failures remain failure with no success receipt', windowsOnly, t => {
  const source = doubles.replace('$script:BadApi=$false', '$script:BadApi=$true') + readChecker(fixture(t));
  const request = createInvocation(source);
  const actual = execute(request), old = legacyCommand(source, request);
  assert.equal(actual.status, 1); assert.equal(old.status, 1);
  assert.equal(actual.stdout.trim(), '');
  assert.throws(() => readSuccessReceipt(actual), /Arbiter is not healthy/);
});
test('truncated, malformed or changed stdin is rejected before any command executes', windowsOnly, () => {
  const request = createInvocation("[Console]::Out.Write('MUST_NOT_EXECUTE')");
  for (const input of ['', request.options.input.slice(0, -4), request.options.input + '\n', 'not base64!',
    Buffer.from("[Console]::Out.Write('different')").toString('base64')]) {
    const result = execute({ ...request, options: { ...request.options, input } });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout.trim(), '', 'must not execute even a valid partial program');
  }
});
test('syntax-invalid complete source fails before a preceding command can execute', windowsOnly, () => {
  const result = execute(createInvocation("[Console]::Out.Write('MUST_NOT_EXECUTE'); if ("));
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), '');
});
test('source quoting, dollar signs, apostrophes, backticks and Unicode survive exactly', windowsOnly, () => {
  const value = "literal $HOME $(not-a-command) ; & | {} [] ' quote \" backtick ` \\ path " + '\u00a3';
  const source = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::Out.Write('" + value.replaceAll("'", "''") + "')";
  const result = execute(createInvocation(source));
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, value);
});
test('large stdin does not become a Windows command-line argument', windowsOnly, () => {
  const request = createInvocation('# ' + 'x'.repeat(50000) + "\n[Console]::Out.Write('large-ok')");
  assert.ok(request.args.join(' ').length < 5000);
  const result = execute(request); assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, 'large-ok');
});
test('CLI missing/extra arguments fail closed without running a checker', () => {
  for (const args of [[], ['one', 'extra']]) {
    const result = spawnSync(process.execPath, [launcher, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /Usage:/);
  }
});
test('CLI package path metacharacters cannot escape into a shell or silently suppress execution', t => {
  const directory = fixture(t);
  writeFileSync(join(directory, 'health.ps1'), 'invalid reviewed hash');
  const result = spawnSync(process.execPath, [launcher, directory], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /Unreviewed checker bytes/);
});
test('launcher filename quoting and Windows path casing cannot silently skip its CLI', t => {
  const directory = fixture(t);
  const copiedLauncher = join(directory, "launcher with spaces ; &$() '.mjs");
  writeFileSync(copiedLauncher, readFileSync(launcher));
  writeFileSync(join(directory, 'health.ps1'), 'invalid reviewed hash');
  // Node's module-format extension is case-sensitive even on Windows. Vary
  // filesystem path casing, not the independently required literal .mjs suffix.
  const path = process.platform === 'win32' ? copiedLauncher.slice(0, -4).toUpperCase() + '.mjs' : copiedLauncher;
  const result = spawnSync(process.execPath, [path, directory], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /Unreviewed checker bytes/);
});
