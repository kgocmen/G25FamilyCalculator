const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function workspace() {
  const elements = new Map();
  class Element {
    constructor(tag = 'div') {
      this.tag = tag; this.children = []; this.listeners = {}; this.style = {};
      this.value = ''; this.files = []; this.dataset = {}; this.classList = { toggle() {} };
      this.ownerDocument = document;
    }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    focus() { document.activeElement = this; }
  }
  const document = {
    baseURI: 'http://localhost/calculator/',
    getElementById(id) { return elements.get(id); },
    querySelector() { return elements.get('subtabs'); },
    createElement(tag) { return new Element(tag); },
    createElementNS(ns, tag) { return new Element(tag); },
  };
  const html = fs.readFileSync(path.join(__dirname, '../calculator/index.html'), 'utf8');
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) elements.set(id, new Element());
  elements.set('subtabs', new Element());
  elements.get('k12b-reference-category').value = 'modern';
  let worker;
  class Worker {
    constructor() { worker = this; }
    postMessage() {}
    terminate() { this.terminated = true; }
  }
  const periods = { modern: [], ancient: [] };
  const window = { document, G25_K12B_DATA: { sets: Object.fromEntries(
    ['yakinlik1', 'yakinlik2tr', 'ikili1', 'ikili2tr'].map((id) => [id, periods])) } };
  const context = vm.createContext({ window, document, Worker, URL, location: { protocol: 'http:' } });
  for (const file of ['admixture_charts.js', 'k12b.js', 'raw_data_ui.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../calculator', file), 'utf8'), context);
  window.G25RawDataUI.init(() => {});
  const $ = (id) => elements.get(id);
  const click = (id) => $(id).listeners.click();
  const key = (id, name) => $(id).listeners.keydown({ key: name, preventDefault() {} });
  const start = () => {
    $('raw-file').files = [{ name: 'synthetic.txt', size: 100 }];
    $('raw-file').listeners.change(); click('raw-run');
    return worker;
  };
  return { $, click, key, start, window, document };
}

test('Health is independent of ancestry results; tabs wrap and reset to K12b Chart', () => {
  const { $, click, key, start, document } = workspace();
  const worker = start();
  key('raw-model-tabs', 'End');
  assert.equal($('raw-health').hidden, false);
  assert.equal(document.activeElement, $('raw-health-tab'));
  key('raw-model-tabs', 'ArrowRight');
  assert.equal($('raw-k12b').hidden, false);
  key('raw-model-tabs', 'ArrowLeft');
  assert.equal($('raw-health').hidden, false);
  worker.onmessage({ data: { type: 'result', id: 'k12b',
    fit: { proportions: [1, ...Array(11).fill(0)], converged: true, iterations: 5 },
    stats: { matched: 50000, total: 160000, coverage: .3125, flipped: 0, incompatible: 0 } } });
  assert.equal($('raw-health').hidden, false, 'an arriving result must preserve the chosen tab');
  assert.equal($('raw-k12b-chart').hidden, false);
  assert.equal($('k12b-chart').children[0].children[0].tag, 'circle');
  click('raw-k12b-tab');
  key('subtabs', 'End');
  assert.equal($('raw-k12b-oracle').hidden, false);
  key('subtabs', 'ArrowRight');
  assert.equal($('raw-k12b-chart').hidden, false);
  click('raw-k12b-oracle-tab');
  click('raw-reset');
  assert.equal($('raw-k12b').hidden, false);
  assert.equal($('raw-k12b-chart').hidden, false);
  assert.equal($('raw-health').hidden, true);
  assert.equal($('k12b-chart').children.length, 0);
});

test('K36 renders a normalized pie and all 36 legend rows, then clears both', () => {
  const { $, click, start } = workspace();
  const worker = start();
  worker.onmessage({ data: { type: 'result', id: 'k36',
    components: Array.from({ length: 36 }, (_, i) => 'Component_' + i),
    fit: { proportions: [3, 1, ...Array(34).fill(0)], converged: true, iterations: 5 },
    stats: { matched: 50000, total: 160000, coverage: .3125, flipped: 0, incompatible: 0 } } });
  click('raw-k36-tab');
  assert.equal($('raw-k36').hidden, false);
  const svg = $('raw-k36-chart').children[0];
  assert.equal(svg.children.length, 2);
  assert.equal(svg.children[0].children[0].textContent, 'Component 0 75.00%');
  assert.equal($('raw-k36-table').children.length, 36);
  assert.equal($('raw-k36-copy-row').disabled, false);
  click('raw-reset');
  assert.equal($('raw-k36-chart').children.length, 0);
  assert.equal($('raw-k36-table').children.length, 0);
  assert.equal($('raw-k36-copy-row').disabled, true);
});
