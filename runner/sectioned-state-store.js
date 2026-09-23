// sectioned-state-store.js - content-addressed, generation-committed state.
//
// Large state collections are split into immutable section blobs. A checkpoint
// becomes authoritative only when its small manifest is atomically renamed into
// place. The prior manifest remains readable for rollback, and section blobs
// referenced by either manifest are retained.

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export const SECTIONED_STORAGE_FORMAT_VERSION = 2;
export const SECTIONED_STORE_DIRECTORY = 'vitals-v2';

const INLINE_LIMIT_BYTES = 2 * 1024;
const ARRAY_MAX_CHUNK_BYTES = 32 * 1024;
const ARRAY_MAX_CHUNK_ITEMS = 128;
const ARRAY_ANCHOR_THRESHOLD = 4; // 4/256: about one stable boundary per 64 items.
const OBJECT_BUCKET_TARGET_BYTES = 16 * 1024;
const OBJECT_FIELD_SPLIT_LIMIT = 128;
const MIN_OBJECT_BUCKETS = 8;
const MAX_OBJECT_BUCKETS = 256;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

let tempSequence = 0;
let generationSequence = 0;

const byteLength = (text) => Buffer.byteLength(text, 'utf8');
const hashText = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const fileExists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

async function runHook(hooks, phase, details) {
  if (hooks && typeof hooks[phase] === 'function') return hooks[phase](details);
  return undefined;
}

async function atomicWriteJson(targetPath, text, validate, hooks = null) {
  const dir = dirname(targetPath);
  await mkdir(dir, { recursive: true });
  const tempPath = join(
    dir,
    `.${basename(targetPath)}.${process.pid}.${Date.now()}.${tempSequence++}.tmp`,
  );
  let handle = null;
  try {
    handle = await open(tempPath, 'wx');
    const override = await runHook(hooks, 'beforeWrite', { targetPath, tempPath, text, handle });
    const writeText = override && typeof override.text === 'string' ? override.text : text;
    await handle.writeFile(writeText, 'utf8');
    await runHook(hooks, 'afterWrite', { targetPath, tempPath, text: writeText, handle });
    await handle.sync();
    await handle.close();
    handle = null;
    await runHook(hooks, 'afterClose', { targetPath, tempPath });
    const candidateText = await readFile(tempPath, 'utf8');
    const candidate = JSON.parse(candidateText);
    validate(candidate, candidateText);
    await runHook(hooks, 'beforeRename', { targetPath, tempPath, candidate });
    await rename(tempPath, targetPath);
    return byteLength(writeText);
  } catch (error) {
    if (handle) {
      try { await handle.close(); } catch { /* best effort */ }
    }
    try { await unlink(tempPath); } catch { /* best effort */ }
    throw error;
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function validateBlobRef(ref, label = 'blob reference') {
  assertObject(ref, label);
  if (!HASH_PATTERN.test(ref.hash || '')) throw new Error(`${label}.hash is invalid`);
  if (!Number.isInteger(ref.bytes) || ref.bytes < 0) throw new Error(`${label}.bytes is invalid`);
  return true;
}

function validateDescriptor(descriptor, label = 'descriptor') {
  assertObject(descriptor, label);
  if (descriptor.kind === 'inline') return true;
  if (descriptor.kind === 'blob') return validateBlobRef(descriptor.ref, `${label}.ref`);
  if (descriptor.kind === 'fields') {
    assertObject(descriptor.fields, `${label}.fields`);
    for (const [key, child] of Object.entries(descriptor.fields)) {
      validateDescriptor(child, `${label}.fields.${key}`);
    }
    return true;
  }
  if (descriptor.kind === 'array') {
    if (!Number.isInteger(descriptor.length) || descriptor.length < 0) {
      throw new Error(`${label}.length is invalid`);
    }
    if (!Array.isArray(descriptor.chunks)) throw new Error(`${label}.chunks must be an array`);
    descriptor.chunks.forEach((ref, index) => validateBlobRef(ref, `${label}.chunks[${index}]`));
    return true;
  }
  if (descriptor.kind === 'object') {
    if (!Number.isInteger(descriptor.length) || descriptor.length < 0) {
      throw new Error(`${label}.length is invalid`);
    }
    if (!Number.isInteger(descriptor.bucketCount) || descriptor.bucketCount < 1) {
      throw new Error(`${label}.bucketCount is invalid`);
    }
    validateBlobRef(descriptor.order, `${label}.order`);
    if (!Array.isArray(descriptor.buckets) || descriptor.buckets.length !== descriptor.bucketCount) {
      throw new Error(`${label}.buckets is invalid`);
    }
    descriptor.buckets.forEach((ref, index) => {
      if (ref !== null) validateBlobRef(ref, `${label}.buckets[${index}]`);
    });
    return true;
  }
  throw new Error(`${label}.kind is unsupported`);
}

export function validateSectionedManifest(manifest) {
  assertObject(manifest, 'sectioned manifest');
  if (manifest.storageFormatVersion !== SECTIONED_STORAGE_FORMAT_VERSION) {
    throw new Error(`unsupported sectioned storage format ${String(manifest.storageFormatVersion)}`);
  }
  if (typeof manifest.generation !== 'string' || manifest.generation.length < 1) {
    throw new Error('sectioned manifest generation is invalid');
  }
  if (typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))) {
    throw new Error('sectioned manifest createdAt is invalid');
  }
  if (!Number.isInteger(manifest.logicalStateBytes) || manifest.logicalStateBytes < 0) {
    throw new Error('sectioned manifest logicalStateBytes is invalid');
  }
  if (!Number.isInteger(manifest.bookkeepingBytes) || manifest.bookkeepingBytes < 0) {
    throw new Error('sectioned manifest bookkeepingBytes is invalid');
  }
  validateBlobRef(manifest.layoutRef, 'sectioned manifest layoutRef');
  return true;
}

