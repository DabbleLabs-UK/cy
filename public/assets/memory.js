// Public autobiographical-memory surface. The endpoint exposes public summaries
// plus the current browser's own returning-sender count; it never exposes memory
// IDs, visitor IDs, source excerpts or another visitor's private history.

const GROUPS = Object.freeze({
  all: () => true,
  people: (item) => item.type === 'PERSON',
  incidents: (item) => ['EPISODIC', 'UNRESOLVED_THREAD'].includes(item.type),
  ideas: (item) => ['MOTIF', 'SEMANTIC'].includes(item.type),
});

function el(tag, className, text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export class MemoryPanel {
  constructor(root, endpoint, inspectionEndpoint = null) {
    this.root = root;
    this.endpoint = endpoint;
    this.inspectionEndpoint = inspectionEndpoint;
    this.group = 'all';
    this.data = null;
    this.inspection = null;
    this.timer = null;
    if (!root || !endpoint) return;
    this.renderLoading();
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 30000);
  }

  renderLoading() {
    this.root.replaceChildren(el('p', 'memory-empty', 'Memory record loading...'));
  }

  async refresh() {
    try {
      const response = await fetch(this.endpoint, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.data = await response.json();
      if (this.inspectionEndpoint) {
        try {
          const inspectionResponse = await fetch(this.inspectionEndpoint, { cache: 'no-store' });
          if (inspectionResponse.ok) this.inspection = await inspectionResponse.json();
        } catch {
          this.inspection = null;
        }
      }
      this.render();
    } catch {
      this.root.replaceChildren(el('p', 'memory-empty', 'The memory record is unavailable.'));
    }
  }

  render() {
    const data = this.data || {};
    const counts = data.counts || {};
    const fragment = document.createDocumentFragment();
    const status = el('div', 'memory-status');
    status.append(
      el('strong', '', `${Number(counts.retained) || 0} public memories`),
      el('span', '', `${Number(data.current_sender_memory_count) || 0} from your previous visits`),
    );
    fragment.append(status);

    const tabs = el('div', 'memory-tabs');
    for (const key of Object.keys(GROUPS)) {
      const button = el('button', key === this.group ? 'active' : '', key);
      button.type = 'button';
      button.addEventListener('click', () => { this.group = key; this.render(); });
      tabs.append(button);
    }
    fragment.append(tabs);

    const list = el('div', 'memory-list');
    const items = (Array.isArray(data.items) ? data.items : []).filter(GROUPS[this.group]);
    for (const item of items) {
      const detail = el('details', 'memory-entry');
      const summary = el('summary', 'memory-entry-head');
      summary.append(
        el('span', 'memory-kind', String(item.type || 'memory').replaceAll('_', ' ')),
        el('strong', '', item.classification || 'retained recollection'),
      );
      detail.append(summary, el('p', 'memory-summary', item.summary || 'No public summary.'));
      const meta = el('div', 'memory-meta');
      meta.append(
        el('span', '', `${Number(item.source_count) || 0} source${Number(item.source_count) === 1 ? '' : 's'}`),
        el('span', '', String(item.consistency || 'UNCERTAIN').toLowerCase()),
      );
      detail.append(meta);
      list.append(detail);
    }
    if (!items.length) list.append(el('p', 'memory-empty', 'No public memories in this group.'));
    fragment.append(list);

    const activity = Array.isArray(data.activity) ? data.activity : [];
    if (activity.length) {
      const activityDetails = el('details', 'memory-activity');
      activityDetails.append(el('summary', '', 'RECENT MEMORY ACTIVITY'));
      const activityList = el('div', 'memory-activity-list');
      for (const item of activity.slice(0, 6)) {
        const row = el('p', '');
        row.append(el('strong', '', String(item.type || '').replaceAll('_', ' ')), document.createTextNode(` ${item.text || ''}`));
        const reasons = Array.isArray(item.reasons) ? item.reasons : [];
        if (reasons.length) {
          row.append(el('span', 'memory-reasons', reasons
            .map((reason) => String(reason).replaceAll('_', ' ').toLowerCase())
            .join(' / ')));
        }
        activityList.append(row);
      }
      activityDetails.append(activityList);
      fragment.append(activityDetails);
    }

    const queries = Array.isArray(this.inspection && this.inspection.queries)
      ? this.inspection.queries : [];
    const runtime = this.inspection && this.inspection.runtime;
    if (runtime) {
      const ownerRuntime = el('details', 'memory-inspection memory-runtime-status');
      ownerRuntime.append(el('summary', '', 'OWNER: MEMORY RUNTIME STATUS'));
      const grid = el('div', 'memory-runtime-grid');
      for (const [label, values] of Object.entries({
        formation: runtime.formation || {}, surfacing: runtime.surfacing || {},
      })) {
        const card = el('div', 'memory-runtime-card');
        card.append(el('strong', '', label.toUpperCase()));
        for (const field of ['queue_depth', 'max_queue_depth', 'attempts', 'processed', 'prepared', 'consumed', 'nothing', 'changed', 'retryable', 'average_latency_ms', 'max_latency_ms']) {
          if (values[field] == null) continue;
          const row = el('span', '');
          row.append(el('small', '', field.replaceAll('_', ' ')), document.createTextNode(String(values[field])));
          card.append(row);
        }
        if (values.last_error) card.append(el('p', 'memory-runtime-error', String(values.last_error)));
        grid.append(card);
      }
      ownerRuntime.append(grid);
      fragment.append(ownerRuntime);
    }
    if (queries.length) {
      const owner = el('details', 'memory-inspection');
      owner.append(el('summary', '', 'OWNER: LATEST ACCESS TRACE'));
      const latest = queries[0];
      const pre = el('pre', 'memory-inspection-json');
      pre.textContent = JSON.stringify(latest, null, 2);
      owner.append(pre);
      fragment.append(owner);
    }

    const caveat = el('p', 'memory-caveat', 'Subjective autobiography, not authoritative world history. The brain diagram remains a functional analogy.');
    fragment.append(caveat);
    this.root.replaceChildren(fragment);
  }
}
