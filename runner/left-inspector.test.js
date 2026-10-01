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
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parentNode) node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1);
      node.parentNode = this;
      this.children.push(node);
    }
  }
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
    if (selector === '.soma-state-value') return this.reading || null;
    return null;
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  removeEventListener(name) { delete this.listeners[name]; }
  getBoundingClientRect() { return { left: 20, right: 350, top: 110, bottom: 142 }; }
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
  addEventListener: (name, callback) => { documentListeners[name] = callback; },
  removeEventListener: (name) => { delete documentListeners[name]; },
};
const column = new FakeElement();
column.scrollTop = 0;
const header = new FakeElement();
header.getBoundingClientRect = () => ({ bottom: 45 });
const root = {
  querySelector: (selector) => selector === '.col-brain' ? column : selector === '#topbar' ? header : null,
};
const browserWindow = {
  innerWidth: 1400,
  innerHeight: 900,
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame: (callback) => callback(),
};
const inspector = new LeftInspector(root, browserWindow);
const parent = new FakeElement();
const first = new FakeElement();
first.reading = { textContent: 'QUIET' };
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
parent.append(second);
inspector.wrap(second, 'SLEEPINESS', '.soma-state-value');
const secondItem = inspector.items[1];
firstItem.head.listeners.click();
assert.equal(firstItem.body.hidden, false);
assert.equal(firstItem.head.getAttribute('aria-expanded'), 'true');
assert.equal(firstItem.wrapper.classList.contains('is-active'), true);
assert.equal(firstItem.body.style.properties['--cy-inspector-left'], '349px');
assert.equal(firstItem.body.style.properties['--cy-inspector-top'], '110px');
secondItem.head.listeners.click();
assert.equal(firstItem.body.hidden, true);
assert.equal(secondItem.body.hidden, false);
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

browserWindow.innerWidth = 390;
firstItem.head.listeners.click();
assert.equal(firstItem.body.hidden, false, 'mobile uses the same one-active-item state');
inspector.destroy();
assert.equal(observer.disconnected, true);

const css = readFileSync(new URL('../public/assets/left-inspector.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/assets/app.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../public/index.php', import.meta.url), 'utf8');
assert.match(css, /@media \(min-width: 1181px\)[\s\S]*?position: fixed/);
assert.match(css, /width: calc\(100vw - var\(--cy-inspector-left\) - 14px\)/);
assert.match(css, /max-height: calc\(100vh - var\(--cy-inspector-top\) - 14px\)/);
assert.match(css, /@media \(max-width: 1180px\)[\s\S]*?position: static/);
assert.match(css, /\.cy-inspector-body\[hidden\] \{ display: none !important; \}/);
assert.match(css, /\.cy-inspector-head:focus-visible/);
assert.match(app, /brain\.setSoma\(p\.soma\)/);
assert.match(app, /if \(leftInspector\) leftInspector\.refresh\(\)/);
assert.match(index, /assets\/left-inspector\.css/);
assert.match(index, /<section class="col col-paper">[\s\S]*?<aside class="col col-side">/);
console.log('left-inspector.test.js: compact heads, one active panel, accessibility, live updates and responsive geometry passed');