function validateLayout(layout) {
  assertObject(layout, 'sectioned layout');
  validateDescriptor(layout.state, 'sectioned layout.state');
  validateDescriptor(layout.bookkeeping, 'sectioned layout.bookkeeping');
  return true;
}

function addBlob(blobs, value) {
  const text = JSON.stringify(value);
  const hash = hashText(text);
  const ref = { hash, bytes: byteLength(text) };
  if (!blobs.has(hash)) blobs.set(hash, { ...ref, text });
  return ref;
}

function chunkArray(value, blobs) {
  const chunks = [];
  let current = [];
  let currentBytes = 2;
  for (const item of value) {
    const itemText = JSON.stringify(item);
    const itemBytes = byteLength(itemText) + (current.length > 0 ? 1 : 0);
    if (current.length > 0 && currentBytes + itemBytes > ARRAY_MAX_CHUNK_BYTES) {
      chunks.push(addBlob(blobs, current));
      current = [];
      currentBytes = 2;
    }
    current.push(item);
    currentBytes += itemBytes;
    // The boundary depends on item content rather than the item's array index.
    // A capped rolling history can therefore shift its oldest item away without
    // invalidating every later chunk. The hard limits only bound unusually long
    // runs with no natural anchor.
    const anchored = createHash('sha256').update(itemText, 'utf8').digest()[0]
      < ARRAY_ANCHOR_THRESHOLD;
    if (anchored || current.length >= ARRAY_MAX_CHUNK_ITEMS || currentBytes >= ARRAY_MAX_CHUNK_BYTES) {
      chunks.push(addBlob(blobs, current));
      current = [];
      currentBytes = 2;
    }
  }
  if (current.length > 0) chunks.push(addBlob(blobs, current));
  return { kind: 'array', length: value.length, chunks };
}

function objectBucketCount(bytes) {
  const target = Math.max(MIN_OBJECT_BUCKETS, Math.ceil(bytes / OBJECT_BUCKET_TARGET_BYTES));
  let count = 1;
  while (count < target && count < MAX_OBJECT_BUCKETS) count *= 2;
  return Math.min(MAX_OBJECT_BUCKETS, count);
}

