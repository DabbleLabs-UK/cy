// Independent reply and sender-memory inference accounting in one public panel.
export const INFERENCE_RANGES = ['1H', '24H', '30D', 'ALL'];
const MAX_BARS = 120;
const number = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = value => `GBP ${number(value).toFixed(4)}`;
const count = value => Math.round(number(value)).toLocaleString('en-GB');

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
  return `<details class="pci-settings"><summary>${memory ? 'Memory' : 'Reply'} inference settings</summary><form class="pci-form">${route}${capFields.map(([key, label, min, max, step]) => `<label>${memory && key === 'concurrency' ? 'Concurrent memory requests' : label}<input name="${key}" type="number" min="${min}" max="${max}" step="${step}" required value="${escape(settings[key])}"></label>`).join('')}<p class="pci-note">${note}</p><button type="submit">Save ${memory ? 'memory' : 'reply'} settings</button></form></details>`;
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
    this.root.innerHTML = `<p class="pci-state" role="status" aria-live="polite">Loading inference accounting...</p><div class="pci-current"></div><nav class="pci-ranges" aria-label="Inference history range">${INFERENCE_RANGES.map(range => `<button type="button" data-range="${range}" aria-pressed="${range === this.range}">${range}</button>`).join('')}</nav><div class="pci-graph"></div><div class="pci-totals"></div><div class="pci-admin"></div><p class="pci-message" role="status" aria-live="polite"></p>`;
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
      if (serial === this.serial) this.root.querySelector('.pci-state').textContent = 'Inference accounting unavailable; displayed figures may be out of date.';
    }
  }

  render(data, replaceSettings = false) {
    const totals = data.totals || {};
    const settings = data.settings || {};
    const status = data.status || {};
    const windows = data.windows || {};
    this.canAdmin = data.can_admin === true;
    this.root.querySelector('.pci-state').textContent = inferenceStatus(data, this.kind);
    this.root.querySelectorAll('[data-range]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.range === this.range)));
    const memory = this.kind === 'memory';
    const route = memory
      ? `<p class="pci-route">${escape(settings.mode || 'Unavailable')} / ${escape(status.provider || 'awaiting selection')}<small>Configured: ${escape(status.configured_model || data.pricing?.model || 'Model unavailable')}</small><small>Last actual model: ${escape(status.actual_model || 'No recorded request')}</small></p>`
      : `<p class="pci-route">${escape(settings.route || 'LOCAL')} / ${escape(status.provider || 'awaiting selection')}<small>${status.provider ? '' : 'Configured cloud: '}${escape(status.model || data.pricing?.model || 'Model unavailable')}</small></p>`;
    this.root.querySelector('.pci-current').innerHTML = `${route}<p class="pci-note">${memory ? 'Memory formation' : 'Reply'} cloud budget only; independent caps. Hour is rolling; day and month use UTC.</p><dl class="pci-stats">${[['hour', 'Last hour', 'gbp_hour', 'requests_hour'], ['day', 'Today (UTC)', 'gbp_day', 'requests_day'], ['month', 'Month (UTC)', 'gbp_month', 'requests_month']].map(([key, label, costCap, requestCap]) => {
      const window = windows[key] || {};
      const committed = number(window.estimated_gbp);
      const cap = number(settings[costCap]);
      const used = cap > 0 ? `${Math.round(committed / cap * 100)}%` : 'Blocked';
      return `<div><dt>${label}</dt><dd>${money(window.estimated_gbp)}</dd><dd class="pci-note">${used} of ${money(cap)} cap; ${count(window.requests)} / ${count(settings[requestCap])} requests${number(window.uncertain_gbp) ? `; ${money(window.uncertain_gbp)} unresolved` : ''}</dd></div>`;
    }).join('')}</dl>`;
    this.root.querySelector('.pci-graph').innerHTML = costChart(data.buckets, data);
    const latency = number(totals.mean_latency_ms);
    const outcomes = memory
      ? `<div><dt>${escape(this.range)} completed decisions</dt><dd>${count(number(totals.formed) + number(totals.updated) + number(totals.resolved) + number(totals.nothing))}</dd></div><div><dt>Create / update / resolve / nothing</dt><dd>${count(totals.formed)} / ${count(totals.updated)} / ${count(totals.resolved)} / ${count(totals.nothing)}</dd></div><div><dt>Failed / invalid / held</dt><dd>${count(totals.failures)} / ${count(totals.invalid)} / ${count(totals.held)}</dd></div><div><dt>Pending sources / oldest age</dt><dd>${count(data.pending_count)} / ${data.oldest_pending_age_seconds == null ? 'None' : `${count(Math.ceil(number(data.oldest_pending_age_seconds) / 60))}m`}</dd></div>`
      : `<div><dt>${escape(this.range)} replies published</dt><dd>${count(totals.published)}</dd></div><div><dt>Fallbacks / failed / rejected</dt><dd>${count(totals.fallbacks)} / ${count(totals.failures)} / ${count(totals.validation_failures)}</dd></div>`;
    this.root.querySelector('.pci-totals').innerHTML = `<dl class="pci-stats">${outcomes}<div><dt>${escape(this.range)} estimated spend</dt><dd>${money(totals.estimated_gbp)}</dd>${number(totals.uncertain_gbp) ? `<dd class="pci-note">Includes ${money(totals.uncertain_gbp)} unresolved, reserved against caps.</dd>` : ''}</div><div><dt>Requests / cloud / local</dt><dd>${count(totals.requests)} / ${count(totals.cloud_requests)} / ${count(totals.local_requests)}</dd></div><div><dt>Tokens in / out</dt><dd>${count(totals.input_tokens)} / ${count(totals.output_tokens)}</dd></div><div><dt>Input cached / uncached</dt><dd>${count(totals.cached_tokens)} / ${count(totals.uncached_tokens)}</dd></div><div><dt>Mean request latency</dt><dd>${latency ? `${(latency / 1000).toFixed(1)}s` : 'No completed requests'}</dd></div></dl><p class="pci-note">Costs estimated from recorded token usage. Pricing: USD ${escape(data.pricing?.input_uncached_per_million ?? '--')} input / ${escape(data.pricing?.input_cached_per_million ?? '--')} cached / ${escape(data.pricing?.output_per_million ?? '--')} output per million tokens; GBP conversion ${escape(data.pricing?.usd_to_gbp ?? '--')}.</p>`;
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
