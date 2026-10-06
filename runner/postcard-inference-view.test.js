import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PostcardInference, costBuckets, costChart, inferenceStatus, settingsMarkup, INFERENCE_RANGES } from '../public/postcard-inference.js';

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
  assert.match(index, /id="postcard-reply-inference"/);
  assert.match(index, /id="postcard-memory-inference"/);
  assert.match(index, /aria-labelledby="postcard-reply-heading"/);
  assert.match(index, /aria-labelledby="postcard-memory-heading"/);
});

const memoryData = data => ({ ...data,
  settings: { mode: 'DEEPSEEK', concurrency: 1, requests_hour: 20, requests_day: 100,
    requests_month: 1000, gbp_hour: 0.05, gbp_day: 0.25, gbp_month: 2 },
  status: { mode: 'DEEPSEEK', provider: 'deepseek', configured_model: 'deepseek-v4-flash', actual_model: 'actual-model', reason: 'generated' },
  totals: { requests: 6, cloud_requests: 5, local_requests: 1, formed: 1, updated: 2, resolved: 1, nothing: 1,
    held: 3, invalid: 1, failures: 1, input_tokens: 800, output_tokens: 80, cached_tokens: 600, uncached_tokens: 200,
    mean_latency_ms: 1500 }, pending_count: 3, oldest_pending_age_seconds: 121,
});

test('memory view reports independent mode, models, decisions, backlog and cached usage without private records', async () => {
  const { root, nodes, data } = fixture();
  const value = memoryData(data);
  value.private_text = 'PRIVATE SOURCE TEXT';
  value.recent = [{ text: 'PRIVATE SOURCE TEXT' }];
  const calls = [];
  const panel = new PostcardInference(root, { kind: 'memory', fetcher: async (...args) => {
    calls.push(args); return { ok: true, json: async () => value };
  } });
  await panel.refresh();
  assert.equal(calls[0][0], 'api/memory-formation-inference.php?range=24H');
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.match(nodes.get('.pci-current').innerHTML, /60% of GBP 0.0500 cap/);
  assert.match(nodes.get('.pci-current').innerHTML, /Configured: deepseek-v4-flash/);
  assert.match(nodes.get('.pci-current').innerHTML, /Last actual model: actual-model/);
  assert.match(nodes.get('.pci-current').innerHTML, /independent caps/);
  assert.match(nodes.get('.pci-current').innerHTML, /UTC/);
  assert.match(nodes.get('.pci-totals').innerHTML, /completed decisions<\/dt><dd>5/);
  assert.match(nodes.get('.pci-totals').innerHTML, /1 \/ 2 \/ 1 \/ 1/);
  assert.match(nodes.get('.pci-totals').innerHTML, /3 \/ 3m/);
  assert.match(nodes.get('.pci-totals').innerHTML, /600 \/ 200/);
  assert.doesNotMatch([...nodes.values()].map(node => node.innerHTML).join(''), /PRIVATE SOURCE TEXT/);
  assert.equal(nodes.get('.pci-admin').innerHTML, '');
  await panel.save(null);
  assert.equal(calls.length, 1, 'public memory viewer cannot initiate settings write');
});

test('memory controls use explicit mode and never inherit reply AUTO or enabled semantics', () => {
  const markup = settingsMarkup(memoryData({}).settings, 'memory');
  assert.match(markup, /name="mode"/);
  assert.match(markup, />DEEPSEEK<|>LOCAL<|>OFF</);
  assert.doesNotMatch(markup, /name="enabled"|name="route"|>AUTO</);
  assert.match(markup, /does not fall back locally/);
  assert.match(markup, /OFF leaves sources queued/);
  assert.match(markup, /name="requests_hour"[^>]*value="20"/);
  assert.match(markup, /name="gbp_hour"[^>]*value="0.05"/);
  assert.equal(inferenceStatus({ settings: { mode: 'OFF' } }, 'memory'), 'Memory formation off - sources remain queued');
  assert.equal(inferenceStatus({ settings: { mode: 'LOCAL' } }, 'memory'), 'Local memory formation');
  assert.match(inferenceStatus({ settings: { mode: 'DEEPSEEK' }, status: { reason: 'hour_spend_cap' } }, 'memory'), /held - hourly spend cap/);
  assert.doesNotMatch(inferenceStatus({ settings: { mode: 'DEEPSEEK' }, status: { reason: 'PRIVATE ERROR' } }, 'memory'), /PRIVATE ERROR/);
});

