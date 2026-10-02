import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LeftInspector } from '../public/assets/left-inspector.js';

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this.extraClasses = new Set();
    this.classList = {
      add: (name) => this.extraClasses.add(name),
      remove: (name) => this.extraClasses.delete(name),
      contains: (name) => this.extraClasses.has(name) || this.className.split(/\s+/).includes(name),
    };
    this.attributes = {};
    this.listeners = {};
    this.style = { properties: {}, setProperty: (name, value) => { this.style.properties[name] = value; } };
    this.hidden = false;
    this.isConnected = true;
    this.textContent = '';
    this.dataset = {};
    this.open = false;
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parentNode) node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1);
      node.parentNode = this;
      this.children.push(node);
    }
  }
  appendChild(node) { this.append(node); return node; }
  insertBefore(node, before) {
    if (node.parentNode) node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1);
    node.parentNode = this;
    this.children.splice(this.children.indexOf(before), 0, node);
  }
  closest(selector) {
    const name = selector.slice(1);
    for (let node = this; node; node = node.parentNode) if (node.classList.contains(name)) return node;
    return null;
  }
  querySelector(selector) {
    if (this.reading && selector === this.readingSelector) return this.reading;
    if (/^\.[a-z-]+$/.test(selector)) {
      const name = selector.slice(1);
      for (const child of this.children) {
        if (child.classList.contains(name)) return child;
        const descendant = child.querySelector(selector);
        if (descendant) return descendant;
      }
    }
    return null;
  }
  querySelectorAll(selector) {
    if (selector === ':scope > .soma-state-entry') {
      return this.children.filter((child) => child.classList.contains('soma-state-entry'));
    }
    return [];
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  removeEventListener(name) { delete this.listeners[name]; }
  getBoundingClientRect() { return this.rect || { left: 20, right: 350, top: 110, bottom: 142 }; }
  focus() { this.focused = true; }
  contains(node) { for (let current = node; current; current = current.parentNode) if (current === this) return true; return false; }
}

let observer;
globalThis.MutationObserver = class {
  constructor(callback) { this.callback = callback; observer = this; }
  observe() {}
  disconnect() { this.disconnected = true; }
};
const documentListeners = {};
globalThis.document = {
  createElement: (tag) => new FakeElement(tag),
  body: new FakeElement('body'),
  addEventListener: (name, callback) => { documentListeners[name] = callback; },
  removeEventListener: (name) => { delete documentListeners[name]; },
};
const column = new FakeElement();
column.scrollTop = 0;
const header = new FakeElement();
header.getBoundingClientRect = () => ({ bottom: 45 });
const layout = new FakeElement();
layout.getBoundingClientRect = () => ({ top: 59 });
const root = {
  brain: null,
  querySelector(selector) {
    return selector === '.col-brain' ? column : selector === '#topbar' ? header
      : selector === '.layout' ? layout
      : selector === '#brain' ? this.brain : null;
  },
};
const browserWindow = {
  innerWidth: 1400,
  innerHeight: 900,
  listeners: {},
  addEventListener(name, callback) { this.listeners[name] = callback; },
  removeEventListener(name) { delete this.listeners[name]; },
  requestAnimationFrame: (callback) => callback(),
};
const inspector = new LeftInspector(root, browserWindow);
const parent = new FakeElement();
const first = new FakeElement();
first.reading = { textContent: 'QUIET' };
first.readingSelector = '.soma-state-value';
const graph = new FakeElement('svg');
graph.className = 'soma-history';
first.append(graph);
parent.append(first);
inspector.wrap(first, 'ANXIETY', '.soma-state-value');
const firstItem = inspector.items[0];
assert.equal(firstItem.head.children[0].textContent, 'ANXIETY');
assert.equal(firstItem.value.textContent, 'QUIET');
assert.equal(firstItem.body.hidden, true);
assert.equal(firstItem.body.contains(graph), true, 'the original graph remains in the detail body');
assert.equal(firstItem.head.getAttribute('aria-controls'), firstItem.body.id);
assert.equal(firstItem.body.getAttribute('aria-labelledby'), firstItem.head.id);

const second = new FakeElement();
second.reading = { textContent: '62' };
second.readingSelector = '.soma-state-value';
parent.append(second);
inspector.wrap(second, 'SLEEPINESS', '.soma-state-value');
const secondItem = inspector.items[1];
firstItem.head.listeners.click();
assert.equal(firstItem.body.hidden, false);
assert.equal(firstItem.head.getAttribute('aria-expanded'), 'true');
assert.equal(firstItem.wrapper.classList.contains('is-active'), true);
assert.equal(firstItem.body.style.properties['--cy-inspector-left'], '349px');
assert.equal(firstItem.body.style.properties['--cy-inspector-top'], '89px',
  'a top-row panel begins close to its head while respecting the workspace gutter');