function objectBucketIndex(key, bucketCount) {
  const digest = createHash('sha256').update(key, 'utf8').digest();
  return digest.readUInt32BE(0) % bucketCount;
}

function chunkObject(value, bytes, blobs) {
  const keys = Object.keys(value);
  const bucketCount = objectBucketCount(bytes);
  const buckets = Array.from({ length: bucketCount }, () => ({}));
  for (const key of keys) buckets[objectBucketIndex(key, bucketCount)][key] = value[key];
  return {
    kind: 'object',
    length: keys.length,
    order: addBlob(blobs, keys),
    bucketCount,
    buckets: buckets.map((bucket) => Object.keys(bucket).length > 0 ? addBlob(blobs, bucket) : null),
  };
}

function encodeValue(value, blobs, { splitFields = false } = {}) {
  const text = JSON.stringify(value);
  const bytes = byteLength(text);
  if (bytes <= INLINE_LIMIT_BYTES) return { kind: 'inline', value };
  if (Array.isArray(value)) return chunkArray(value, blobs);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (splitFields && keys.length <= OBJECT_FIELD_SPLIT_LIMIT) {
      return {
        kind: 'fields',
        fields: Object.fromEntries(
          keys.map((key) => [key, encodeValue(value[key], blobs, { splitFields: false })]),
        ),
      };
    }
    return chunkObject(value, bytes, blobs);
  }
  return { kind: 'blob', ref: addBlob(blobs, value) };
}

function encodeState(state, blobs) {
  const fields = {};
  for (const [key, value] of Object.entries(state)) {
    if (key === 'cognition' && value && typeof value === 'object' && !Array.isArray(value)) {
      fields.cognition = {
        kind: 'fields',
        fields: Object.fromEntries(
          Object.entries(value).map(([module, moduleState]) => [
            module,
            encodeValue(moduleState, blobs, { splitFields: true }),
          ]),
        ),
      };
    } else {
      fields[key] = encodeValue(value, blobs, { splitFields: true });
    }
  }
  return { kind: 'fields', fields };
}

function collectDescriptorRefs(descriptor, refs) {
  if (descriptor.kind === 'blob') refs.add(descriptor.ref.hash);
  if (descriptor.kind === 'fields') {
    for (const child of Object.values(descriptor.fields)) collectDescriptorRefs(child, refs);
  }
  if (descriptor.kind === 'array') {
    for (const ref of descriptor.chunks) refs.add(ref.hash);
  }
  if (descriptor.kind === 'object') {
    refs.add(descriptor.order.hash);
    for (const ref of descriptor.buckets) if (ref) refs.add(ref.hash);
  }
}

async function decodeValue(descriptor, readBlob) {
  if (descriptor.kind === 'inline') return descriptor.value;
  if (descriptor.kind === 'blob') return readBlob(descriptor.ref);
  if (descriptor.kind === 'fields') {
    const value = {};
    for (const [key, child] of Object.entries(descriptor.fields)) value[key] = await decodeValue(child, readBlob);
    return value;
  }
  if (descriptor.kind === 'array') {
    const value = [];
    for (const ref of descriptor.chunks) value.push(...await readBlob(ref));
    if (value.length !== descriptor.length) throw new Error('sectioned array length mismatch');
    return value;
  }
  if (descriptor.kind === 'object') {
    const order = await readBlob(descriptor.order);
    if (!Array.isArray(order) || order.length !== descriptor.length) {
      throw new Error('sectioned object key order mismatch');
    }
    const values = {};
    for (const ref of descriptor.buckets) Object.assign(values, ref ? await readBlob(ref) : {});
    const value = {};
    for (const key of order) {
      if (!Object.prototype.hasOwnProperty.call(values, key)) {
        throw new Error(`sectioned object is missing key ${key}`);
      }
      value[key] = values[key];
    }
    if (Object.keys(values).length !== descriptor.length) throw new Error('sectioned object length mismatch');
    return value;
  }
  throw new Error(`cannot decode unsupported descriptor ${String(descriptor.kind)}`);
}

