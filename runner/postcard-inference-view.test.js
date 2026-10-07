import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PostcardInference, attentionMarkup, budgetMarkup, costBuckets, costChart, detailMarkup, inferenceStatus, readableCost, routeLabel, settingsMarkup, statusLabel, summaryMarkup, INFERENCE_RANGES } from '../public/postcard-inference.js';

const base = Date.parse('2026-10-05T00:00:00Z');
const bucket = (offset, cost = 0.001) => ({ at: new Date(base + offset * 60000).toISOString(), estimated_gbp: cost, requests: 1 });

function fixture() {
  const nodes = new Map();
  const ranges = INFERENCE_RANGES.map(range => ({ dataset: { range }, attributes: {}, addEventListener() {}, setAttribute(key, value) { this.attributes[key] = value; } }));
  const root = {
    innerHTML: '', closest: () => ({ open: true, addEventListener() {} }), querySelectorAll: () => ranges,
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, {
        innerHTML: '', textContent: '', attributes: {}, querySelector: () => null,
        setAttribute(key, value) { this.attributes[key] = value; },
        removeAttribute(key) { delete this.attributes[key]; },
      });
      return nodes.get(selector);
    },
  };
  const data = { ok: true, can_admin: false, settings: { enabled: false, route: 'AUTO', requests_hour: 20, requests_day: 100, requests_month: 1000, gbp_hour: 0.1, gbp_day: 1, gbp_month: 10 }, status: {}, totals: { published: 1, estimated_gbp: 0.04, requests: 2, mean_latency_ms: 1250, latency_ms: 2500 }, buckets: [bucket(0)], windows: { hour: { estimated_gbp: 0.03, uncertain_gbp: 0.02, requests: 2 } } };
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
  assert.match(nodes.get('.pci-current').innerHTML, /Replies published<\/dt><dd>1/);
  assert.match(nodes.get('.pci-current').innerHTML, /Est\. cloud spend<\/dt><dd>4\.00p/);
  assert.match(nodes.get('.pci-budgets').innerHTML, /GBP 0\.0300<small>\/ GBP 0\.1000/);
  assert.equal(nodes.get('.pci-route').textContent, 'Local model');
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
    assert.equal(nodes.get('.pci-state').textContent, 'Cloud replies disabled; replies use the local model.');
    assert.match(nodes.get('.pci-budgets').innerHTML, /GBP 0\.0300<small>\/ GBP 0\.1000/);
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
  assert.match(nodes.get('.pci-totals').innerHTML, /new range/);
  assert.doesNotMatch(nodes.get('.pci-totals').innerHTML, /old range/);
  assert.match(nodes.get('.pci-current').innerHTML, /Last hour/);
  assert.equal(panel.range, '1H');
});

test('server strings cannot inject markup and failures keep explicit stale-state notice', async () => {
  const { root, nodes, data } = fixture();
  const panel = new PostcardInference(root, { fetcher: async () => { throw new Error('private stack'); } });
  panel.render({ ...data, status: { model: '<img src=x onerror=alert(1)>' } });
  assert.doesNotMatch(nodes.get('.pci-totals').innerHTML, /<img/);
  assert.match(nodes.get('.pci-totals').innerHTML, /&lt;img/);
  const current = nodes.get('.pci-current').innerHTML;
  await panel.refresh();
  assert.match(nodes.get('.pci-state').textContent, /unavailable.*out of date/);
  assert.equal(nodes.get('.pci-state').attributes['data-stale'], 'true');
  assert.equal(nodes.get('.pci-current').innerHTML, current, 'last successful figures remain visible with a stale notice');
  assert.doesNotMatch(nodes.get('.pci-state').textContent, /private stack/);
  panel.fetcher = async () => ({ ok: true, json: async () => data });
  await panel.refresh();
  assert.equal(nodes.get('.pci-state').textContent, 'Cloud replies disabled; replies use the local model.');
  assert.equal(nodes.get('.pci-state').attributes['data-stale'], undefined);
  assert.equal(inferenceStatus({ settings: { enabled: true, route: 'DEEPSEEK' }, status: { reason: 'credentials_missing' } }), 'Cloud credentials missing');
});

