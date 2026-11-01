// Operator-only launcher for the exact approved checker. No shell or policy changes.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKER_HASHES = Object.freeze({
  'health.ps1': '6709849eda0692218813852a9546f14b7db7218395f5f335b17e58be6db0f2d7',
  'endpoint-ownership.ps1': 'bbd3bff5ce79b8bf5efa4881f56cfda6ea9add8e6f7cdb8095fc3965b3786621',
});
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const importLine = '. "$PSScriptRoot/endpoint-ownership.ps1"';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export function readChecker(packageDirectory) {
  if (typeof packageDirectory !== 'string' || !isAbsolute(packageDirectory)) {
    throw new Error('An absolute reviewed package directory is required');
  }
  const source = {};
  for (const [name, expected] of Object.entries(CHECKER_HASHES)) {
    const bytes = readFileSync(join(packageDirectory, name));
    if (sha(bytes) !== expected) throw new Error('Unreviewed checker bytes: ' + name);
    source[name] = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  if (source['health.ps1'].split(importLine).length !== 2) {
    throw new Error('Expected exactly one reviewed helper import');
  }
  // Function replacement is deliberate: helper text contains literal $ syntax.
  // Do not let JavaScript replacement-string substitutions reinterpret it.
  return source['health.ps1'].replace(importLine, () => source['endpoint-ownership.ps1']);
}

export function createInvocation(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Empty checker command');
  const bytes = Buffer.from(source, 'utf8');
  // Only a locally computed hex digest is interpolated into this fixed bootstrap.
  // Paths and source are data on stdin, never shell/PowerShell argument syntax.
  const bootstrap = `$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
try {
    $encoded=[Console]::In.ReadToEnd()
    if (-not $encoded -or $encoded -notmatch '\\A(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?\\z') { throw 'Invalid checker transport' }
    $bytes=[Convert]::FromBase64String($encoded)
    $algorithm=[Security.Cryptography.SHA256]::Create()
    try { $digest=[BitConverter]::ToString($algorithm.ComputeHash($bytes)).Replace('-','').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
    if ($digest -cne '${sha(bytes)}') { throw 'Incomplete or changed checker transport' }
    $source=([Text.UTF8Encoding]::new($false,$true)).GetString($bytes)
    & ([scriptblock]::Create($source))
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}`;
  return {
    executable: powershell,
    args: ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(bootstrap, 'utf16le').toString('base64')],
    options: { input: bytes.toString('base64'), encoding: 'utf8', timeout: 95_000,
      maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] },
  };
}

export function readSuccessReceipt(result) {
  if (result.error || result.signal || result.status !== 0) {
    throw new Error('Health checker failed: ' + (result.error?.message || result.signal || ('exit ' + result.status)) +
      (result.stderr ? '\n' + result.stderr.trim() : ''));
  }
  const receipt = JSON.parse(result.stdout);
  // Check transport completeness, not health semantics. The unchanged checker
  // remains the authority for all endpoint/process/HTTP gates.
  if (!receipt || Array.isArray(receipt) || typeof receipt.observedAtUtc !== 'string' ||
      !Array.isArray(receipt.runners) || receipt.runners.length !== 1 ||
      !Array.isArray(receipt.listeners) || receipt.listeners.length !== 2 ||
      !Array.isArray(receipt.http) || receipt.http.length !== 2 ||
      !Array.isArray(receipt.spools) || !receipt.ollama || !receipt.arbiter ||
      typeof receipt.restartRequestPresent !== 'boolean') {
    throw new Error('Missing or incomplete health receipt');
  }
  return receipt;
}

export function runHealthCheck(packageDirectory) {
  const request = createInvocation(readChecker(packageDirectory));
  const result = spawnSync(request.executable, request.args, request.options);
  readSuccessReceipt(result);
  return result;
}

const identity = path => process.platform === 'win32' ? realpathSync(path).toLowerCase() : realpathSync(path);
if (import.meta.url.startsWith('file:') && process.argv[1] &&
    identity(resolve(process.argv[1])) === identity(fileURLToPath(import.meta.url))) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node invoke-health.mjs <absolute-reviewed-package-directory>');
    const result = runHealthCheck(process.argv[2]);
    if (result.stderr) process.stderr.write(result.stderr);
    process.stdout.write(result.stdout);
  } catch (error) {
    process.stderr.write('CY health invocation: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
