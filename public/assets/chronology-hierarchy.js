// Presentation-only grouping for the public chronology. The stored event stream
// remains untouched; every grouped step keeps its original text and timestamp.
import { clockOf, timestampMs } from './timeline.js';

const SEARCH_STAGES = [
  'cell_search_initiated',
  'cell_search_cy_instruction',
  'cell_search_search_ongoing',
  'cell_search_property_result',
  'cell_search_search_complete',
  'cell_search_aftermath_observed',
];
const SEARCH_ACTIONS = new Set([
  'action:comply_instruction', 'action:refuse_instruction',
  'action:hand_over_item', 'action:withhold_item',
]);
const SEARCH_GAP_MS = 3 * 60 * 1000;
const AMBIENT_GAP_MS = 6 * 60 * 1000;

function classification(payload, detail) {
  const p = payload || {};
  const name = String(p.name || '');
  if (name === SEARCH_STAGES[0]) return 'search-start';
  if (SEARCH_STAGES.includes(name)) return 'search-stage';
  if (['instrumental_situation', 'instrumental_action', 'instrumental_outcome'].includes(name)) return 'instrumental';
  // These are passing irritations, not meals, conversations or world changes.
  // An overheard fragment with actual words or a mishearing remains standalone.
  if (['no_eggs', 'cold_tea'].includes(name) && !String(detail || '').trim()) return 'ambient';
  if (name === 'overheard' && !p.misheard && !String(detail || '').trim()) return 'ambient';
  return '';
}