test('panel is collapsed by default and its layout remains contained at mobile widths', async () => {
  const { root } = fixture();
  new PostcardInference(root);
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
  assert.match(root.innerHTML, /<details class="pci-details"><summary>Usage &amp; limits<\/summary>/);
  assert.doesNotMatch(root.innerHTML, /<details[^>]*\bopen\b/);
  const disclosure = root.innerHTML.match(/<details class="pci-details">([\s\S]*?)<\/details>/)[1];
  for (const name of ['pci-budgets', 'pci-ranges', 'pci-graph', 'pci-totals']) assert.match(disclosure, new RegExp(`class="${name}"`));
  assert.doesNotMatch(disclosure, /class="pci-current"|class="pci-attention"/);
  assert.doesNotMatch(settingsMarkup(memoryData({}).settings, 'memory'), /<details[^>]*\bopen\b/);
});

const memoryData = data => ({ ...data,
  settings: { mode: 'DEEPSEEK', concurrency: 1, requests_hour: 20, requests_day: 100,
    requests_month: 1000, gbp_hour: 0.05, gbp_day: 0.25, gbp_month: 2 },
  pricing: { model: 'deepseek-v4-flash' },
  status: { mode: 'DEEPSEEK', provider: 'deepseek', configured_model: 'deepseek-v4-flash', actual_model: 'actual-model', reason: 'generated' },
  totals: { requests: 6, cloud_requests: 5, local_requests: 1, estimated_gbp: 0.04, formed: 1, updated: 2, resolved: 1, nothing: 1,
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
  assert.match(nodes.get('.pci-budgets').innerHTML, /GBP 0\.0300<small>\/ GBP 0\.0500/);
  assert.match(nodes.get('.pci-budgets').innerHTML, /Separate cloud budgets for replies and memory/);
  assert.match(nodes.get('.pci-budgets').innerHTML, /Today UTC/);
  assert.equal(nodes.get('.pci-route').textContent, 'DeepSeek only');
  assert.equal(nodes.get('.pci-state').textContent, 'Last recorded: Memory decision generated');
  assert.match(nodes.get('.pci-current').innerHTML, /Decisions completed<\/dt><dd>5/);
  assert.match(nodes.get('.pci-attention').innerHTML, /3 sources waiting/);
  assert.match(nodes.get('.pci-attention').innerHTML, /oldest 3m/);
  assert.match(nodes.get('.pci-totals').innerHTML, /Configured cloud model<\/dt><dd>deepseek-v4-flash/);
  assert.match(nodes.get('.pci-totals').innerHTML, /Last actual model<\/dt><dd>actual-model/);
  assert.match(nodes.get('.pci-totals').innerHTML, /Cached input<\/dt><dd>600/);
  assert.match(nodes.get('.pci-totals').innerHTML, /Uncached input<\/dt><dd>200/);
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
  assert.match(reply.nodes.get('.pci-budgets').innerHTML, /GBP 0\.0300<small>\/ GBP 0\.1000/);
  assert.match(memory.nodes.get('.pci-budgets').innerHTML, /GBP 0\.0300<small>\/ GBP 0\.0500/);
  assert.match(reply.nodes.get('.pci-current').innerHTML, /Last hour/);
  assert.match(memory.nodes.get('.pci-current').innerHTML, /Last 30 days/);
  assert.match(reply.nodes.get('.pci-totals').innerHTML, /Last hour - outcomes/);
  assert.match(memory.nodes.get('.pci-totals').innerHTML, /Last 30 days - outcomes/);
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
  assert.doesNotMatch(nodes.get('.pci-totals').innerHTML, /<script>/);
  assert.match(nodes.get('.pci-totals').innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch(nodes.get('.pci-totals').innerHTML, /999/);
  assert.doesNotMatch(nodes.get('.pci-attention').innerHTML, /999/);
  assert.match(nodes.get('.pci-current').innerHTML, /All time/);
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
  form.elements.enabled = { checked: true };
  form.elements.route = { value: 'AUTO' };
  form.elements.private_text = { value: 'PRIVATE SOURCE TEXT' };
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
  assert.match(admin.innerHTML, /Memory settings/);
  assert.equal(details.open, true);
  assert.equal(focused, 1, 'focused control is restored following authorized save');
});

test('both summaries expose exactly output count and estimated spend without technical statistics', () => {
  const { data } = fixture();
  const value = memoryData(data);
  value.totals.published = 9;
  value.totals.uncertain_gbp = 0.02;
  for (const [kind, label, completed] of [['reply', 'Replies published', '9'], ['memory', 'Decisions completed', '5']]) {
    const markup = summaryMarkup(value, kind, '24H');
    assert.deepEqual([...markup.matchAll(/<dt>(.*?)<\/dt>/g)].map(match => match[1]), [label, 'Est. cloud spend']);
    assert.deepEqual([...markup.matchAll(/<dd>(.*?)<\/dd>/g)].map(match => match[1]), [completed, '4.00p']);
    assert.match(markup, /Last 24 hours/);
    assert.doesNotMatch(markup, /tokens|cached|requests|latency|model|provider|cap|USD|conversion|failures|held|600|800|actual-model|deepseek-v4-flash/i);
    assert.doesNotMatch(markup, /6\.00p/, 'unresolved cost is already included in estimated spend');
  }
});

test('details name every outcome and token count instead of showing slash-separated numbers', () => {
  const { data } = fixture();
  const value = memoryData(data);
  value.totals.application_conflicts = 4;
  const memory = detailMarkup(value, 'memory', '30D');
  for (const [label, count] of [['New memories', 1], ['Updated memories', 2], ['Topics resolved', 1], ['No memory needed', 1], ['Failed requests', 1], ['Invalid decisions', 1], ['Held requests', 3], ['Update conflicts', 4], ['Cached input', 600], ['Uncached input', 200], ['Sources waiting now', 3]]) {
    assert.ok(memory.includes(`<dt>${label}</dt><dd>${count}</dd>`), `${label} has its own named row`);
  }
  assert.match(memory, /Oldest waiting source<\/dt><dd>3m/);
  assert.doesNotMatch(memory, /\d+ \/ \d+/);
  const reply = detailMarkup({ ...data, totals: { published: 4, fallbacks: 3, failures: 2, validation_failures: 1 } }, 'reply', '1H');
  for (const [label, count] of [['Replies published', 4], ['Local fallbacks', 3], ['Failed requests', 2], ['Rejected replies', 1]]) {
    assert.ok(reply.includes(`<dt>${label}</dt><dd>${count}</dd>`));
  }
  const empty = detailMarkup({ pending_count: 0, oldest_pending_age_seconds: null }, 'memory', 'ALL');
  assert.match(empty, /Sources waiting now<\/dt><dd>0/);
  assert.match(empty, /Oldest waiting source<\/dt><dd>None/);
});

test('history selections change summaries while cloud budgets keep their independent UTC windows', () => {
  const { root, nodes, ranges, data } = fixture();
  const panel = new PostcardInference(root, { kind: 'memory' });
  const value = memoryData(data);
  const expected = budgetMarkup(value.settings, value.windows);
  for (const [range, label] of [['1H', 'Last hour'], ['24H', 'Last 24 hours'], ['30D', 'Last 30 days'], ['ALL', 'All time']]) {
    panel.range = range;
    panel.render(value);
    assert.match(nodes.get('.pci-current').innerHTML, new RegExp(label));
    assert.equal(nodes.get('.pci-budgets').innerHTML, expected);
    assert.deepEqual(ranges.filter(button => button.attributes['aria-pressed'] === 'true').map(button => button.dataset.range), [range]);
  }
  for (const label of ['Rolling hour', 'Today UTC', 'Month UTC', 'Spend / cap', 'Calls / cap']) assert.ok(expected.includes(label));
  assert.match(expected, /GBP 0\.0300<small>\/ GBP 0\.0500/);
  assert.match(expected, /GBP 0\.0200 unresolved/);
  assert.match(expected, /<td>2<small>\/ 20/);
  assert.doesNotMatch(expected, /GBP 0\.0400|Last 24 hours|Last 30 days|All time/);
  assert.match(budgetMarkup({ gbp_hour: 0 }, { hour: { estimated_gbp: 0 } }), /class="pci-limit"[^>]*><th scope="row">Rolling hour/);
  assert.match(budgetMarkup({ gbp_hour: 0 }, {}), /GBP 0\.0000 \(blocked\)/);
});

test('nonzero failures, unresolved cost and waiting sources remain visible outside the details', () => {
  const { root, nodes, data } = fixture();
  const value = memoryData(data);
  value.totals.uncertain_gbp = 0.02;
  value.totals.application_conflicts = 2;
  new PostcardInference(root, { kind: 'memory' }).render(value);
  const attention = nodes.get('.pci-attention').innerHTML;
  for (const text of ['3 sources waiting', 'oldest 3m', 'Last 24 hours', '1 failed', '1 rejected', '3 held', '2 update conflicts', 'GBP 0.0200 unresolved cost, included above']) assert.ok(attention.includes(text));
  assert.ok(root.innerHTML.indexOf('class="pci-attention"') < root.innerHTML.indexOf('<details class="pci-details">'));
  assert.equal(attentionMarkup({ totals: {}, pending_count: 0 }, 'memory', '24H'), '');
  assert.match(attentionMarkup({ totals: { validation_failures: 2 } }, 'reply', '1H'), /Last hour: 2 rejected/);
  assert.doesNotMatch(attentionMarkup({ totals: { invalid: 9 }, pending_count: 4 }, 'reply', '1H'), /rejected|sources waiting/);
});

test('current cloud limits remain visible even when the selected history has no failures', () => {
  const value = {
    settings: { enabled: true, route: 'AUTO', mode: 'DEEPSEEK', gbp_hour: 0.1, gbp_day: 1, gbp_month: 0, requests_day: 10 },
    windows: { hour: { estimated_gbp: 0.1 }, day: { requests: 10 }, month: { estimated_gbp: 0 } },
    totals: {},
  };
  for (const kind of ['reply', 'memory']) {
    assert.match(attentionMarkup(value, kind, '1H'), /Cloud limit reached: hour, day, month/);
    assert.equal(attentionMarkup(value, kind, '1H'), attentionMarkup(value, kind, 'ALL'));
  }
  assert.equal(attentionMarkup({ ...value, settings: { ...value.settings, enabled: false } }, 'reply', '24H'), '');
  assert.equal(attentionMarkup({ ...value, settings: { ...value.settings, mode: 'OFF' } }, 'memory', '24H'), '');
});

test('reply cloud off uses local inference while memory off queues sources with the API mode overrides', () => {
  assert.equal(routeLabel({ enabled: false, route: 'AUTO' }), 'Local model');
  assert.equal(routeLabel({ enabled: true, route: 'LOCAL' }), 'Local model');
  assert.equal(routeLabel({ enabled: true, route: 'AUTO' }), 'DeepSeek with local fallback');
  assert.equal(routeLabel({ enabled: true, route: 'DEEPSEEK' }), 'DeepSeek only');
  assert.equal(routeLabel({ mode: 'OFF' }, 'memory'), 'Off - sources stay queued');
  assert.equal(routeLabel({ mode: 'LOCAL' }, 'memory'), 'Local model');
  assert.equal(routeLabel({ mode: 'DEEPSEEK' }, 'memory'), 'DeepSeek only');
  for (const [kind, settings, status, route, label] of [
    ['reply', { enabled: false, route: 'AUTO' }, { provider: 'ollama', model: 'local', reason: 'cloud_disabled' }, 'Local model', 'Cloud replies disabled; replies use the local model.'],
    ['reply', { enabled: true, route: 'LOCAL' }, { provider: 'ollama', model: 'local', reason: 'local_selected' }, 'Local model', 'Cloud replies disabled; replies use the local model.'],
    ['memory', { mode: 'OFF' }, { provider: null, reason: 'disabled' }, 'Off - sources stay queued', 'Memory processing paused; sources stay queued.'],
    ['memory', { mode: 'LOCAL' }, { provider: 'ollama', configured_model: 'local', reason: 'local_selected' }, 'Local model', 'Local memory processing selected.'],
  ]) {
    const { root, nodes } = fixture();
    const panel = new PostcardInference(root, { kind });
    panel.render({ settings, status });
    assert.equal(nodes.get('.pci-route').textContent, route);
    assert.equal(nodes.get('.pci-state').textContent, label);
    assert.doesNotMatch(label, /Last recorded/, 'these server statuses describe the selected mode, not a past call');
  }
  assert.equal(statusLabel({ settings: { enabled: true, route: 'AUTO' }, status: { provider: 'ollama', reason: 'credentials_missing' } }), 'Last recorded: Local fallback - cloud credentials missing');
  assert.equal(statusLabel({ settings: { mode: 'DEEPSEEK' }, status: { reason: 'generated' } }, 'memory'), 'Last recorded: Memory decision generated');
  assert.equal(statusLabel({ settings: { enabled: true, route: 'DEEPSEEK' }, status: { reason: 'no_requests' } }), 'No recorded request');
  assert.equal(statusLabel({ settings: { mode: 'DEEPSEEK' } }, 'memory'), 'No recorded request');
});

test('configured cloud model remains distinct from models reported for a local route', () => {
  const { data } = fixture();
  const value = memoryData(data);
  value.settings.mode = 'LOCAL';
  value.status = { provider: 'ollama', configured_model: 'local', actual_model: 'local-model', reason: 'local_selected' };
  const memory = detailMarkup(value, 'memory', '24H');
  assert.match(memory, /Configured cloud model<\/dt><dd>deepseek-v4-flash/);
  assert.match(memory, /Reported provider<\/dt><dd>ollama/);
  assert.match(memory, /Last actual model<\/dt><dd>local-model/);
  const reply = detailMarkup({ ...data, pricing: value.pricing, status: { provider: 'ollama', model: 'local', reason: 'cloud_disabled' } }, 'reply', '24H');
  assert.match(reply, /Configured cloud model<\/dt><dd>deepseek-v4-flash/);
  assert.match(reply, /Reported model<\/dt><dd>local/);
});

test('small cloud costs use pence while detailed accounting preserves four decimal places', () => {
  for (const [value, label] of [[0, '&pound;0.00'], [0.000001, '&lt;0.01p'], [0.000099, '&lt;0.01p'], [0.0001, '0.01p'], [0.0006, '0.06p'], [0.04, '4.00p'], [0.99, '99.00p'], [1, '&pound;1.00'], [1.25, '&pound;1.25']]) {
    assert.equal(readableCost(value), label);
    const data = { totals: { estimated_gbp: value, uncertain_gbp: value / 2 } };
    assert.ok(summaryMarkup(data, 'reply', '24H').includes(`<dt>Est. cloud spend</dt><dd>${label}</dd>`));
    assert.ok(detailMarkup(data, 'reply', '24H').includes(`<dt>Estimated cloud spend</dt><dd>GBP ${value.toFixed(4)}</dd>`));
  }
});

test('all dashboard output ignores private records and escapes permitted server strings', () => {
  for (const kind of ['reply', 'memory']) {
    const { root, nodes, data } = fixture();
    const value = memoryData(data);
    value.settings = kind === 'memory' ? value.settings : { ...data.settings, enabled: true };
    value.private_text = 'PRIVATE SOURCE TEXT';
    value.recent = [{ text: 'PRIVATE SOURCE TEXT', prompt: 'PRIVATE PROMPT' }];
    value.status = { reason: 'PRIVATE SOURCE TEXT', error: 'PRIVATE ERROR', provider: '<img src=x>', configured_model: '<b>model</b>', model: '<script>reply()</script>', actual_model: '<script>memory()</script>' };
    value.pricing = { input_uncached_per_million: '<img src=x>', usd_to_gbp: '<script>rate()</script>' };
    new PostcardInference(root, { kind }).render(value);
    const output = [...nodes.values()].map(node => `${node.innerHTML}${node.textContent}`).join('');
    assert.doesNotMatch(output, /PRIVATE SOURCE TEXT|PRIVATE PROMPT|PRIVATE ERROR|<img|<script>|<b>model/);
    assert.match(nodes.get('.pci-totals').innerHTML, /&lt;img/);
    assert.match(nodes.get('.pci-totals').innerHTML, /&lt;script&gt;/);
    assert.doesNotMatch(nodes.get('.pci-current').innerHTML, /model|reply\(\)|memory\(\)|rate\(\)/);
  }
});
