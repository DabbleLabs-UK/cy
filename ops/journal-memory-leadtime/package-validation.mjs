// Operator files only. This does not build a memory/runtime payload or deploy.
import { copyFileSync, readFileSync, constants } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const here = dirname(fileURLToPath(import.meta.url));
export function packageValidationOperators(outputDirectory) {
  const files = [
    ['server-operator.php', join(here, 'server-operator.php')],
    ['probe.php', join(here, '../php-validation/probe.php')],
    ['php-validation-client.php', join(here, '../php-validation/client.php')],
  ];
  return files.map(([path, source]) => {
    const target = join(outputDirectory, path);
    copyFileSync(source, target, constants.COPYFILE_EXCL);
    const sha = bytes => createHash('sha256').update(bytes).digest('hex');
    const hash = sha(readFileSync(source));
    assert.equal(sha(readFileSync(target)), hash);
    return { path, hash };
  });
}