secondItem.head.rect = { left: 20, right: 350, top: 380, bottom: 412 };
secondItem.head.listeners.click();
assert.equal(firstItem.body.hidden, true);
assert.equal(secondItem.body.hidden, false);
assert.equal(secondItem.body.style.properties['--cy-inspector-top'], '89px',
  'a middle-row panel uses the viewport top instead of the row top');
assert.equal(inspector.items.filter((item) => !item.body.hidden).length, 1);
secondItem.head.listeners.click();
assert.equal(inspector.items.filter((item) => !item.body.hidden).length, 0);

firstItem.head.listeners.click();
documentListeners.keydown({ key: 'Escape' });
assert.equal(firstItem.body.hidden, true);
assert.equal(firstItem.head.focused, true);
firstItem.head.listeners.click();
documentListeners.pointerdown({ target: secondItem.head });
assert.equal(firstItem.body.hidden, true);
first.reading.textContent = 'THREAT ONGOING';
firstItem.observer.callback();
assert.equal(firstItem.value.textContent, 'THREAT ONGOING', 'live source updates reach the compact head');
firstItem.head.listeners.click();
firstItem.head.rect = { left: 20, right: 370, top: 670, bottom: 702 };
browserWindow.listeners.scroll();
assert.equal(firstItem.body.style.properties['--cy-inspector-left'], '369px',
  'window scrolling keeps the panel attached to the head edge');
assert.equal(firstItem.body.style.properties['--cy-inspector-top'], '89px',
  'window scrolling does not drag a long panel down with a low head');
firstItem.head.listeners.click();

browserWindow.innerWidth = 390;
firstItem.head.listeners.click();
assert.equal(firstItem.body.hidden, false, 'mobile uses the same one-active-item state');
inspector.destroy();
assert.equal(observer.disconnected, true);

// Rebuild the actual left-pane hierarchy: four promoted rows stay at the top
// and every other original reading moves into one native expandable section.
const brain = new FakeElement();
const overview = new FakeElement('nav');
overview.className = 'soma-overview';
const promoted = [
  ['soma-anxiety-promoted', 'ANXIETY', '.soma-state-value'],
  ['soma-sleep-pressure-promoted', 'SLEEP PRESSURE', '.sleep-pressure-value'],
  ['soma-satiety-promoted', 'SATIETY', '.soma-state-value'],
  ['soma-harm-promoted', 'HARM', '.soma-state-value'],
];
const promotedNodes = promoted.map(([className, , valueSelector]) => {
  const node = new FakeElement();
  node.className = className;
  node.reading = { textContent: 'CURRENT' };
  node.readingSelector = valueSelector;
  return node;
});
const legacy = new FakeElement('details');
legacy.className = 'soma-legacy-quarantine';
const readout = new FakeElement();
readout.className = 'soma-public-readout';
legacy.append(readout);
const supporting = [
  ['arousal', 'LEGACY ACTIVATION HEURISTIC'],
  ['sleepiness', 'PREDICTED SLEEPINESS'],
  ['loneliness', 'SOCIAL CONTACT / ISOLATION'],
  ['anger', 'LEGACY ACTIVATION HEURISTIC (ANGER)'],
  ['rumination', 'RUMINATION / FIXATION'],
];
const supportingNodes = new Map();
for (const [key, label] of supporting) {
  const entry = new FakeElement('details');
  entry.className = 'soma-state-entry';
  entry.dataset.metric = key;
  const name = new FakeElement('span');
  name.className = 'soma-state-label';
  name.textContent = label;
  const value = new FakeElement('strong');
  value.className = 'soma-state-value';
  value.textContent = 'INITIAL';
  const chart = new FakeElement('svg');
  chart.className = 'soma-history';
  entry.append(name, value, chart);
  readout.append(entry);
  supportingNodes.set(key, { entry, value, chart });
}
const howItWorks = new FakeElement('p');
howItWorks.className = 'soma-how-it-works-link';
brain.append(overview, ...promotedNodes, howItWorks, legacy);
root.brain = brain;
browserWindow.innerWidth = 1400;
const hierarchy = new LeftInspector(root, browserWindow);
const topLevel = brain.children.filter((child) => child.classList.contains('cy-inspector-item'));
assert.deepEqual(topLevel.map((child) => child.children[0].children[0].textContent),
  promoted.map(([, label]) => label), 'only the four promoted readings are primary rows');
const section = brain.querySelector('.cy-supporting-readings');
assert.equal(section.tagName, 'DETAILS');
assert.equal(section.open, false, 'supporting material is subordinate by default');
assert.equal(section.children[0].textContent, 'SUPPORTING STATE / DIAGNOSTICS');
const supportingIndex = section.querySelector('.cy-other-readings');
assert.deepEqual(supportingIndex.children.map((child) => child.children[0].children[0].textContent),
  [...supporting.map(([, label]) => label), 'PREVIOUS MODELS / DIAGNOSTICS']);