function memoryBlobReader(blobs) {
  return async (ref) => {
    validateBlobRef(ref);
    const blob = blobs.get(ref.hash);
    if (!blob) throw new Error(`missing in-memory section ${ref.hash}`);
    if (blob.bytes !== ref.bytes) throw new Error(`in-memory section size mismatch ${ref.hash}`);
    return JSON.parse(blob.text);
  };
}

export async function buildSectionedCheckpoint(
  state,
  bookkeeping,
  { now = Date.now(), verifyRoundTrip = true } = {},
) {
  const blobs = new Map();
  const logicalStateText = JSON.stringify(state);
  const bookkeepingText = JSON.stringify(bookkeeping);
  const layout = {
    state: encodeState(state, blobs),
    bookkeeping: encodeValue(bookkeeping, blobs, { splitFields: true }),
  };
  validateLayout(layout);
  const manifest = {
    storageFormatVersion: SECTIONED_STORAGE_FORMAT_VERSION,
    generation: `${now}-${process.pid}-${generationSequence++}`,
    createdAt: new Date(now).toISOString(),
    logicalStateBytes: byteLength(logicalStateText),
    bookkeepingBytes: byteLength(bookkeepingText),
    layoutRef: addBlob(blobs, layout),
  };
  validateSectionedManifest(manifest);
  if (verifyRoundTrip) {
    const readBlob = memoryBlobReader(blobs);
    const decodedLayout = await readBlob(manifest.layoutRef);
    validateLayout(decodedLayout);
    const decodedState = await decodeValue(decodedLayout.state, readBlob);
    const decodedBookkeeping = await decodeValue(decodedLayout.bookkeeping, readBlob);
    if (!isDeepStrictEqual(decodedState, state) || !isDeepStrictEqual(decodedBookkeeping, bookkeeping)) {
      throw new Error('sectioned checkpoint failed semantic round-trip verification');
    }
  }
  return {
    manifest,
    manifestText: JSON.stringify(manifest),
    blobs,
    logicalStateText,
    bookkeepingText,
  };
}

export function sectionedStorePaths(legacyPath) {
  const root = join(dirname(legacyPath), SECTIONED_STORE_DIRECTORY);
  return {
    root,
    currentManifest: join(root, 'current.json'),
    previousManifest: join(root, 'previous.json'),
    sections: join(root, 'sections'),
  };
}

async function readManifest(path) {
  const text = await readFile(path, 'utf8');
  const manifest = JSON.parse(text);
  validateSectionedManifest(manifest);
  return { text, manifest };
}

async function readSection(paths, ref) {
  validateBlobRef(ref);
  const path = join(paths.sections, `${ref.hash}.json`);
  const text = await readFile(path, 'utf8');
  if (byteLength(text) !== ref.bytes) throw new Error(`section size mismatch ${ref.hash}`);
  if (hashText(text) !== ref.hash) throw new Error(`section hash mismatch ${ref.hash}`);
  return JSON.parse(text);
}

async function decodeCommitted(paths, manifest) {
  const readBlob = (ref) => readSection(paths, ref);
  const layout = await readBlob(manifest.layoutRef);
  validateLayout(layout);
  const state = await decodeValue(layout.state, readBlob);
  const bookkeeping = await decodeValue(layout.bookkeeping, readBlob);
  if (byteLength(JSON.stringify(state)) !== manifest.logicalStateBytes) {
    throw new Error('sectioned logical state size mismatch');
  }
  if (byteLength(JSON.stringify(bookkeeping)) !== manifest.bookkeepingBytes) {
    throw new Error('sectioned bookkeeping size mismatch');
  }
  return { state, bookkeeping };
}

