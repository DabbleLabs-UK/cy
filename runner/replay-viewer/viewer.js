// viewer.js - Soma replay workbench client.
//
// Reads replay JSON from a relative api.php?action=... entrypoint (backed by
// runner/soma-replay-api.js, either directly in soma-replay-server.js for
// local dev, or via a subprocess from public/replay/api.php when hosted at
// cy.dabblelabs.uk/replay/ - see docs/dev-admin-ui-hosting.md) and draws it.
// No math happens here beyond axis scaling and line layout: every value shown
// is read straight from the server response. The CANDIDATE line is a
// REPLAY-ONLY illustrative model, not a validated psychological measurement -
// see the calibration panel this file renders from the server's own
// calibration ledger, never from a value hard-coded here.

import {
  ROWS, rowIndex, findTransitionFor, precedingEventLabel, describeTransition, stepVertices,
  chooseTickStepMs, tickTimestamps,
} from './timeline-model.js';

const ROW_COLOR = {
  THREAT_ONGOING: 'var(--ongoing)',
  THREAT_IMMINENT: 'var(--imminent)',
  ANTICIPATING: 'var(--anticipating)',
  QUIET: 'var(--quiet)',
  UNKNOWN: 'var(--unknown)',
};

const state = {
  fixtures: [],
  activeFixtureId: null,
  sampleParam: '15',
  mode: 'current', // 'current' | 'candidate' | 'both' - controls the GRAPH only, not the inspector
  view: 'event-window', // 'event-window' | 'full-day' - controls the plotted time window only
  report: null,
  candidate: null,
  fixtureMetaRaw: null,
  selectedIndex: null,
};

const el = {
  tabs: document.getElementById('fixtureTabs'),
  meta: document.getElementById('fixtureMeta'),
  svg: document.getElementById('timeline'),
  status: document.getElementById('timelineStatus'),
  inspector: document.getElementById('inspector'),
  sampleSelect: document.getElementById('sampleSelect'),
  modeButtons: {
    current: document.getElementById('modeCurrent'),
    candidate: document.getElementById('modeCandidate'),
    both: document.getElementById('modeBoth'),
  },
  viewButtons: {
    'event-window': document.getElementById('viewEventWindow'),
    'full-day': document.getElementById('viewFullDay'),
  },
  candidatePanel: document.getElementById('candidatePanel'),
  candidateToggle: document.getElementById('candidateToggle'),
  candidateDetail: document.getElementById('candidateDetail'),
};

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  const body = await res.json();
  if (!res.ok) throw new Error(body && body.error ? body.error : `request failed: ${url}`);
  return body;
}

// A single relative 'action=' entrypoint, resolved against the CURRENT page
// URL - this is what lets the exact same viewer.js run unmodified both from
// the local dev server (soma-replay-server.js, served at /) and from the
// hosted admin-gated deployment (public/replay/api.php, served at /replay/).
// See docs/dev-admin-ui-hosting.md.
const API_PATH = 'api.php';

async function loadFixtures() {
  const data = await fetchJson(`${API_PATH}?action=fixtures`);
  state.fixtures = data.fixtures;
  renderTabs();
  if (state.fixtures.length) selectFixture(state.fixtures[0].id);
}

function renderTabs() {
  el.tabs.innerHTML = '';
  for (const fixture of state.fixtures) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wb-tab';
    btn.dataset.id = fixture.id;
    btn.setAttribute('role', 'tab');
    btn.textContent = shortLabel(fixture);
    btn.title = fixture.title;
    btn.addEventListener('click', () => selectFixture(fixture.id));
    el.tabs.appendChild(btn);
  }
  syncTabActive();
}

function shortLabel(fixture) {
  const map = {
    'quiet-routine-baseline': 'Quiet',
    'prolonged-uncertain-lockdown': 'Lockdown',
    'hostile-search-confiscation': 'Search',
    'supportive-social-contact': 'Support',
    'mixed-chaotic-day': 'Mixed',
    'recovery-after-stress': 'Recovery',
  };
  return map[fixture.id] || fixture.title;
}