test('two sections retain independent budgets, ranges, permissions and failed refresh state', async () => {
  const reply = fixture(), memory = fixture();
  const replyPanel = new PostcardInference(reply.root, { fetcher: async () => ({ ok: true, json: async () => reply.data }) });
  const memoryPanel = new PostcardInference(memory.root, { kind: 'memory', fetcher: async () => { throw new Error('offline'); } });
  replyPanel.range = '1H';
  memoryPanel.range = '30D';
  memoryPanel.render(memoryData(memory.data));
  await replyPanel.refresh();
  await memoryPanel.refresh();
  assert.match(reply.nodes.get('.pci-current').innerHTML, /30% of GBP 0.1000 cap/);
  assert.match(memory.nodes.get('.pci-current').innerHTML, /60% of GBP 0.0500 cap/);
  assert.match(reply.nodes.get('.pci-totals').innerHTML, /1H replies published/);
  assert.match(memory.nodes.get('.pci-totals').innerHTML, /30D completed decisions/);
  assert.doesNotMatch(reply.nodes.get('.pci-state').textContent, /unavailable/);
  assert.match(memory.nodes.get('.pci-state').textContent, /out of date/);
  memoryPanel.canAdmin = true;
  assert.equal(replyPanel.canAdmin, false, 'memory permission does not authorize reply settings');
});

test('memory history race uses newest response and escapes model names instead of exposing markup', async () => {
  const { root, nodes, data } = fixture();
  const pending = [];
  const panel = new PostcardInference(root, { kind: 'memory', fetcher: () => new Promise(resolve => pending.push(resolve)) });
  const old = panel.refresh();
  panel.range = 'ALL';
  const newer = panel.refresh();
  const current = memoryData(data);
  current.status.actual_model = '<script>private()</script>';
  pending[1]({ ok: true, json: async () => current }); await newer;
  pending[0]({ ok: true, json: async () => ({ ...memoryData(data), pending_count: 999 }) }); await old;
  assert.doesNotMatch(nodes.get('.pci-current').innerHTML, /<script>/);
  assert.match(nodes.get('.pci-current').innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch(nodes.get('.pci-totals').innerHTML, /999/);
  assert.match(nodes.get('.pci-totals').innerHTML, /ALL completed decisions/);
});

test('memory save only sends its own settings, invalidates old GET and respects revoked permission', async () => {
  const { root, nodes, data } = fixture();
  const value = memoryData(data), pending = [], calls = [];
  const panel = new PostcardInference(root, { kind: 'memory', fetcher: (...args) => {
    calls.push(args); return new Promise(resolve => pending.push(resolve));
  } });
  panel.canAdmin = true;
  const old = panel.refresh();
  const submit = { disabled: false };
  const form = { elements: Object.fromEntries(Object.entries(value.settings).map(([key, item]) => [key, { value: String(item) }])), querySelector: () => submit };
  const saving = panel.save(form);
  assert.equal(submit.disabled, true);
  await panel.refresh(); await panel.save(form);
  assert.equal(calls.length, 2, 'polling and repeated submit cannot race a save');
  assert.equal(calls[1][0], 'api/memory-formation-inference.php?range=24H');
  assert.equal(calls[1][1].credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[1][1].body), { action: 'settings', settings: value.settings });
  pending[1]({ ok: true, json: async () => ({ ...value, can_admin: false }) }); await saving;
  pending[0]({ ok: true, json: async () => ({ ...value, can_admin: true }) }); await old;
  assert.equal(panel.canAdmin, false);
  assert.equal(nodes.get('.pci-admin').innerHTML, '');
  assert.equal(submit.disabled, false);
  await panel.save(form);
  assert.equal(calls.length, 2);
});

test('memory polling preserves form edits and saving preserves expanded settings and keyboard focus', () => {
  const { root, nodes, data } = fixture();
  const panel = new PostcardInference(root, { kind: 'memory' });
  panel.render(memoryData(data));
  const admin = nodes.get('.pci-admin');
  let focused = 0;
  const details = { open: true };
  const input = { name: 'gbp_day', focus() { focused++; } };
  const form = { addEventListener() {} };
  admin.querySelector = selector => selector === 'form' ? form : selector === 'details' ? details : input;
  admin.contains = element => element === input;
  root.ownerDocument = { activeElement: input };
  admin.innerHTML = 'unsaved values';
  panel.render({ ...memoryData(data), can_admin: true });
  assert.equal(admin.innerHTML, 'unsaved values');
  assert.equal(focused, 0, 'polling never moves keyboard focus');
  panel.render({ ...memoryData(data), can_admin: true }, true);
  assert.match(admin.innerHTML, /Memory inference settings/);
  assert.equal(details.open, true);
  assert.equal(focused, 1, 'focused control is restored following authorized save');
});
