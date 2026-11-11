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
    click() { this.clicked = true; }
    remove() { this.removed = true; }
  }
  const downloads = [];
  const document = {
    baseURI: 'http://localhost/calculator/',
    body: { append(link) { downloads.push(link); } },
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
    postMessage(data) { this.sent = data; }
    terminate() { this.terminated = true; }
  }
  class TestURL extends URL {}
  TestURL.createObjectURL = () => 'blob:report';
  TestURL.revokeObjectURL = () => {};
  const periods = { modern: [], ancient: [] };
  const window = { document, G25_K12B_DATA: { sets: Object.fromEntries(
    ['yakinlik1', 'yakinlik2tr', 'ikili1', 'ikili2tr'].map((id) => [id, periods])) } };
  const context = vm.createContext({ window, document, Worker, URL: TestURL, Blob, setTimeout() {},
    location: { protocol: 'http:' } });
  for (const file of ['core.js', 'admixture_charts.js', 'k12b.js', 'report_pdf.js', 'raw_data_ui.js'])
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
  return { $, click, key, start, window, document, downloads, lastWorker: () => worker };
}

test('browser PDF module can calculate K12b Oracle from the exposed K12b API', () => {
  const { window } = workspace();
  assert.equal(typeof window.G25K12B.nearest, 'function');
  const report = window.G25ReportPdf.buildReport({ sample: 'Sample',
    results: { k12b: { fit: { proportions: Array(12).fill(1 / 12) } } },
    g25: Array(25).fill(0), health: null, references: [], analysisFits: {} });
  assert.equal(report.sections[4].title, 'K12b Oracle · Modern');
  assert.equal(report.sections[5].title, 'K12b Oracle · Modern two-population fits');
  assert.equal(report.sections[6].title, 'K12b Oracle · Ancient');
  assert.equal(report.sections[7].title, 'K12b Oracle · All (Modern + Ancient)');
});

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

test('raw DNA worker forwards the blood group estimate to Health', () => {
  const { start, window } = workspace();
  let received;
  window.G25HealthUI = { reset() {}, setMatches(matches, bloodType) {
    received = { matches, bloodType };
  } };
  const worker = start();
  const bloodType = { abo: 'A', basis: 'direct', rhD: null };
  worker.onmessage({ data: { type: 'health', matches: [], bloodType } });
  assert.deepEqual(received, { matches: [], bloodType });
});

test('Download results creates a PDF after fitting without requesting four-way fits', async () => {
  const { $, click, start, window, downloads, lastWorker } = workspace();
  let payload;
  window.G25ReportPdf = { buildReport(input) { payload = input; return { sections: [] }; },
    createPdf() { return new Blob(['%PDF-1.4'], { type: 'application/pdf' }); } };
  const rawWorker = start();
  rawWorker.onmessage({ data: { type: 'health', matches: [], bloodType: { observed: [] } } });
  rawWorker.onmessage({ data: { type: 'result', id: 'k12b',
    fit: { proportions: Array(12).fill(1 / 12), converged: true, iterations: 5 },
    stats: { matched: 50000, total: 160000, coverage: .3125, flipped: 0, incompatible: 0 } } });
  rawWorker.onmessage({ data: { type: 'result', id: 'k36',
    components: Array.from({ length: 36 }, (_, i) => `Component_${i}`),
    fit: { proportions: Array(36).fill(1 / 36), converged: true, iterations: 5 },
    g25: Array(25).fill(0),
    stats: { matched: 50000, total: 160000, coverage: .3125, flipped: 0, incompatible: 0 } } });
  assert.equal($('raw-export').disabled, true, 'wait for the Health and model worker to finish');
  rawWorker.onmessage({ data: { type: 'done' } });
  assert.equal($('raw-export').disabled, false);
  click('raw-export');
  const reportWorker = lastWorker();
  assert.match(reportWorker.sent.target.label, /synthetic_simulated_scaled/);
  reportWorker.onmessage({ data: { type: 'result', fits: {
    relaxedModern: [], relaxedAncient: [], strictModern: [],
  } } });
  await new Promise(setImmediate);
  assert.equal(payload.sample, 'synthetic');
  assert.equal(payload.analysisFits.strictModern.length, 0);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].download, 'synthetic_ancestry.pdf');
  assert.equal(downloads[0].clicked, true);
  assert.equal($('raw-export').disabled, false);
});