function syncTabActive() {
  for (const btn of el.tabs.children) {
    btn.classList.toggle('is-active', btn.dataset.id === state.activeFixtureId);
    btn.setAttribute('aria-selected', String(btn.dataset.id === state.activeFixtureId));
  }
}

async function selectFixture(id) {
  state.activeFixtureId = id;
  state.selectedIndex = null;
  syncTabActive();
  await loadReplay();
}

async function loadReplay() {
  showStatus('Loading replay...');
  try {
    const sampleMinutes = state.sampleParam;
    const viewParam = state.view === 'full-day' ? '&view=full-day' : '';
    const data = await fetchJson(
      `${API_PATH}?action=replay&fixture=${encodeURIComponent(state.activeFixtureId)}&sampleMinutes=${encodeURIComponent(sampleMinutes)}${viewParam}`,
    );
    state.report = data.report;
    state.candidate = data.candidate;
    state.fixtureMetaRaw = data.fixture;
    hideStatus();
    renderMeta();
    renderCandidatePanel();
    renderTimeline();
    renderInspector(null);
  } catch (error) {
    showStatus(`Failed to load replay: ${error.message}`);
  }
}

function showStatus(text) {
  el.status.hidden = false;
  el.status.textContent = text;
  el.svg.style.visibility = 'hidden';
}
function hideStatus() {
  el.status.hidden = true;
  el.svg.style.visibility = 'visible';
}

function renderMeta() {
  const r = state.report;
  const badgeClass = r.classification === 'CONTROLLED_REPLAY' ? 'ok' : 'warn';
  el.meta.innerHTML = `${state.fixtureMetaRaw.eventCount} events`
    + `<span class="wb-badge ${badgeClass}">${r.classification}</span>`
    + `<br/>checksum ${r.checksum.slice(0, 12)}&hellip;`;
}

