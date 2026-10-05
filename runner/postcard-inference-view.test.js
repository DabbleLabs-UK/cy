import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PostcardInference, costBuckets, costChart, inferenceStatus, INFERENCE_RANGES } from '../public/postcard-inference.js';

const base = Date.parse('2026-10-05T00:00:00Z');
const bucket = (offset, cost = 0.001) => ({ at: new Date(base + offset * 60000).toISOString(), estimated_gbp: cost, requests: 1 });

function fixture() {
  const nodes = new Map();
  const ranges = INFERENCE_RANGES.map(range => ({ dataset: { range }, attributes: {}, addEventListener() {}, setAttribute(key, value) { this.attributes[key] = value; } }));
  const root = {
    innerHTML: '', closest: () => ({ open: true, addEventListener() {} }), querySelectorAll: () => ranges,
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', querySelector: () => null });
      return nodes.get(selector);
    },
  };
  const data = { ok: true, can_admin: false, settings: { enabled: false, route: 'AUTO', gbp_hour: 0.1, gbp_day: 1, gbp_month: 10 }, status: {}, totals: { requests: 2, mean_latency_ms: 1250, latency_ms: 2500 }, buckets: [bucket(0)], windows: { hour: { estimated_gbp: 0.03, uncertain_gbp: 0.02, requests: 2 } } };
  return { root, nodes, ranges, data };
}

test('cost buckets preserve all costs and bound graph size without interpolation', () => {
  const input = Array.from({ length: 500 }, (_, i) => bucket(i));
  const result = costBuckets([...input].reverse());
  assert.ok(result.length <= 120);
  assert.ok(Math.abs(result.reduce((sum, item) => sum + item.estimated_gbp, 0) - 0.5) < 1e-10);
  assert.equal(result.reduce((sum, item) => sum + item.requests, 0), 500);
  assert.equal(result[0].at, base);
  const chart = costChart([bucket(0), bucket(10)]);
  assert.match(chart, /<rect /);
  assert.doesNotMatch(chart, /<path|<polyline/);
  assert.match(chart, /No interpolation between calls/);
  assert.match(costChart([]), /No recorded inference/);
  const uncertain = costChart([{ ...bucket(0, 0.03), uncertain_gbp: 0.02 }]);
  const heights = [...uncertain.matchAll(/height="([0-9.]+)"/g)].map(match => Number(match[1]));
  assert.ok(Math.abs(heights.reduce((sum, value) => sum + value, 0) - 84) < 0.000001,
    'unresolved cost is a subset of estimated total, never counted twice');
});

test('invalid bucket timestamps are ignored and duplicate bucket totals are combined', () => {
  const result = costBuckets([bucket(0), bucket(0), { at: 'bad', estimated_gbp: 999 }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].estimated_gbp, 0.002);
  assert.equal(result[0].requests, 2);
});

test('public view shows aggregated accounting and cannot submit settings', async () => {
  const { root, nodes, data } = fixture();
  let calls = 0;
  const panel = new PostcardInference(root, { fetcher: async () => { calls++; return { ok: true, json: async () => data }; } });
  await panel.refresh();
  assert.equal(panel.canAdmin, false);
  assert.equal(nodes.get('.pci-admin').innerHTML, '');
  assert.match(nodes.get('.pci-current').innerHTML, /30% of GBP 0.1000 cap/);
  assert.match(nodes.get('.pci-current').innerHTML, /awaiting selection/);
  assert.doesNotMatch(nodes.get('.pci-current').innerHTML, /AUTO \/ local/);
  assert.match(nodes.get('.pci-totals').innerHTML, /1.3s/);
  await panel.save(null);
  assert.equal(calls, 1, 'public writes never leave the panel');
  assert.match(root.innerHTML, /aria-label="Inference history range"/);
  assert.match(root.innerHTML, /aria-live="polite"/);
});

test('default browser fetch retains the Window receiver rather than the panel instance', async () => {
  const { root, nodes, data } = fixture();
  const original = globalThis.fetch;
  globalThis.fetch = async function () {
    assert.equal(this, globalThis, 'native browser fetch rejects an unrelated receiver');
    return { ok: true, json: async () => data };
  };
  try {
    await new PostcardInference(root).refresh();
    assert.equal(nodes.get('.pci-state').textContent, 'Cloud disabled - local replies');
    assert.match(nodes.get('.pci-current').innerHTML, /30% of GBP 0.1000 cap/);
  } finally { globalThis.fetch = original; }
});

test('admin controls require explicit server authorization and preserve unsaved edits on refresh', () => {
  const { root, nodes, data } = fixture();
  const panel = new PostcardInference(root);
  panel.render(data);
  const admin = nodes.get('.pci-admin');
  let bound = 0;
  admin.querySelector = () => ({ addEventListener() { bound++; } });
  panel.render({ ...data, can_admin: true }, true);
  assert.match(admin.innerHTML, /name="enabled"/);
  assert.match(admin.innerHTML, /name="gbp_month"/);
  assert.equal(bound, 1);
  admin.innerHTML = 'unsaved form';
  panel.render({ ...data, can_admin: true });
  assert.equal(admin.innerHTML, 'unsaved form');
  panel.render({ ...data, can_admin: 'true' });
  assert.equal(admin.innerHTML, '', 'a truthy string is not admin authorization');
});

test('late history responses cannot replace a newly selected range', async () => {
  const { root, nodes, data } = fixture();
  const requests = [];
  const panel = new PostcardInference(root, { fetcher: () => new Promise(resolve => requests.push(resolve)) });
  const old = panel.refresh();
  panel.range = '1H';
  const recent = panel.refresh();
  requests[1]({ ok: true, json: async () => ({ ...data, status: { model: 'new range' } }) });
  await recent;
  requests[0]({ ok: true, json: async () => ({ ...data, status: { model: 'old range' } }) });
  await old;
  assert.match(nodes.get('.pci-current').innerHTML, /new range/);
  assert.doesNotMatch(nodes.get('.pci-current').innerHTML, /old range/);
});

test('server strings cannot inject markup and failures keep explicit stale-state notice', async () => {
  const { root, nodes, data } = fixture();
  const panel = new PostcardInference(root, { fetcher: async () => { throw new Error('private stack'); } });
  panel.render({ ...data, status: { model: '<img src=x onerror=alert(1)>' } });
  assert.doesNotMatch(nodes.get('.pci-current').innerHTML, /<img/);
  await panel.refresh();
  assert.match(nodes.get('.pci-state').textContent, /unavailable.*out of date/);
  assert.doesNotMatch(nodes.get('.pci-state').textContent, /private stack/);
  assert.equal(inferenceStatus({ settings: { enabled: true, route: 'DEEPSEEK' }, status: { reason: 'credentials_missing' } }), 'Cloud credentials missing');
});

test('panel is collapsed by default and its layout remains contained at mobile widths', async () => {
  const index = await readFile(new URL('../public/index.php', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/postcard-inference.css', import.meta.url), 'utf8');
  assert.match(index, /<details class="panel panel-collapsible">\s*<summary[^>]*>POSTCARD INFERENCE<\/summary>/);
  assert.match(css, /max-width: 420px/);
  assert.match(css, /minmax\(0, 1fr\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /width: 100%/);
});
