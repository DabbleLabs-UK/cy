// Independent reply and sender-memory inference accounting in one public panel.
export const INFERENCE_RANGES = ['1H', '24H', '30D', 'ALL'];
const MAX_BARS = 120;
const number = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = value => `GBP ${number(value).toFixed(4)}`;
export function readableCost(value) {
  const amount = number(value);
  if (amount > 0 && amount < 0.0001) return '&lt;0.01p';
  return amount > 0 && amount < 1 ? `${(amount * 100).toFixed(2)}p` : `&pound;${amount.toFixed(2)}`;
}
const count = value => Math.round(number(value)).toLocaleString('en-GB');
const rangeLabel = range => ({ '1H': 'Last hour', '24H': 'Last 24 hours', '30D': 'Last 30 days', ALL: 'All time' }[range] || 'Last 24 hours');
const metric = (label, value) => `<div><dt>${escape(label)}</dt><dd>${value}</dd></div>`;
const row = (label, value) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`;

export function routeLabel(settings = {}, kind = 'reply') {
  if (kind === 'memory') return { OFF: 'Off - sources stay queued', LOCAL: 'Local model', DEEPSEEK: 'DeepSeek only' }[settings.mode] || 'Route unavailable';
  if (!settings.enabled || settings.route === 'LOCAL') return 'Local model';
  return settings.route === 'AUTO' ? 'DeepSeek with local fallback' : 'DeepSeek only';
}

export function statusLabel(data, kind = 'reply') {
  const settings = data.settings || {};
  // These modes replace historical status on the server. Do not invent a past call.
  if (kind === 'memory' && settings.mode === 'OFF') return 'Memory processing paused; sources stay queued.';
  if (kind === 'memory' && settings.mode === 'LOCAL') return 'Local memory processing selected.';
  if (kind === 'reply' && (!settings.enabled || settings.route === 'LOCAL')) return 'Cloud replies disabled; replies use the local model.';
  if (!data.status?.reason || data.status.reason === 'no_requests') return 'No recorded request';
  return `Last recorded: ${inferenceStatus(data, kind)}`;
}

// Budget windows are cloud-only and independent of the selected history range.
// Unknown cost is already included in estimated_gbp; never add it a second time.
export function budgetMarkup(settings = {}, windows = {}) {
  return `<table class="pci-budget"><caption>Cloud limits</caption><thead><tr><th scope="col">Window</th><th scope="col">Spend / cap</th><th scope="col">Calls / cap</th></tr></thead><tbody>${[
    ['hour', 'Rolling hour'], ['day', 'Today UTC'], ['month', 'Month UTC'],
  ].map(([key, label]) => {
    const w = windows[key] || {}, cap = number(settings[`gbp_${key}`]), used = number(w.estimated_gbp);
    const calls = number(w.requests), callCap = number(settings[`requests_${key}`]);
    const limited = cap === 0 || used >= cap || (callCap > 0 && calls >= callCap);
    return `<tr${limited ? ' class="pci-limit"' : ''}><th scope="row">${label}</th><td>${money(used)}<small>/ ${money(cap)}${cap === 0 ? ' (blocked)' : ''}</small>${number(w.uncertain_gbp) ? `<small>${money(w.uncertain_gbp)} unresolved</small>` : ''}</td><td>${count(calls)}<small>/ ${count(callCap)}</small></td></tr>`;
  }).join('')}</tbody></table><p class="pci-note">Separate cloud budgets for replies and memory. Unresolved cost is included. A new call must fit its full reservation.</p>`;
}

export function summaryMarkup(data, kind, range) {
  const t = data.totals || {}, memory = kind === 'memory';
  const decisions = number(t.formed) + number(t.updated) + number(t.resolved) + number(t.nothing);
  return `<p class="pci-period">${escape(rangeLabel(range))}</p><dl class="pci-metrics">${metric(memory ? 'Decisions completed' : 'Replies published', count(memory ? decisions : t.published))}${metric('Est. cloud spend', readableCost(t.estimated_gbp))}</dl>`;
}

export function attentionMarkup(data, kind, range) {
  const t = data.totals || {}, items = [];
  const settings = data.settings || {};
  const cloud = kind === 'memory' ? settings.mode === 'DEEPSEEK' : settings.enabled && settings.route !== 'LOCAL';
  const limits = cloud ? [['hour', 'hour'], ['day', 'day'], ['month', 'month']].filter(([key]) => {
    const w = data.windows?.[key];
    return w && ((settings[`gbp_${key}`] != null && number(w.estimated_gbp) >= number(settings[`gbp_${key}`]))
      || (number(settings[`requests_${key}`]) > 0 && number(w.requests) >= number(settings[`requests_${key}`])));
  }).map(([, label]) => label) : [];
  if (limits.length) items.push(`<p class="pci-alert">Cloud limit reached: ${limits.join(', ')}</p>`);
  if (kind === 'memory' && number(data.pending_count)) {
    const age = data.oldest_pending_age_seconds;
    const minutes = Math.ceil(number(age) / 60);
    const oldest = age == null ? '' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
    items.push(`<p class="pci-backlog"><strong>${count(data.pending_count)} sources waiting</strong>${oldest ? ` - oldest ${oldest}` : ''}</p>`);
  }
  const issues = [[t.failures, 'failed'], [kind === 'memory' ? t.invalid : t.validation_failures, 'rejected'], [t.held, 'held'], [t.application_conflicts, 'update conflicts']]
    .filter(([n]) => number(n)).map(([n, label]) => `${count(n)} ${label}`);
  if (issues.length) items.push(`<p class="pci-alert">${escape(rangeLabel(range))}: ${issues.join(' / ')}</p>`);
  if (number(t.uncertain_gbp)) items.push(`<p class="pci-alert">${money(t.uncertain_gbp)} unresolved cost, included above</p>`);
  return items.join('');
}

export function detailMarkup(data, kind, range) {
  const t = data.totals || {}, s = data.status || {}, memory = kind === 'memory';
  const outcomes = memory
    ? [['New memories', t.formed], ['Updated memories', t.updated], ['Topics resolved', t.resolved], ['No memory needed', t.nothing], ['Failed requests', t.failures], ['Invalid decisions', t.invalid], ['Held requests', t.held], ['Update conflicts', t.application_conflicts]]
    : [['Replies published', t.published], ['Local fallbacks', t.fallbacks], ['Failed requests', t.failures], ['Rejected replies', t.validation_failures]];
  return `<h4>${escape(rangeLabel(range))} - outcomes</h4><dl class="pci-stats">${row('Estimated cloud spend', money(t.estimated_gbp))}${outcomes.map(([label, n]) => row(label, count(n))).join('')}</dl>
    <h4>Request details</h4><dl class="pci-stats">${[
      ...(memory ? [['Sources waiting now', count(data.pending_count)], ['Oldest waiting source', data.oldest_pending_age_seconds == null ? 'None' : `${count(Math.ceil(number(data.oldest_pending_age_seconds) / 60))}m`]] : []),
      ['Total requests', count(t.requests)], ['Cloud requests', count(t.cloud_requests)], ['Local requests', count(t.local_requests)],
      ['Input tokens', count(t.input_tokens)], ['Output tokens', count(t.output_tokens)], ['Cached input', count(t.cached_tokens)], ['Uncached input', count(t.uncached_tokens)],
      ['Mean request time', number(t.mean_latency_ms) ? `${(number(t.mean_latency_ms) / 1000).toFixed(1)}s` : 'No completed requests'],
      ['Configured cloud model', data.pricing?.model || 'Unavailable'],
      ['Reported provider', s.provider || 'No recorded request'],
      [memory ? 'Last actual model' : 'Reported model', (memory ? s.actual_model : s.model) || 'No recorded request'],
    ].map(([label, value]) => row(label, value)).join('')}</dl>
    <p class="pci-note">Costs are token-based estimates, not invoices. USD per million tokens: ${escape(data.pricing?.input_uncached_per_million ?? '--')} input, ${escape(data.pricing?.input_cached_per_million ?? '--')} cached, ${escape(data.pricing?.output_per_million ?? '--')} output. GBP conversion: ${escape(data.pricing?.usd_to_gbp ?? '--')}.</p>`;
}

export function costBuckets(source) {
  const buckets = new Map();
  for (const item of Array.isArray(source) ? source : []) {
    const at = Date.parse(item.at);
    if (!Number.isFinite(at)) continue;
    const bucket = buckets.get(at) || { at, estimated_gbp: 0, uncertain_gbp: 0, requests: 0 };
    for (const key of ['estimated_gbp', 'uncertain_gbp', 'requests']) bucket[key] += number(item[key]);
    buckets.set(at, bucket);
  }
  const sorted = [...buckets.values()].sort((a, b) => a.at - b.at);
  const step = Math.max(1, Math.ceil(sorted.length / MAX_BARS));
  const bounded = [];
  for (let i = 0; i < sorted.length; i += step) {
    const group = sorted.slice(i, i + step);
    bounded.push(group.reduce((sum, item) => ({
      at: sum.at, end: item.at,
      estimated_gbp: sum.estimated_gbp + item.estimated_gbp,
      uncertain_gbp: sum.uncertain_gbp + item.uncertain_gbp,
      requests: sum.requests + item.requests,
    }), { at: group[0].at, end: group[0].at, estimated_gbp: 0, uncertain_gbp: 0, requests: 0 }));
  }
  return bounded;
}

export function costChart(source, bounds = {}) {
  const buckets = costBuckets(source);
  if (!buckets.length) return '<p class="pci-note">No recorded inference in this range.</p>';
  const peak = Math.max(...buckets.map(item => item.estimated_gbp), 0.000001);
  const rangeStart = Date.parse(bounds.start);
  const rangeEnd = Date.parse(bounds.end);
  const start = Number.isFinite(rangeStart) ? Math.min(rangeStart, buckets[0].at) : buckets[0].at;
  const end = Number.isFinite(rangeEnd) ? Math.max(rangeEnd, buckets[buckets.length - 1].end) : buckets[buckets.length - 1].end;
  const span = Math.max(1, end - start);
  const positions = buckets.map(item => end === start ? 150 : 8 + 284 * (item.at - start) / span);
  const spacing = positions.length < 2 ? 16 : Math.min(...positions.slice(1).map((x, i) => x - positions[i]));
  const width = Math.max(0.5, Math.min(16, spacing * 0.8));
  const bars = buckets.map((item, i) => {
    const billed = 84 * Math.max(0, item.estimated_gbp - item.uncertain_gbp) / peak;
    const uncertain = 84 * item.uncertain_gbp / peak;
    const label = `${new Date(item.at).toISOString()}${item.end > item.at ? ` to ${new Date(item.end).toISOString()}` : ''}: ${money(item.estimated_gbp)} estimated total, including ${money(item.uncertain_gbp)} unresolved, ${count(item.requests)} requests`;
    return `<g><title>${escape(label)}</title><rect class="pci-cost" x="${positions[i] - width / 2}" y="${90 - billed}" width="${width}" height="${billed}"/><rect class="pci-uncertain" x="${positions[i] - width / 2}" y="${90 - billed - uncertain}" width="${width}" height="${uncertain}"/></g>`;
  }).join('');
  return `<svg class="pci-chart" viewBox="0 0 300 100" role="img" aria-label="Recorded inference cost by time bucket; bars show estimated and unresolved spend. No interpolation between calls."><title>Postcard inference cost</title>${bars}</svg><div class="pci-axis"><span>${escape(new Date(start).toLocaleString('en-GB'))}</span><span>${escape(new Date(end).toLocaleString('en-GB'))}</span></div><p class="pci-note">Bars: estimated cost per bucket. Pale bars: unresolved cost reserved against caps.</p>`;
}

export function inferenceStatus(data, kind = 'reply') {
  if (kind === 'memory') {
    if (data.settings?.mode === 'OFF') return 'Memory formation off - sources remain queued';
    if (data.settings?.mode === 'LOCAL') return 'Local memory formation';
    const reason = String(data.status?.reason || '').toLowerCase();
    const labels = {
      credentials_missing: 'Memory formation held - cloud credentials missing',
      provider_unavailable: 'Memory formation held - provider unavailable',
      concurrency_full: 'Memory formation waiting for capacity',
      hour_request_cap: 'Memory formation held - hourly request cap',
      day_request_cap: 'Memory formation held - daily request cap',
      month_request_cap: 'Memory formation held - monthly request cap',
      hour_spend_cap: 'Memory formation held - hourly spend cap',
      day_spend_cap: 'Memory formation held - daily spend cap',
      month_spend_cap: 'Memory formation held - monthly spend cap',
      timeout: 'Memory formation provider timed out', network_error: 'Memory formation connection unavailable',
      provider_error: 'Memory formation provider unavailable', invalid: 'Memory decision failed validation',
      held: 'Memory formation held', active: 'DeepSeek memory formation', deepseek_active: 'DeepSeek memory formation',
      model_mismatch: 'Memory formation held - configured model unavailable',
      already_reserved: 'Memory formation already in progress', claim_not_active: 'Memory source no longer claimed',
      generated: 'Memory decision generated', cancelled: 'Memory formation interrupted',
      invalid_decision: 'Memory decision failed validation', application_conflict: 'Memory update conflict',
      no_requests: 'Awaiting sender-memory request',
    };
    return labels[reason] || 'Awaiting sender-memory request';
  }
  if (!data.settings?.enabled) return 'Cloud disabled - local replies';
  if (data.settings?.route === 'LOCAL') return 'Local replies';
  const reasons = {
    credentials_missing: 'Cloud credentials missing', provider_unavailable: 'Cloud provider unavailable',
    concurrency_full: 'Cloud concurrency full', hourly_cap_reached: 'Hourly cap reached',
    daily_cap_reached: 'Daily cap reached', monthly_cap_reached: 'Monthly cap reached',
    pending: 'Postcard held pending inference', held: 'Postcard held pending inference',
    local_fallback: 'Local fallback', active: 'DeepSeek active',
    deepseek_active: 'DeepSeek active', local_selected: 'Local replies', cloud_disabled: 'Cloud disabled - local replies',
    hour_request_cap: 'Hourly request cap reached', day_request_cap: 'Daily request cap reached', month_request_cap: 'Monthly request cap reached',
    hour_spend_cap: 'Hourly spend cap reached', day_spend_cap: 'Daily spend cap reached', month_spend_cap: 'Monthly spend cap reached',
    already_claimed: 'Postcard already in progress', not_claimable: 'Postcard unavailable for a reply',
    generated: 'Reply generated', validation_rejected: 'Reply failed validation', publication_pending: 'Reply awaiting publication',
    timeout: 'Provider timed out', network_error: 'Provider connection unavailable', provider_error: 'Provider unavailable',
  };
  const reason = String(data.status?.reason || '').toLowerCase();
  const label = reasons[reason] || (data.status?.provider === 'deepseek' ? 'DeepSeek active' : 'Awaiting next postcard');
  return data.settings?.route === 'AUTO' && data.status?.provider === 'ollama' && !['local_fallback', 'local_selected'].includes(reason) ? `Local fallback - ${label.toLowerCase()}` : label;
}

const capFields = [
  ['concurrency', 'Concurrent cloud replies', '1', '4', '1'],
  ['requests_hour', 'Requests / hour', '1', '1000', '1'],
  ['requests_day', 'Requests / day', '1', '10000', '1'],
  ['requests_month', 'Requests / month', '1', '100000', '1'],
  ['gbp_hour', 'GBP cap / hour', '0', '1000', '0.0001'],
  ['gbp_day', 'GBP cap / day', '0', '1000', '0.0001'],
  ['gbp_month', 'GBP cap / month', '0', '1000', '0.0001'],
];

export function settingsMarkup(settings, kind = 'reply') {
  const memory = kind === 'memory';
  const route = memory
    ? `<label>Memory mode<select name="mode">${['DEEPSEEK', 'LOCAL', 'OFF'].map(mode => `<option${settings.mode === mode ? ' selected' : ''}>${mode}</option>`).join('')}</select></label>`
    : `<label class="pci-check"><input type="checkbox" name="enabled"${settings.enabled ? ' checked' : ''}> Cloud postcard inference</label><label>Route<select name="route">${['AUTO', 'LOCAL', 'DEEPSEEK'].map(value => `<option${settings.route === value ? ' selected' : ''}>${value}</option>`).join('')}</select></label>`;
  const note = memory
    ? 'Memory formation has its own budget. DEEPSEEK holds queued sources when unavailable; it does not fall back locally. LOCAL explicitly uses local inference. OFF leaves sources queued.'
    : 'AUTO can fall back locally. DEEPSEEK holds the postcard if cloud inference is unavailable. Cloud off always uses local inference.';
  const input = (key, label) => {
    const [, , min, max, step] = capFields.find(field => field[0] === key);
    return `<input aria-label="${label}" name="${key}" type="number" min="${min}" max="${max}" step="${step}" required value="${escape(settings[key])}">`;
  };
  return `<details class="pci-settings"><summary>${memory ? 'Memory' : 'Reply'} settings</summary><form class="pci-form">${route}<label>Concurrent cloud calls${input('concurrency', 'Concurrent cloud calls')}</label><table class="pci-budget"><caption>Cloud limits</caption><thead><tr><th scope="col">Window</th><th scope="col">GBP cap</th><th scope="col">Call cap</th></tr></thead><tbody>${[['hour', 'Hour'], ['day', 'Day (UTC)'], ['month', 'Month (UTC)']].map(([key, label]) => `<tr><th scope="row">${label}</th><td>${input(`gbp_${key}`, `${label} GBP cap`)}</td><td>${input(`requests_${key}`, `${label} request cap`)}</td></tr>`).join('')}</tbody></table><p class="pci-note">${note}</p><button type="submit">Save ${memory ? 'memory' : 'reply'} settings</button></form></details>`;
}

export class PostcardInference {
  constructor(root, { kind = 'reply', endpoint = kind === 'memory' ? 'api/memory-formation-inference.php' : 'api/postcard-inference.php', fetcher = (...args) => globalThis.fetch(...args) } = {}) {
    this.root = root;
    this.endpoint = endpoint;
    this.fetcher = fetcher;
    this.kind = kind;
    this.range = '24H';
    this.serial = 0;
    this.canAdmin = false;
    this.root.innerHTML = `<p class="pci-route"></p><p class="pci-state" role="status" aria-live="polite">Loading inference accounting...</p><div class="pci-current"></div><div class="pci-attention"></div><details class="pci-details"><summary>Usage &amp; limits</summary><div class="pci-budgets"></div><h4>History range</h4><nav class="pci-ranges" aria-label="Inference history range">${INFERENCE_RANGES.map(range => `<button type="button" data-range="${range}" aria-pressed="${range === this.range}">${range}</button>`).join('')}</nav><div class="pci-graph"></div><div class="pci-totals"></div></details><div class="pci-admin"></div><p class="pci-message" role="status" aria-live="polite"></p>`;
    this.root.querySelectorAll('[data-range]').forEach(button => button.addEventListener('click', () => {
      if (this.saving) return;
      this.range = button.dataset.range;
      this.refresh();
    }));
    this.root.closest('details')?.addEventListener('toggle', () => {
      if (this.root.closest('details').open) this.refresh();
    });
  }

  async refresh() {
    if (this.saving) return;
    const serial = ++this.serial;
    try {
      const response = await this.fetcher(`${this.endpoint}?range=${encodeURIComponent(this.range)}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      if (!data.ok) throw new Error('unavailable');
      if (serial === this.serial) this.render(data);
    } catch {
      if (serial === this.serial) {
        this.root.querySelector('.pci-state').textContent = 'Accounting unavailable - figures may be out of date.';
        this.root.querySelector('.pci-state').setAttribute('data-stale', 'true');
      }
    }
  }

  render(data, replaceSettings = false) {
    const settings = data.settings || {};
    this.canAdmin = data.can_admin === true;
    this.root.querySelector('.pci-state').textContent = statusLabel(data, this.kind);
    this.root.querySelector('.pci-state').removeAttribute('data-stale');
    this.root.querySelector('.pci-route').textContent = routeLabel(settings, this.kind);
    this.root.querySelectorAll('[data-range]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.range === this.range)));
    this.root.querySelector('.pci-current').innerHTML = summaryMarkup(data, this.kind, this.range);
    this.root.querySelector('.pci-attention').innerHTML = attentionMarkup(data, this.kind, this.range);
    this.root.querySelector('.pci-budgets').innerHTML = budgetMarkup(settings, data.windows);
    this.root.querySelector('.pci-graph').innerHTML = costChart(data.buckets, data);
    this.root.querySelector('.pci-totals').innerHTML = detailMarkup(data, this.kind, this.range);
    const admin = this.root.querySelector('.pci-admin');
    if (!this.canAdmin) admin.innerHTML = '';
    else if (replaceSettings || !admin.querySelector('form')) {
      const wasOpen = admin.querySelector('details')?.open;
      const focused = this.root.ownerDocument?.activeElement;
      const focusName = focused && admin.contains?.(focused) ? focused.name || (focused.type === 'submit' ? 'submit' : null) : null;
      admin.innerHTML = settingsMarkup(settings, this.kind);
      admin.querySelector('form').addEventListener('submit', event => { event.preventDefault(); this.save(event.currentTarget); });
      if (wasOpen) admin.querySelector('details').open = true;
      if (focusName) admin.querySelector(focusName === 'submit' ? '[type="submit"]' : `[name="${focusName}"]`)?.focus();
    }
  }

  async save(form) {
    if (!this.canAdmin || this.saving) return;
    this.saving = true;
    const settings = this.kind === 'memory' ? { mode: form.elements.mode.value }
      : { enabled: form.elements.enabled.checked, route: form.elements.route.value };
    for (const [key] of capFields) settings[key] = Number(form.elements[key].value);
    const message = this.root.querySelector('.pci-message');
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    message.textContent = 'Saving settings...';
    ++this.serial;
    try {
      const response = await this.fetcher(`${this.endpoint}?range=${encodeURIComponent(this.range)}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'settings', settings }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error('settings rejected');
      this.render(data, true);
      message.textContent = 'Settings saved.';
    } catch {
      message.textContent = 'Settings could not be saved. Check access and cap values, then reload to confirm the current settings.';
    } finally {
      this.saving = false;
      submit.disabled = false;
    }
  }
}

if (typeof document !== 'undefined') {
  for (const [id, kind] of [['postcard-reply-inference', 'reply'], ['postcard-memory-inference', 'memory']]) {
    const root = document.getElementById(id);
    if (!root) continue;
    const panel = new PostcardInference(root, { kind });
    panel.refresh();
    // Accounting refresh is independent of model scheduling and stops while hidden.
    setInterval(() => {
      if (!document.hidden && root.closest('details')?.open && !panel.saving) panel.refresh();
    }, 60000);
  }
}