assert.equal(supportingIndex.children.length, 6, 'no detail panel or diagnostic group was discarded');
const previousModels = hierarchy.items.find((item) => item.head.title === 'PREVIOUS MODELS / DIAGNOSTICS');
previousModels.head.rect = { left: 20, right: 350, top: 710, bottom: 742 };
section.open = true;
previousModels.head.listeners.click();
assert.equal(previousModels.body.style.properties['--cy-inspector-top'], '89px',
  'the large low-row diagnostic panel extends above its selected head');
assert.equal(column.scrollTop, 0, 'opening a low row does not move the selected head');
assert.equal(previousModels.body.getAttribute('aria-labelledby'), previousModels.head.id,
  'the floating detail body retains its semantic link to the selected row');
previousModels.head.listeners.click();
const world = new FakeElement();
world.className = 'world-inspection-panel';
brain.append(world);
hierarchy.wrap(world, 'CONTEXT / WORLD INSPECTION', null, 'ADMIN');
const worldItem = hierarchy.items.find((item) => item.head.title === 'CONTEXT / WORLD INSPECTION');
worldItem.head.rect = { left: 20, right: 350, top: 760, bottom: 792 };
worldItem.head.listeners.click();
assert.equal(worldItem.body.style.properties['--cy-inspector-top'], '89px',
  'the admin world inspector receives the same low-row viewport geometry');
worldItem.head.listeners.click();
const social = hierarchy.items.find((item) => item.head.title === 'SOCIAL CONTACT / ISOLATION');
social.head.listeners.click();
assert.equal(social.body.hidden, false);
assert.equal(social.body.contains(supportingNodes.get('loneliness').chart), true,
  'the original detail/history DOM remains bound to the moved row');
supportingNodes.get('loneliness').value.textContent = 'CONTACT ONGOING';
social.observer.callback();
assert.equal(social.value.textContent, 'CONTACT ONGOING', 'live values still update in moved heads');
section.open = false;
section.listeners.toggle();
assert.equal(social.body.hidden, true, 'closing the group closes a desktop detail panel');
hierarchy.refresh();
assert.equal(brain.querySelector('.cy-supporting-readings'), section, 'refresh reuses the same section');
assert.equal(supportingIndex.children.length, 6, 'refresh does not duplicate subordinate rows');
browserWindow.innerWidth = 390;
section.open = true;
const rumination = hierarchy.items.find((item) => item.head.title === 'RUMINATION / FIXATION');
rumination.head.listeners.click();
assert.equal(rumination.body.hidden, false, 'mobile can open a moved detail panel');
documentListeners.keydown({ key: 'Escape' });
assert.equal(rumination.body.hidden, true);
assert.equal(rumination.head.focused, true, 'keyboard dismissal restores focus');
hierarchy.destroy();

const css = readFileSync(new URL('../public/assets/left-inspector.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/assets/app.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../public/index.php', import.meta.url), 'utf8');
const brainSource = readFileSync(new URL('../public/assets/brain.js', import.meta.url), 'utf8');
assert.match(css, /@media \(min-width: 1181px\)[\s\S]*?position: fixed/);
assert.match(css, /width: calc\(100vw - var\(--cy-inspector-left\) - 14px\)/);
assert.match(css, /max-height: calc\(100vh - var\(--cy-inspector-top\) - 14px\)/);
assert.match(css, /\.cy-inspector-body \{[\s\S]*?overflow: auto;/,
  'large detail content scrolls inside the viewport-bounded body');
assert.match(css, /\.cy-inspector-item\.is-active > \.cy-inspector-head::after \{[\s\S]*?pointer-events: none;/,
  'the selected row has a visual bridge to its floating detail body');
assert.match(css, /@media \(max-width: 1180px\)[\s\S]*?position: static/);
assert.match(css, /@media \(max-width: 1180px\)[\s\S]*?width: 100%;[\s\S]*?max-height: min\(72vh, 740px\)/,
  'mobile keeps its bounded inline panel instead of desktop floating geometry');
assert.match(css, /\.cy-inspector-body\[hidden\] \{ display: none !important; \}/);
assert.match(css, /\.cy-inspector-head:focus-visible/);
assert.match(css, /\.cy-supporting-readings > summary:focus-visible/);
assert.match(css, /\.cy-left-inspector-ready \.soma-overview-grid \{ display: none; \}/);
assert.match(brainSource, /<div class="soma-overview-title">CURRENT INNER STATE<\/div>/);
assert.match(app, /brain\.setSoma\(p\.soma\)/);
assert.match(app, /if \(leftInspector\) leftInspector\.refresh\(\)/);
assert.match(index, /assets\/left-inspector\.css/);
assert.match(index, /<section class="col col-paper">[\s\S]*?<aside class="col col-side">/);
console.log('left-inspector.test.js: compact heads, one active panel, accessibility, live updates and responsive geometry passed');
