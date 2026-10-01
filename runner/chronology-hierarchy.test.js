import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ChronologyHierarchy } from '../public/assets/chronology-hierarchy.js';

function element(tag) {
  const node = {
    tag, children: [], parentNode: null, attributes: {}, _text: '',
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; return child; },
    setAttribute(name, value) { this.attributes[name] = value; },
    set textContent(value) { this._text = String(value); this.children = []; },
    get textContent() { return this._text; },
  };
  return node;
}
globalThis.document = { createElement: element };

function makeFeed() {
  const container = element('div');
  const hierarchy = new ChronologyHierarchy(container);
  function add(name, minute, text = '', extra = {}, label = text || name, kind = 'event') {
    const ts = `2026-10-01 19:${String(minute).padStart(2, '0')}:00`;
    const payload = { name, text, ...extra };
    return hierarchy.add({ payload, label, detail: text, ts }, () => {
      const single = element('section');
      single.kind = kind;
      single.textContent = label;
      container.appendChild(single);
      return single;
    });
  }
  function barrier(kind) {
    const block = element('article');
    block.kind = kind;
    container.appendChild(block);
    return block;
  }
  return { container, hierarchy, add, barrier };
}

const search = makeFeed();
search.add('cell_search_initiated', 0, "Mr Proctor arrived at Cy's cell to begin a search");
search.add('cell_search_cy_instruction', 1, 'Mr Proctor instructed Cy to stand aside while the cell was searched');
search.add('instrumental_situation', 1, 'Mr Proctor gave Cy a direct instruction and waited for his response');
search.add('instrumental_action', 1, 'The situation resolved via refuse instruction', { action: 'action:refuse_instruction' });
search.add('instrumental_outcome', 1, 'Cy refused; Mr Proctor recorded the refusal', { action: 'action:refuse_instruction' });
search.add('cell_search_search_ongoing', 2, "The search of Cy's cell began");
search.add('cell_search_property_result', 2, 'The search found nothing');
search.add('cell_search_search_complete', 3, 'The officers completed the cell search');
search.add('cell_search_aftermath_observed', 3, 'The cell search ended and Cy remained in the cell');
assert.equal(search.container.children.length, 1, 'one completed search occupies one chronology unit');
const searchGroup = search.container.children[0];
assert.equal(searchGroup.tag, 'details', 'native details provides keyboard-accessible expansion');
assert.equal(searchGroup.children[0].tag, 'summary');
assert.equal(searchGroup.children[1].children.length, 9, 'all original search and related action events remain accessible');
assert.deepEqual(searchGroup.children[1].children.map((row) => row.children[1].children[0].textContent), [
  "Mr Proctor arrived at Cy's cell to begin a search",
  'Mr Proctor instructed Cy to stand aside while the cell was searched',
  'Mr Proctor gave Cy a direct instruction and waited for his response',
  'The situation resolved via refuse instruction',
  'Cy refused; Mr Proctor recorded the refusal',
  "The search of Cy's cell began",
  'The search found nothing',
  'The officers completed the cell search',
  'The cell search ended and Cy remained in the cell',
]);
assert.equal(searchGroup.children[0].children[1].textContent, 'Cell searched - nothing found; Cy refused an instruction');
assert.equal(searchGroup.children[1].children[0].children[1].children.length, 1,
  'title and identical detail are not duplicated inside expansion');
search.add('cell_search_initiated', 5, "Miss Bailey arrived at Cy's cell to begin a search");
assert.equal(search.container.children.length, 2, 'a second search starts a separate unit');

const property = makeFeed();
property.add('cell_search_initiated', 0, "Mr Proctor arrived at Cy's cell to begin a search");
property.add('cell_search_cy_instruction', 1, 'Mr Proctor instructed Cy to stand aside');
property.add('cell_search_search_ongoing', 2, 'The search began');
property.add('cell_search_property_result', 3, 'Officers examined an existing item in the cell');
property.add('instrumental_situation', 3, 'Mr Proctor demanded the loose item');
property.add('instrumental_action', 3, 'The situation resolved via hand over item', { action: 'action:hand_over_item' });
property.add('instrumental_outcome', 3, 'Cy handed it over; Mr Proctor took the item', {
  action: 'action:hand_over_item', consequence: 'item_transferred_search_ended',
});
assert.equal(property.container.children[0].children[0].children[1].textContent, 'Cell searched - item taken',
  'the consequential property outcome stays in the collapsed summary');

