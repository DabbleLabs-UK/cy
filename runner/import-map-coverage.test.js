import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Guards the stale-imported-module cache fix (index.php cy_import_map + the
// no-cache HTML document). Every statically or dynamically imported LOCAL module
// reachable from the page's entry scripts must be cache-bustable, i.e. either:
//   - it lives under a root the import map versions (assets/, components/), or
//   - it is a public-root entry script that index.php loads via cy_asset('...')
//     (which appends ?v=<mtime> to the <script src>).
// A local module that is only reached by `import` and sits at a bare, unmapped,
// non-entry URL would be served stale from cache forever - exactly the bug that
// replayed the centre timeline from London midnight. If this test fails, a new
// module escaped the cache-busting net.

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, '..', 'public');
const MAPPED_ROOTS = ['assets', 'components']; // mirrors cy_import_map() in index.php

function stripQuery(spec) {
  const q = spec.indexOf('?');
  return q === -1 ? spec : spec.slice(0, q);
}

function isLocal(spec) {
  return spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/');
}

// Resolve a local specifier (from a file) to an absolute path under public/.
function resolveLocal(fromFile, spec) {
  const bare = stripQuery(spec);
  return bare.startsWith('/') ? join(PUBLIC, bare) : resolve(dirname(fromFile), bare);
}

function importSpecifiers(src) {
  const specs = [];
  const patterns = [
    /\b(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g, // from '...'
    /\bimport\s*['"]([^'"]+)['"]/g, // side-effect: import '...'
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // dynamic import('...')
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) specs.push(m[1]);
  }
  return specs;
}

function mappedModuleKeys() {
  const keys = new Set();
  for (const root of MAPPED_ROOTS) {
    const base = join(PUBLIC, root);
    if (!existsSync(base)) continue;
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith('.js')) keys.add('/' + relative(PUBLIC, full).replace(/\\/g, '/'));
      }
    };
    walk(base);
  }
  return keys;
}

// Entry module scripts the page loads via cy_asset('...') (versioned by ?v=mtime).
function entryScripts() {
  const index = readFileSync(join(PUBLIC, 'index.php'), 'utf8');
  const out = [];
  const re = /cy_asset\(\s*'([^']+\.js)'\s*\)/g;
  let m;
  while ((m = re.exec(index)) !== null) out.push(m[1]);
  return [...new Set(out)];
}

test('cy_import_map emits a versioned HTML import map before the entry module scripts', () => {
  const index = readFileSync(join(PUBLIC, 'index.php'), 'utf8');
  const mapPos = index.indexOf('type="importmap"');
  const appPos = index.indexOf("cy_asset('assets/app.js')");
  assert.ok(mapPos !== -1, 'index.php must emit <script type="importmap">');
  assert.ok(appPos !== -1, 'index.php must load assets/app.js');
  assert.ok(mapPos < appPos, 'the import map must appear before the module scripts');
});

test('the HTML document is served no-cache so the import map is always fresh', () => {
  const index = readFileSync(join(PUBLIC, 'index.php'), 'utf8');
  assert.match(index, /header\(\s*'Cache-Control:\s*no-cache'\s*\)/,
    'index.php must send Cache-Control: no-cache so a stale page cannot pin old module URLs');
});

test('every local module in the full static+dynamic import chain is cache-bustable', () => {
  const mapped = mappedModuleKeys();
  const entries = entryScripts();
  assert.ok(entries.includes('assets/app.js'), 'app.js should be an entry script');

  const entryAbs = new Set(entries.map((e) => join(PUBLIC, e)));
  const isCovered = (absPath) => {
    const key = '/' + relative(PUBLIC, absPath).replace(/\\/g, '/');
    return mapped.has(key) || entryAbs.has(absPath);
  };

  const queue = [...entryAbs];
  const seen = new Set();
  const uncovered = [];
  const missing = [];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!existsSync(file)) { missing.push(file); continue; }
    for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (!isLocal(spec)) continue; // bare specifiers aren't local modules
      const target = resolveLocal(file, spec);
      if (!existsSync(target)) { missing.push(`${relative(PUBLIC, file)} -> ${spec}`); continue; }
      if (!isCovered(target)) uncovered.push(`${relative(PUBLIC, file)} -> ${spec}`);
      queue.push(target);
    }
  }

  assert.deepEqual(missing, [], 'every imported local specifier must resolve to an existing file');
  assert.deepEqual(uncovered, [],
    'these imported modules are neither import-map-mapped nor cy_asset entries (stale-cache gap): '
    + uncovered.join(', '));
});
