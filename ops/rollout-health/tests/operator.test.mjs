import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
test('Windows PowerShell 5.1 deterministic operator gates (no live inspection or HTTP)', {
  skip: process.platform !== 'win32',
}, () => {
  const output = execFileSync(process.env.CY_OPERATOR_TEST_POWERSHELL ||
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', [
    '-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('tests/endpoint-ownership.test.ps1', root)),
  ], { encoding: 'utf8', timeout: 30_000 });
  assert.match(output, /TOTAL \d+ offline checks passed/);
  process.stdout.write(output);
});
test('native collection uses listener-only owner tables, never all-connection membership', () => {
  const helper = readFileSync(new URL('endpoint-ownership.ps1', root), 'utf8');
  assert.match(helper, /const int ListenerTable = 3;/);
  assert.equal((helper.match(/family, ListenerTable, 0\)/g) || []).length, 2);
  assert.match(helper, /::Read\(2\)/);
  assert.match(helper, /::Read\(23\)/);
  assert.doesNotMatch(helper, /Get-NetTCPConnection -State/);
  assert.match(helper, /CimInstanceProperties\['State'\]\.Value/);
});
test('operator has no runtime mutation or inference command and imports the reviewed helper', () => {
  const helper = readFileSync(new URL('endpoint-ownership.ps1', root), 'utf8');
  const wrapper = readFileSync(new URL('health.ps1', root), 'utf8');
  assert.match(wrapper, /\. "\$PSScriptRoot\/endpoint-ownership\.ps1"/);
  assert.doesNotMatch(helper + wrapper, /Restart-(Service|Computer)|Stop-Process|Start-Process|Set-Net|netsh|\/api\/(generate|chat)|\/v1\/chat|Set-Content|Out-File|Remove-Item/i);
  assert.equal((wrapper.match(/Invoke-RestMethod/g) || []).length, 2);
  assert.doesNotMatch(helper, /Invoke-RestMethod/);
});
test('native collector compiles on target Windows PowerShell without inspecting live sockets', {
  skip: process.platform !== 'win32',
}, () => {
  const helper = readFileSync(new URL('endpoint-ownership.ps1', root), 'utf8');
  const csharp = helper.match(/Add-Type -TypeDefinition @'\r?\n([\s\S]*?)\r?\n'@/)[1];
  const script = `\u0024ErrorActionPreference='Stop'; Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(csharp).toString('base64')}'))); 'COMPILED'`;
  const output = execFileSync(process.env.CY_OPERATOR_TEST_POWERSHELL ||
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
  ], { encoding: 'utf8', timeout: 30_000 });
  assert.match(output, /COMPILED/);
});