async function collectCommittedBlobHashes(paths, manifest) {
  validateSectionedManifest(manifest);
  const refs = new Set([manifest.layoutRef.hash]);
  const layout = await readSection(paths, manifest.layoutRef);
  validateLayout(layout);
  collectDescriptorRefs(layout.state, refs);
  collectDescriptorRefs(layout.bookkeeping, refs);
  return refs;
}

export class SectionedStateStore {
  constructor(legacyPath, { hooks = null, now = Date.now } = {}) {
    this.paths = sectionedStorePaths(legacyPath);
    this.hooks = hooks;
    this.now = typeof now === 'function' ? now : Date.now;
    this.currentManifestText = null;
    this.currentManifest = null;
    this.loadedFrom = null;
  }

  async load({ validateState, validateBookkeeping }) {
    const evidence = await fileExists(this.paths.currentManifest)
      || await fileExists(this.paths.previousManifest)
      || await fileExists(this.paths.sections);
    const errors = [];
    for (const [source, path] of [
      ['current', this.paths.currentManifest],
      ['previous', this.paths.previousManifest],
    ]) {
      if (!(await fileExists(path))) continue;
      try {
        const { text, manifest } = await readManifest(path);
        const decoded = await decodeCommitted(this.paths, manifest);
        validateState(decoded.state);
        validateBookkeeping(decoded.bookkeeping);
        this.currentManifestText = text;
        this.currentManifest = manifest;
        this.loadedFrom = source;
        try { await this.cleanup(); } catch { /* valid state must not be blocked by cleanup */ }
        return { ...decoded, manifest, manifestText: text, source, evidence, errors };
      } catch (error) {
        errors.push(`${source}: ${error && error.message ? error.message : String(error)}`);
      }
    }
    return { state: null, bookkeeping: null, manifest: null, manifestText: null, source: null, evidence, errors };
  }

  async writeBlob(blob, index, total) {
    await mkdir(this.paths.sections, { recursive: true });
    const targetPath = join(this.paths.sections, `${blob.hash}.json`);
    if (await fileExists(targetPath)) {
      try {
        const text = await readFile(targetPath, 'utf8');
        if (byteLength(text) === blob.bytes && hashText(text) === blob.hash) {
          return { written: false, bytes: 0, targetPath };
        }
      } catch {
        // Rewrite the corrupted candidate atomically below.
      }
    }
    await runHook(this.hooks, 'beforeSectionWrite', { targetPath, blob, index, total });
    const bytes = await atomicWriteJson(
      targetPath,
      blob.text,
      (_value, candidateText) => {
        if (byteLength(candidateText) !== blob.bytes || hashText(candidateText) !== blob.hash) {
          throw new Error(`section verification failed ${blob.hash}`);
        }
      },
      this.hooks,
    );
    await runHook(this.hooks, 'afterSectionWrite', { targetPath, blob, index, total });
    return { written: true, bytes, targetPath };
  }

