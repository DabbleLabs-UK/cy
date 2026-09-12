// Owner-only shared-context and ambient-world inspection. This module is loaded
// only when the server has already granted admin access.

const root = document.getElementById('world-inspection');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function jsonBlock(value) {
  const pre = el('pre', 'world-inspection-json');
  pre.textContent = JSON.stringify(value, null, 2);
  return pre;
}

function details(title, content, open = false) {
  const box = el('details', 'world-inspection-detail');
  box.open = open;
  box.append(el('summary', '', title), content);
  return box;
}

function metricRow(label, value) {
  const row = el('div', 'world-inspection-metric');
  row.append(el('span', '', label), el('strong', '', value == null ? '-' : value));
  return row;
}

function renderContext(target, context) {
  target.replaceChildren();
  if (!context) {
    target.append(el('p', 'world-inspection-empty', 'No packet recorded for this consumer yet.'));
    return;
  }
  const metrics = context.metrics || {};
  const packet = context.packet || {};
  const summary = el('div', 'world-inspection-metrics');
  summary.append(
    metricRow('generation', context.generation_ref),
    metricRow('built', context.generated_at),
    metricRow('sources', metrics.sourceCount),
    metricRow('selected', metrics.selectedCount),
    metricRow('omitted', metrics.omittedCount),
    metricRow('deduplicated', metrics.deduplicationCount),
    metricRow('build ms', metrics.buildLatencyMs),
    metricRow('packet chars', metrics.charSize),
    metricRow('DB queries', metrics.databaseQueries),
  );
  target.append(
    summary,
    details('AVAILABLE SOURCE STORES', jsonBlock(packet.availableSourceStores || [])),
    details('SELECTED CONTEXT', jsonBlock(packet.sections || [])),
    details('OMITTED CONTEXT / PRIVACY FILTERS', jsonBlock(packet.omitted || [])),
    details('TOKEN / CHAR BUDGET', jsonBlock(packet.budget || {})),
    details('STRUCTURED PACKET', jsonBlock(packet)),
    details('FINAL MODEL-FACING RENDERING', el('pre', 'world-inspection-rendering', context.final_rendering || '')),
  );
}

function render(data) {
  const contexts = Array.isArray(data.contexts) ? data.contexts : [];
  const selector = el('select', 'world-inspection-select');
  const generationSelector = el('select', 'world-inspection-select');
  const order = ['CY_PROSE', 'AWG', 'MEMORY_FORMATION', 'MEMORY_SURFACING', 'EXPRESSIVE_CHOICE'];
  for (const consumer of order) {
    const option = el('option', '', consumer.replaceAll('_', ' '));
    option.value = consumer;
    selector.append(option);
  }
  const contextBody = el('div', 'world-inspection-context');
  const selectContext = () => {
    const selected = contexts.find((entry) => String(entry.id) === generationSelector.value);
    renderContext(contextBody, selected);
  };
  const selectConsumer = () => {
    generationSelector.replaceChildren();
    for (const context of contexts.filter((entry) => entry.consumer === selector.value)) {
      const label = `${context.generated_at} - ${context.generation_ref || `record ${context.id}`}`;
      const option = el('option', '', label);
      option.value = String(context.id);
      generationSelector.append(option);
    }
    selectContext();
  };
  selector.addEventListener('change', selectConsumer);
  generationSelector.addEventListener('change', selectContext);
  selectConsumer();

  const awg = data.last_awg_run;
  const awgBody = awg ? el('div', 'world-inspection-awg') : el('p', 'world-inspection-empty', 'No ambient world run recorded yet.');
  if (awg) {
    awgBody.append(
      metricRow('last run', awg.ran_at),
      metricRow('candidate', awg.candidate_type),
      metricRow('validation', awg.validation_status),
      metricRow('rejection', awg.rejection_reason),
      metricRow('latency', `${awg.total_latency_ms} ms`),
      metricRow('provider / model', `${awg.provider || '-'} / ${awg.model || '-'}`),
      details('CONTEXT PACKET SUMMARY', jsonBlock(awg.context_packet_summary)),
      details('CANDIDATE OUTPUT', jsonBlock(awg.candidate_output)),
      details('CREATED EVENTS / THREAD CHANGES', jsonBlock({
        createdWorldEventIds: awg.created_world_event_ids,
        threadChanges: awg.thread_changes,
      })),
    );
  }

  root.replaceChildren(
    el('div', 'world-inspection-label', 'CONSUMER'),
    selector,
    el('div', 'world-inspection-label', 'GENERATION'),
    generationSelector,
    contextBody,
    details('LAST AMBIENT WORLD RUN', awgBody),
    details('OPEN WORLD THREADS', jsonBlock(data.open_threads || [])),
    details('PERSISTENT WORLD OBJECTS', jsonBlock(data.objects || [])),
  );
}

async function load() {
  const endpoint = root && root.dataset.endpoint;
  if (!root || !endpoint) return;
  root.replaceChildren(el('p', 'world-inspection-empty', 'Loading private inspection data...'));
  try {
    const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch (error) {
    root.replaceChildren(el('p', 'world-inspection-error', `Inspection unavailable: ${error.message}`));
  }
}

const panel = root && root.closest('details');
if (panel) {
  panel.addEventListener('toggle', () => {
    if (panel.open) load();
  });
}