function renderCandidatePanel() {
  const model = state.candidate && state.candidate.model;
  if (!model) return;
  const rows = Object.entries(model.calibration).map(([key, entry]) => {
    const value = 'value' in entry
      ? `${entry.value}${entry.unit ? ` ${entry.unit}` : ''}`
      : Object.entries(entry).filter(([k]) => !['classification', 'note'].includes(k))
        .map(([k, v]) => `${k}: ${v}`).join(', ');
    return `<tr>
      <td>${key}</td>
      <td class="wb-cal-value">${value}</td>
      <td><span class="wb-cal-tag">${entry.classification}</span></td>
      <td>${entry.note}</td>
    </tr>`;
  }).join('');
  el.candidateDetail.innerHTML = `
    <p><strong>Status:</strong> ${model.status.replace(/_/g, ' ')}. ${model.constructScope}</p>
    <p>The candidate line is drawn as straight segments between exact computed points; increase time
      sampling density above for a visually smoother decay curve (the underlying values are exact
      regardless of sampling - only the on-screen connecting line is a linear approximation).</p>
    <div style="overflow-x:auto"><table class="wb-cal-table">
      <thead><tr><th>Constant</th><th>Value</th><th>Class</th><th>Rationale</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function timeFmt(ms) {
  const d = new Date(ms);
  return d.toISOString().slice(11, 16);
}

function renderTimeline() {
  const report = state.report;
  const svg = el.svg;
  svg.innerHTML = '';
  const width = svg.clientWidth || 900;
  const height = svg.clientHeight || 300;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const margin = { top: 14, right: 34, bottom: 34, left: 96 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const { startMs, endMs } = report.interval;
  const span = Math.max(1, endMs - startMs);

  const x = (t) => margin.left + ((t - startMs) / span) * plotW;
  const rowH = plotH / ROWS.length;
  const yRow = (rowIdx) => margin.top + rowIdx * rowH + rowH / 2;
  const y = (statusValue) => yRow(rowIndex(statusValue));

  const ns = 'http://www.w3.org/2000/svg';
  const make = (tag, attrs) => {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };

  // Row labels + gridlines.
  ROWS.forEach((label, index) => {
    const rowY = margin.top + index * rowH;
    svg.appendChild(make('line', {
      x1: margin.left, x2: width - margin.right, y1: rowY + rowH, y2: rowY + rowH, class: 'wb-gridline',
    }));
    svg.appendChild(make('text', {
      x: margin.left - 8, y: rowY + rowH / 2 + 3, 'text-anchor': 'end', class: 'wb-row-label',
    })).textContent = label.replace('_', ' ');
  });

  // UNKNOWN / observation-gap shading from report.coverage.
  for (const segment of report.coverage || []) {
    if (segment.status !== 'UNKNOWN') continue;
    svg.appendChild(make('rect', {
      x: x(segment.fromMs), y: margin.top, width: Math.max(0, x(segment.toMs) - x(segment.fromMs)),
      height: plotH, class: 'wb-gap-band',
    }));
  }

  // Time gridlines + labels. EVENT WINDOW stays on the original hourly ticks;
  // FULL DAY widens the tick spacing so a 24h span stays readable.
  const tickStepMs = chooseTickStepMs(span, { fullDay: state.view === 'full-day' });
  for (const t of tickTimestamps(startMs, endMs, tickStepMs)) {
    const gx = x(t);
    svg.appendChild(make('line', {
      x1: gx, x2: gx, y1: margin.top, y2: margin.top + plotH, class: 'wb-guide',
    }));
    svg.appendChild(make('text', {
      x: gx, y: height - margin.bottom + 14, 'text-anchor': 'middle', class: 'wb-axis-label',
    })).textContent = timeFmt(t);
  }

  const showCurrent = state.mode !== 'candidate';
  const showCandidate = state.mode !== 'current' && Array.isArray(state.candidate && state.candidate.trajectory);

  // Step-after line for the CURRENT categorical trajectory.
  const points = report.trajectory;
  if (showCurrent) {
    const vertices = stepVertices(points);
    if (vertices.length) {
      let d = `M ${x(vertices[0].timestampMs)} ${yRow(vertices[0].row)}`;
      for (let i = 1; i < vertices.length; i += 1) {
        d += ` L ${x(vertices[i].timestampMs)} ${yRow(vertices[i].row)}`;
      }
      svg.appendChild(make('path', { d, class: 'wb-step-line' }));
    }
  }

  // Continuous line for the CANDIDATE replay-only scalar, on its own 0-1
  // scale mapped onto the same plot height (1=top, matching the categorical
  // rows' "top = most severe" convention). Rendered as straight segments
  // between the exact computed points - see the calibration panel note.
  if (showCandidate) {
    const yLoad = (load) => margin.top + (1 - load) * plotH;
    const series = state.candidate.trajectory;
    let d = `M ${x(series[0].timestampMs)} ${yLoad(series[0].load)}`;
    for (let i = 1; i < series.length; i += 1) {
      d += ` L ${x(series[i].timestampMs)} ${yLoad(series[i].load)}`;
    }
    svg.appendChild(make('path', { d, class: 'wb-candidate-line' }));
    for (const frac of [0, 0.5, 1]) {
      svg.appendChild(make('text', {
        x: width - margin.right + 6, y: yLoad(frac) + 3, class: 'wb-candidate-axis-label',
      })).textContent = frac.toFixed(1);
    }
  }

  // Markers. Same-timestamp EVENT nodes are jittered apart and badged with
  // their sequence number so they stay independently visible and clickable.
  const eventGroups = new Map();
  points.forEach((point, index) => {
    if (point.kind !== 'EVENT') return;
    const key = point.timestampMs;
    if (!eventGroups.has(key)) eventGroups.set(key, []);
    eventGroups.get(key).push(index);
  });

  points.forEach((point, index) => {
    const baseX = x(point.timestampMs);
    const py = y(point.snapshot.anxiety.status);
    const color = ROW_COLOR[ROWS.includes(point.snapshot.anxiety.status) ? point.snapshot.anxiety.status : 'UNKNOWN'];

    if (point.kind === 'SAMPLE') {
      const dot = make('circle', {
        cx: baseX, cy: py, r: 3.4, fill: color, class: 'wb-node wb-node-sample',
        'data-index': index,
      });
      dot.addEventListener('click', () => selectPoint(index));
      svg.appendChild(dot);
      return;
    }

    if (point.kind === 'INITIAL' || point.kind === 'END') {
      const marker = make('rect', {
        x: baseX - 4, y: py - 4, width: 8, height: 8, fill: color, class: 'wb-node',
        'data-index': index,
      });
      marker.addEventListener('click', () => selectPoint(index));
      svg.appendChild(marker);
      svg.appendChild(make('text', {
        x: baseX, y: py - 10, 'text-anchor': 'middle', class: 'wb-event-label',
      })).textContent = point.kind === 'INITIAL' ? 'start' : 'end';
      return;
    }

    // EVENT
    const group = eventGroups.get(point.timestampMs) || [index];
    const slot = group.indexOf(index);
    const jitter = (slot - (group.length - 1) / 2) * 9;
    const cx = baseX + jitter;

    if (group.length > 1 && slot === 0) {
      svg.appendChild(make('line', {
        x1: baseX, x2: baseX, y1: margin.top, y2: margin.top + plotH, class: 'wb-guide',
      }));
    }

    const marker = make('circle', {
      cx, cy: py, r: 6, fill: color, class: 'wb-node wb-node-event', 'data-index': index,
    });
    marker.addEventListener('click', () => selectPoint(index));
    svg.appendChild(marker);

    const label = make('text', {
      x: cx, y: py - 11, 'text-anchor': 'middle', class: 'wb-event-label',
    });
    label.textContent = `#${point.sequence} ${point.eventType}`;
    svg.appendChild(label);
  });

  if (state.selectedIndex != null) highlightSelected();
}