  async commit(state, bookkeeping, { validateState, validateBookkeeping }) {
    validateState(state);
    validateBookkeeping(bookkeeping);
    const started = this.now();
    // The first V2 checkpoint is the migration boundary, so prove a complete
    // semantic round trip before committing it. Later checkpoints use the same
    // tested encoder and are verified from disk on every restart; decoding the
    // entire multi-megabyte state on every ordinary save would add needless CPU.
    const built = await buildSectionedCheckpoint(state, bookkeeping, {
      now: started,
      verifyRoundTrip: this.currentManifest === null,
    });
    let bytesWritten = 0;
    let sectionWriteCount = 0;
    let changedSectionBytes = 0;
    let largestWriteBytes = 0;
    const blobs = [...built.blobs.values()];
    for (let index = 0; index < blobs.length; index++) {
      const result = await this.writeBlob(blobs[index], index, blobs.length);
      if (result.written) {
        sectionWriteCount++;
        bytesWritten += result.bytes;
        changedSectionBytes += result.bytes;
        largestWriteBytes = Math.max(largestWriteBytes, result.bytes);
      }
    }

    await mkdir(this.paths.root, { recursive: true });
    const priorManifestText = this.currentManifestText;
    if (priorManifestText) {
      bytesWritten += await atomicWriteJson(
        this.paths.previousManifest,
        priorManifestText,
        validateSectionedManifest,
        this.hooks,
      );
      largestWriteBytes = Math.max(largestWriteBytes, byteLength(priorManifestText));
    }

    await runHook(this.hooks, 'beforeManifestCommit', {
      targetPath: this.paths.currentManifest,
      manifest: built.manifest,
      manifestText: built.manifestText,
    });
    bytesWritten += await atomicWriteJson(
      this.paths.currentManifest,
      built.manifestText,
      validateSectionedManifest,
      this.hooks,
    );
    largestWriteBytes = Math.max(largestWriteBytes, byteLength(built.manifestText));
    // The current-manifest rename is the atomic commit point. Update the
    // in-process view immediately so a later rollback-copy or cleanup failure
    // cannot make a retry treat this committed generation as absent.
    this.currentManifestText = built.manifestText;
    this.currentManifest = built.manifest;
    this.loadedFrom = 'current';
    if (!priorManifestText) {
      bytesWritten += await atomicWriteJson(
        this.paths.previousManifest,
        built.manifestText,
        validateSectionedManifest,
        this.hooks,
      );
      largestWriteBytes = Math.max(largestWriteBytes, byteLength(built.manifestText));
    }
    await runHook(this.hooks, 'afterManifestCommit', {
      targetPath: this.paths.currentManifest,
      manifest: built.manifest,
    });

    const cleanup = await this.cleanup();
    const completed = this.now();
    return {
      generation: built.manifest.generation,
      stateSizeBytes: built.manifest.logicalStateBytes,
      manifestSizeBytes: byteLength(built.manifestText),
      sectionWriteCount,
      changedSectionBytes,
      bytesWritten,
      largestWriteBytes,
      durationMs: Math.max(0, completed - started),
      cleanup,
      manifest: built.manifest,
      logicalStateText: built.logicalStateText,
      bookkeepingText: built.bookkeepingText,
    };
  }

  async cleanup() {
    await runHook(this.hooks, 'beforeCleanup', { paths: this.paths });
    const referenced = new Set();
    for (const path of [this.paths.currentManifest, this.paths.previousManifest]) {
      if (!(await fileExists(path))) continue;
      try {
        const { manifest } = await readManifest(path);
        for (const hash of await collectCommittedBlobHashes(this.paths, manifest)) referenced.add(hash);
      } catch {
        // Never delete sections based on an invalid manifest.
        return { removed: 0, retained: 0, skipped: true };
      }
    }
    let names = [];
    try {
      names = await readdir(this.paths.sections);
    } catch (error) {
      if (error && error.code === 'ENOENT') return { removed: 0, retained: 0, skipped: false };
      throw error;
    }
    let removed = 0;
    let retained = 0;
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const hash = name.slice(0, -5);
      if (referenced.has(hash)) {
        retained++;
        continue;
      }
      const targetPath = join(this.paths.sections, name);
      await runHook(this.hooks, 'beforeCleanupDelete', { targetPath, removed, retained });
      await unlink(targetPath);
      removed++;
      await runHook(this.hooks, 'afterCleanupDelete', { targetPath, removed, retained });
    }
    await runHook(this.hooks, 'afterCleanup', { paths: this.paths, removed, retained });
    return { removed, retained, skipped: false };
  }

  async diskUsage() {
    let bytes = 0;
    let files = 0;
    for (const path of [this.paths.currentManifest, this.paths.previousManifest]) {
      try {
        bytes += (await stat(path)).size;
        files++;
      } catch { /* absent */ }
    }
    try {
      for (const name of await readdir(this.paths.sections)) {
        if (!name.endsWith('.json')) continue;
        bytes += (await stat(join(this.paths.sections, name))).size;
        files++;
      }
    } catch { /* absent */ }
    return { bytes, files };
  }
}