const ambient = makeFeed();
ambient.add('no_eggs', 0, '', {}, 'no eggs on the tray');
assert.equal(ambient.container.children[0].tag, 'section', 'one minor event is not wrapped in an accordion');
ambient.add('overheard', 2, '', {}, 'something half-heard down the wing');
ambient.add('cold_tea', 4, '', {}, 'the tea came cold');
assert.equal(ambient.container.children.length, 1, 'a short run of minor incidents becomes one unit');
assert.equal(ambient.container.children[0].children[1].children.length, 3);
ambient.add('social', 5, 'Fisher spoke to Cy', {}, 'Fisher on the spur');
ambient.add('no_eggs', 6, '', {}, 'no eggs on the tray');
assert.equal(ambient.container.children.length, 3, 'a named interaction breaks ambient grouping');
ambient.barrier('journal');
ambient.add('no_eggs', 7, '', {}, 'no eggs on the tray');
assert.equal(ambient.container.children.length, 5, 'journal remains a standalone barrier');
ambient.barrier('postcard');
ambient.add('cold_tea', 8, '', {}, 'the tea came cold');
ambient.barrier('sketch');
ambient.add('no_eggs', 9, '', {}, 'no eggs on the tray');
assert.equal(ambient.container.children.length, 9, 'postcard and sketch also break grouping');
ambient.add('location_transition', 10, 'Cy moved to the yard');
ambient.add('no_eggs', 11, '', {}, 'no eggs on the tray');
assert.equal(ambient.container.children.length, 11, 'movement remains standalone');
ambient.add('lunch_eaten', 12, '', { meal: 'lunch', outcome: 'eaten' }, 'lunch came and Cy ate it');
assert.equal(ambient.container.children.length, 12, 'a real routine meal remains standalone');
ambient.add('no_eggs', 18, '', {}, 'no eggs on the tray');
assert.equal(ambient.container.children.length, 13, 'a substantial time gap starts a new unit');
ambient.add('overheard', 19, 'Fisher said the keys are gone', {}, 'something half-heard down the wing');
assert.equal(ambient.container.children.length, 14, 'an overheard fragment with actual words remains standalone');

const interruption = makeFeed();
interruption.add('cell_search_initiated', 0, "Mr Proctor arrived at Cy's cell to begin a search");
interruption.barrier('journal');
interruption.add('cell_search_cy_instruction', 1, 'Mr Proctor instructed Cy to stand aside');
assert.equal(interruption.container.children.length, 3,
  'a search stage after a journal is not pulled backwards across that writing');
interruption.add('instrumental_situation', 2, 'Miss Bailey gave Cy an unrelated order');
assert.equal(interruption.container.children.length, 4, 'another actor is not silently absorbed into the search');

// Replaying a paginated day rebuilds from the same ordered events. A boundary
// between pages does not duplicate an event or join two distinct searches.
const paged = makeFeed();
const firstPage = [
  ['cell_search_initiated', 0, "Mr Proctor arrived at Cy's cell to begin a search"],
  ['cell_search_cy_instruction', 1, 'Mr Proctor instructed Cy to stand aside'],
];
const secondPage = [
  ['cell_search_search_ongoing', 2, 'The search began'],
  ['cell_search_property_result', 3, 'The search found nothing'],
  ['cell_search_search_complete', 4, 'The search ended'],
];
for (const args of firstPage) paged.add(...args);
for (const args of secondPage) paged.add(...args);
assert.equal(paged.container.children.length, 1, 'live/newer page extends the last eligible search');
assert.equal(paged.container.children[0].children[1].children.length, 5);
const replayed = makeFeed();
for (const args of [...firstPage, ...secondPage]) replayed.add(...args);
assert.equal(replayed.container.children.length, paged.container.children.length,
  'older-page replay produces the same grouped chronology');
assert.deepEqual(replayed.container.children[0].children[1].children.map((row) => row.children[1].children[0].textContent),
  paged.container.children[0].children[1].children.map((row) => row.children[1].children[0].textContent));
const late = paged.add('cell_search_initiated', 6, "Miss Bailey arrived at Cy's cell to begin a search");
assert.equal(paged.container.children[0].children[1].children.length, 5, 'a live second search cannot mutate the first');
assert.equal(paged.container.children[1], late);

const css = readFileSync(new URL('../public/assets/style.css', import.meta.url), 'utf8');
assert.match(css, /\.cy-chronology-group-head:focus-visible/, 'keyboard focus is visible');
assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.cy-chronology-step/, 'mobile layout has compact steps');
assert.match(css, /\.cy-chronology-group-label[^}]*overflow-wrap: anywhere/, 'long wording cannot force horizontal overflow');

console.log('chronology-hierarchy.test.js: all checks passed');