function highlightSelected() {
  for (const node of el.svg.querySelectorAll('[data-index]')) {
    node.classList.toggle('is-selected', Number(node.dataset.index) === state.selectedIndex);
  }
}

function selectPoint(index) {
  state.selectedIndex = index;
  highlightSelected();
  renderInspector(index);
}

function fieldBlock(title, contentHtml) {
  return `<div class="wb-field"><h3>${title}</h3>${contentHtml}</div>`;
}

function candidateField(index) {
  const point = state.candidate && state.candidate.trajectory && state.candidate.trajectory[index];
  if (!point) return '';
  const c = point.components;
  return fieldBlock('Candidate threat-anticipation load (0-1, replay-only)', `<p>
      load = <strong>${point.load.toFixed(2)}</strong>, drive = ${point.drive.toFixed(2)}
    </p>
    <ul>
      <li>severity ${c.severity.toFixed(2)}
        <span class="wb-cal-tag" style="${c.severityBasis === 'GROUNDED_LEARNED_POSTERIOR' ? 'background:rgba(63,178,127,0.18);color:var(--quiet)' : ''}">${c.severityBasis.replace(/_/g, ' ')}</span></li>
      <li>imminence weight ${c.imminenceWeight} for ${c.temporalStatus} <span class="wb-cal-tag">CALIBRATION</span></li>
      <li>control discount ${c.controlDiscount} for ${c.objectiveControllability} <span class="wb-cal-tag">CALIBRATION</span></li>
      <li>ambiguity gain ${c.ambiguityGain} for ${c.worldAmbiguity} <span class="wb-cal-tag">CALIBRATION</span></li>
    </ul>`);
}

