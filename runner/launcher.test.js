import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hidden = readFileSync(join(here, 'cy-hidden.vbs'), 'utf8');
const supervisor = readFileSync(join(here, 'cy-supervisor.bat'), 'utf8');

assert.doesNotMatch(hidden, /\r(?!\n)/, 'launcher contains no embedded carriage returns');
assert.match(hidden, /WScript\.ScriptFullName/, 'launcher resolves its own checkout');
assert.match(hidden, /cy-supervisor\.bat/, 'launcher starts the supervised process');
assert.doesNotMatch(hidden, /[A-Z]:\\cy/i, 'launcher has no checkout-specific drive path');
assert.doesNotMatch(hidden, /C:\\dev\\cy/i, 'launcher has no Dell-specific checkout path');

assert.match(supervisor, /^:loop$/m, 'supervisor has a restart loop');
assert.match(supervisor, /node runner\\run\.js/, 'supervisor runs Cy');
assert.match(supervisor, /goto loop/, 'supervisor restarts after exit');
assert.match(supervisor, /timeout \/t 15/, 'supervisor backs off before restart');
assert.match(supervisor, /run\.out\.log/, 'supervisor preserves a runner log');

console.log('launcher.test.js: all checks passed');