function actorFromSearch(text) {
  const match = String(text || '').match(/^(.+?) arrived at Cy's cell to begin a search$/);
  return match ? match[1] : '';
}

// Public search labels often are the event text verbatim. Keep a separate
// detail only when it adds information, including on a standalone stage card.
export function nonDuplicateEventDetail(label, detail) {
  const value = String(detail || '');
  if (!value.trim()) return '';
  const comparable = (text) => String(text || '').trim().replace(/^\[|\]$/g, '')
    .replace(/\s+/g, ' ').replace(/[.!?]+$/g, '').toLowerCase();
  return comparable(label) === comparable(value) ? '' : value;
}

function nextSearchState(unit, record) {
  const p = record.payload;
  // A passing wing/tray notice can land between stages of one real search.
  // Keep at most two such notices inside that search's ordered detail rather
  // than letting one incidental tick fragment the completed episode.
  if (record.type === 'ambient') {
    if (unit.stageIndex === SEARCH_STAGES.length - 1 || unit.instrumental || unit.incidentalCount >= 2) return null;
    return { stageIndex: unit.stageIndex, instrumental: null, incidentalCount: unit.incidentalCount + 1 };
  }
  if (record.type === 'search-stage') {
    const index = SEARCH_STAGES.indexOf(String(p.name || ''));
    if (index <= unit.stageIndex || unit.stageIndex === SEARCH_STAGES.length - 1 || unit.instrumental) return null;
    return { stageIndex: index, instrumental: null };
  }
  if (record.type !== 'instrumental' || !unit.actor) return null;
  if (p.name === 'instrumental_situation') {
    if (unit.instrumental || ![1, 3].includes(unit.stageIndex)
      || !String(p.text || '').startsWith(unit.actor + ' ')) return null;
    return { stageIndex: unit.stageIndex, instrumental: { phase: 'situation', action: null } };
  }
  if (p.name === 'instrumental_action') {
    if (unit.instrumental?.phase !== 'situation' || !SEARCH_ACTIONS.has(p.action)) return null;
    return { stageIndex: unit.stageIndex, instrumental: { phase: 'action', action: p.action } };
  }
  if (p.name === 'instrumental_outcome') {
    if (unit.instrumental?.phase !== 'action' || p.action !== unit.instrumental.action) return null;
    return { stageIndex: unit.stageIndex, instrumental: null };
  }
  return null;
}

function sameShortRun(unit, record, maxGap) {
  const at = timestampMs(record.ts);
  const first = timestampMs(unit.items[0].ts);
  return at != null && first != null && record.ts.slice(0, 10) === unit.items[0].ts.slice(0, 10)
    && at >= unit.lastMs && at - unit.lastMs <= maxGap && at - first <= 12 * 60 * 1000;
}

function outcomeText(unit) {
  let result = '';
  let refused = false;
  for (const item of unit.items) {
    const p = item.payload;
    if (p.name === 'cell_search_property_result') {
      if (/found nothing/i.test(String(p.text || ''))) result = 'nothing found';
      else if (/examined an existing item/i.test(String(p.text || ''))) result = 'item examined';
    }
    if (p.name === 'instrumental_outcome') {
      if (p.consequence === 'item_transferred_search_ended') result = 'item taken';
      if (p.consequence === 'cell_searched_item_retained') result = 'item kept';
      if (p.action === 'action:refuse_instruction') refused = true;
    }
  }
  const completed = unit.stageIndex === SEARCH_STAGES.length - 1 || result === 'item taken' || result === 'item kept';
  const actor = unit.actor ? ` by ${unit.actor}` : '';
  const base = completed ? `Cell searched${actor}` : `Cell search${actor} underway`;
  const summary = result ? `${base} - ${result}` : base;
  return refused ? `${summary}; Cy refused an instruction` : summary;
}

function groupLabel(unit) {
  if (unit.type === 'search') return outcomeText(unit);
  const same = unit.items.every((item) => item.label === unit.items[0].label);
  return same ? `${unit.items.length} times: ${unit.items[0].label}`
    : `${unit.items.length} passing moments`;
}

function groupTime(unit) {
  const first = clockOf(unit.items[0].ts);
  const last = clockOf(unit.items[unit.items.length - 1].ts);
  return first === last ? first : `${first} - ${last}`;
}

function makeGroup(unit) {
  const element = document.createElement('details');
  element.className = `cy-chronology-group cy-chronology-${unit.type}`;
  const head = document.createElement('summary');
  head.className = 'cy-chronology-group-head';
  const time = document.createElement('span');
  time.className = 'cy-chronology-group-time';
  const label = document.createElement('span');
  label.className = 'cy-chronology-group-label';
  const cue = document.createElement('span');
  cue.className = 'cy-chronology-group-cue';
  cue.textContent = 'DETAILS';
  head.appendChild(time);
  head.appendChild(label);
  head.appendChild(cue);
  const steps = document.createElement('div');
  steps.className = 'cy-chronology-steps';
  element.appendChild(head);
  element.appendChild(steps);
  unit.element = element;
  unit.time = time;
  unit.labelNode = label;
  unit.steps = steps;
  return element;
}

function appendStep(unit, record) {
  const row = document.createElement('div');
  row.className = 'cy-chronology-step';
  const time = document.createElement('time');
  time.textContent = clockOf(record.ts);
  const words = document.createElement('div');
  words.className = 'cy-chronology-step-words';
  const title = document.createElement('span');
  title.textContent = record.label;
  words.appendChild(title);
  // Several existing search cards repeat the exact same text as title and body.
  // Keep the fact once, while retaining genuinely additional detail.
  const extraDetail = nonDuplicateEventDetail(record.label, record.detail);
  if (extraDetail) {
    const detail = document.createElement('span');
    detail.className = 'cy-chronology-step-detail';
    detail.textContent = extraDetail;
    words.appendChild(detail);
  }
  row.appendChild(time);
  row.appendChild(words);
  unit.steps.appendChild(row);
}

function refreshGroup(unit) {
  unit.time.textContent = groupTime(unit);
  unit.labelNode.textContent = groupLabel(unit);
  unit.element.setAttribute('aria-label', `${groupLabel(unit)}; ${unit.items.length} events. Expand for each event in time order.`);
}

export class ChronologyHierarchy {
  constructor(container) {
    this.container = container;
    this.last = null;
  }

  reset() {
    this.last = null;
  }

  add({ payload = {}, label = '', detail = '', ts = '' }, renderSingle) {
    const record = {
      payload, label: String(label), detail: String(detail), ts: String(ts),
      type: classification(payload, detail),
    };
    const unit = this.last;
    const stillLast = unit && this.container.children[this.container.children.length - 1] === unit.element;
    let nextState = null;
    if (stillLast && unit.type === 'ambient' && record.type === 'ambient'
      && sameShortRun(unit, record, AMBIENT_GAP_MS)) nextState = {};
    if (stillLast && unit.type === 'search' && record.type !== 'search-start'
      && sameShortRun(unit, record, SEARCH_GAP_MS)) nextState = nextSearchState(unit, record);
    if (nextState) {
      if (!unit.steps) {
        this.container.removeChild(unit.element);
        this.container.appendChild(makeGroup(unit));
        for (const item of unit.items) appendStep(unit, item);
      }
      unit.items.push(record);
      unit.lastMs = timestampMs(record.ts);
      if (unit.type === 'search') {
        unit.stageIndex = nextState.stageIndex;
        unit.instrumental = nextState.instrumental;
        unit.incidentalCount = nextState.incidentalCount ?? unit.incidentalCount;
      }
      appendStep(unit, record);
      refreshGroup(unit);
      return unit.element;
    }
    if (record.type === 'search-start') {
      const search = {
        type: 'search', items: [record], lastMs: timestampMs(record.ts),
        stageIndex: 0, instrumental: null, incidentalCount: 0, actor: actorFromSearch(payload.text),
      };
      this.container.appendChild(makeGroup(search));
      appendStep(search, record);
      refreshGroup(search);
      this.last = search;
      return search.element;
    }
    const element = renderSingle();
    this.last = record.type === 'ambient'
      ? { type: 'ambient', items: [record], lastMs: timestampMs(record.ts), element }
      : null;
    return element;
  }
}