function renderInspector(index) {
  if (index == null) {
    el.inspector.innerHTML = '<div class="wb-inspector-empty">Click an event marker, a sample dot, or the line itself to inspect that moment.</div>';
    return;
  }
  const point = state.report.trajectory[index];
  const transition = findTransitionFor(state.report, point);
  const beforeStatus = transition ? transition.before.anxiety.status : point.snapshot.anxiety.status;
  const afterStatus = point.snapshot.anxiety.status;
  const concern = point.snapshot.anxiety.currentConcern;
  const activeContexts = point.snapshot.defensiveContexts.filter((c) => c.active);
  const evidence = (concern && concern.learnedCueOutcomeEvidence) || [];
  const controllability = point.snapshot.controllability || [];

  const eventLine = point.kind === 'EVENT'
    ? `<span class="wb-status-pill wb-status-UNKNOWN" style="background:none;color:var(--text)">#${point.sequence} ${point.eventType}</span> (${point.sourceEventId})`
    : point.kind === 'SAMPLE' ? 'Time sample (no event applied)'
      : point.kind === 'INITIAL' ? 'Replay window start' : 'Replay window end';

  const html = `
    <div class="wb-inspector-grid">
      ${fieldBlock('Timestamp', `<p>${new Date(point.timestampMs).toISOString()}</p>`)}
      ${fieldBlock('Event', `<p>${eventLine}</p>`)}
      ${fieldBlock('Anxiety before / after', `<p>
          <span class="wb-status-pill wb-status-${beforeStatus}">${beforeStatus}</span>
          &rarr;
          <span class="wb-status-pill wb-status-${afterStatus}">${afterStatus}</span>
        </p>`)}
      ${fieldBlock('Active defensive context', activeContexts.length
        ? `<ul>${activeContexts.map((c) => `<li>${c.outcomeClass}: ${c.temporalStatus}, control ${c.objectiveControllability}, ambiguity ${c.worldAmbiguity}, resolution ${c.resolutionStatus}</li>`).join('')}</ul>`
        : '<p>none active</p>')}
      ${fieldBlock('Threat-learning evidence', evidence.length
        ? `<ul>${evidence.map((e) => `<li>${e.cue.label} &rarr; ${e.outcomeClass}: ${e.evidence.status}${e.evidence.posterior ? ` (mean ${e.evidence.posterior.mean.toFixed(2)}, ${e.evidence.posterior.resolvedObservations} resolved obs.)` : ''}</li>`).join('')}</ul>`
        : '<p>no current concern evidence</p>')}
      ${fieldBlock('Controllability evidence', controllability.length
        ? `<ul>${controllability.slice(0, 4).map((c) => `<li>${c.contextId} / ${c.actionId}: action ${c.action ? `${c.action.alpha}/${c.action.alpha + c.action.beta}` : 'n/a'}, no-action ${c.noAction ? `${c.noAction.alpha}/${c.noAction.alpha + c.noAction.beta}` : 'n/a'}</li>`).join('')}</ul>`
        : '<p>no action-outcome evidence recorded yet</p>')}
      ${fieldBlock('Why', `<p class="wb-reason">${describeTransition(point, beforeStatus, afterStatus, concern, precedingEventLabel(state.report.trajectory, index, timeFmt))}</p>`)}
      ${candidateField(index)}
    </div>`;
  el.inspector.innerHTML = html;
}

el.sampleSelect.addEventListener('change', () => {
  state.sampleParam = el.sampleSelect.value;
  loadReplay();
});

for (const [mode, button] of Object.entries(el.modeButtons)) {
  button.addEventListener('click', () => {
    state.mode = mode;
    for (const [otherMode, otherButton] of Object.entries(el.modeButtons)) {
      otherButton.classList.toggle('is-active', otherMode === mode);
    }
    if (state.report) renderTimeline();
  });
}

for (const [view, button] of Object.entries(el.viewButtons)) {
  button.addEventListener('click', () => {
    if (state.view === view) return;
    state.view = view;
    state.selectedIndex = null;
    for (const [otherView, otherButton] of Object.entries(el.viewButtons)) {
      otherButton.classList.toggle('is-active', otherView === view);
    }
    // FULL DAY changes the plotted window, so the server returns a different
    // set of samples: reload the replay rather than only re-drawing.
    loadReplay();
  });
}

el.candidateToggle.addEventListener('click', () => {
  const expanded = el.candidateToggle.getAttribute('aria-expanded') === 'true';
  el.candidateToggle.setAttribute('aria-expanded', String(!expanded));
  el.candidateDetail.hidden = expanded;
});

window.addEventListener('resize', () => {
  if (state.report) renderTimeline();
});

loadFixtures().catch((error) => showStatus(`Failed to load fixtures: ${error.message}`));
