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
  const analyses = [];
  window.G25RawDataUI.init((profile) => analyses.push(profile));
  const $ = (id) => elements.get(id);
  const click = (id) => $(id).listeners.click();
  const key = (id, name) => $(id).listeners.keydown({ key: name, preventDefault() {} });
  const start = () => {
    $('raw-file').files = [{ name: 'synthetic.txt', size: 100 }];
    $('raw-file').listeners.change(); click('raw-run');
    return worker;
  };
  return { $, click, key, start, window, document, downloads, analyses, lastWorker: () => worker };
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

test('K12b status identifies the Turkish Genomics method and its partial allele coverage', () => {
  const { $, start } = workspace();
  const worker = start();
  worker.onmessage({ data: { type: 'result', id: 'k12b',
    fit: { proportions: [1, ...Array(11).fill(0)], converged: true, iterations: 90,
      method: 'turkish-genomics-k12b-8d9f0cbc' },
    stats: { matched: 50000, total: 166770, coverage: 50000 / 166770, partial: 12, incompatible: 34 } } });
  assert.match($('raw-k12b-status').textContent, /Completed in 90 iterations/);
  assert.match($('raw-k12b-status').textContent, /12 SNPs used one reported allele/);
});

test('calculated K12b percentages render at full precision before display rounding', () => {
  const { $, window } = workspace();
  const values = [.156450001, .843549999, ...Array(10).fill(0)];
  window.G25K12BUI.setProfile(values);
  assert.equal($('k12b-table').children[0].children[2].textContent, '15.65%');
  assert.equal($('k12b-table').children[1].children[2].textContent, '84.35%');
});

test('selecting another raw file refreshes the sample name and stops the previous calculation', () => {
  const { $, start } = workspace();
  const worker = start();
  assert.equal($('raw-sample-name').value, 'synthetic');
  $('raw-sample-name').value = 'Previous custom name';
  $('raw-file').files = [{ name: 'Next sample.csv', size: 100 }];
  $('raw-file').listeners.change();
  assert.equal($('raw-sample-name').value, 'Next sample');
  assert.equal(worker.terminated, true);
  $('raw-file').files = [];
  $('raw-file').listeners.change();
  assert.equal($('raw-sample-name').value, '');
});

test('K12b summary shows Medieval Turkic as a rounded integer percentage', () => {
  const { $, window } = workspace();
  const values = [.8946, .039, ...Array(7).fill(0), .0664, 0, 0];
  window.G25K12BUI.setProfile(values);
  const card = $('k12b-summary').children[1];
  assert.equal(card.children[0].textContent, 'Medieval Turkic');
  assert.equal(card.children[1].textContent, '24%');
});

test('Health is independent of ancestry results; tabs wrap and reset to G25', () => {
  const { $, click, key, start, document } = workspace();
  const worker = start();
  key('raw-model-tabs', 'End');
  assert.equal($('raw-health').hidden, false);
  assert.equal(document.activeElement, $('raw-health-tab'));
  key('raw-model-tabs', 'ArrowRight');
  assert.equal($('raw-g25').hidden, false);
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
  assert.equal($('raw-g25').hidden, false);
  assert.equal($('raw-k12b-chart').hidden, false);
  assert.equal($('raw-health').hidden, true);
  assert.equal($('k12b-chart').children.length, 0);
});

test('K36 sorts the pie and legend descending while retaining component colors and model order', () => {
  const { $, click, start } = workspace();
  const worker = start();
  const components = Array.from({ length: 36 }, (_, i) => 'Component_' + i);
  const proportions = [1, 3, ...Array(34).fill(0)];
  worker.onmessage({ data: { type: 'result', id: 'k36',
    components,
    fit: { proportions, converged: true, iterations: 5 },
    stats: { matched: 50000, total: 160000, coverage: .3125, flipped: 0, incompatible: 0 } } });
  click('raw-k36-tab');
  assert.equal($('raw-k36').hidden, false);
  const svg = $('raw-k36-chart').children[0];
  assert.equal(svg.children.length, 2);
  assert.equal(svg.children[0].children[0].textContent, 'Component 1 75.00%');
  assert.equal(svg.children[1].children[0].textContent, 'Component 0 25.00%');
  assert.equal(svg.children[0].fill, 'hsl(137.508 55% 52%)');
  assert.equal(svg.children[1].fill, 'hsl(0 55% 52%)');
  assert.equal($('raw-k36-table').children.length, 36);
  const rows = $('raw-k36-table').children;
  assert.equal(rows[0].children[1].textContent, 'Component 1');
  assert.equal(rows[0].children[2].textContent, '75.00%');
  assert.equal(rows[0].children[0].style.backgroundColor, svg.children[0].fill);
  assert.equal(rows[1].children[1].textContent, 'Component 0');
  assert.equal(rows[1].children[0].style.backgroundColor, svg.children[1].fill);
  assert.equal(rows[2].children[1].textContent, 'Component 2');
  assert.deepEqual(proportions, [1, 3, ...Array(34).fill(0)]);
  assert.equal(components[0], 'Component_0');
  assert.equal($('raw-k36-copy-row').disabled, false);
  click('raw-reset');
  assert.equal($('raw-k36-chart').children.length, 0);
  assert.equal($('raw-k36-table').children.length, 0);
  assert.equal($('raw-k36-copy-row').disabled, true);
});

test('G25 tab defaults to K36 and supports blend, None, and Both', async () => {
  const { $, click, start, window, analyses, lastWorker } = workspace();
  const payloads = [];
  window.G25ReportPdf = { buildReport(input) { payloads.push(input); return { sections: [] }; },
    createPdf() { return new Blob(['%PDF-1.4'], { type: 'application/pdf' }); } };
  const rawWorker = start();
  assert.equal($('raw-g25').hidden, false);
  assert.equal($('raw-k12b').hidden, true);
  rawWorker.onmessage({ data: { type: 'result', id: 'k36',
    components: Array.from({ length: 36 }, (_, i) => `Component_${i}`),
    fit: { proportions: Array(36).fill(1 / 36), converged: true, iterations: 5 },
    g25: Array(25).fill(0.01),
    stats: { matched: 50000, total: 160000, coverage: .3125, flipped: 0, incompatible: 0 } } });
  assert.match($('raw-g25-line').value, /^synthetic_simulated_scaled,0\.010000/);
  rawWorker.onmessage({ data: { type: 'g25-blend', g25: Array(25).fill(0.02),
    matched: 52900, total: 52961 } });
  assert.match($('raw-g25-blend-line').value, /^synthetic_kgocmen_scaled,0\.020000/);
  assert.equal($('raw-g25-source').value, 'regression');
  click('raw-analyse');
  assert.equal(analyses[0].source, 'raw-regression');
  assert.equal(analyses[0].values[0], 0.01);
  rawWorker.onmessage({ data: { type: 'done' } });
  click('raw-export');
  let reportWorker = lastWorker();
  assert.equal(reportWorker.sent.target.label, 'synthetic_simulated_scaled');
  reportWorker.onmessage({ data: { type: 'result', fits: {
    relaxedModern: [], relaxedAncient: [], strictModern: [],
  } } });
  await new Promise(setImmediate);
  assert.equal(payloads[0].g25Label, 'synthetic_simulated_scaled');
  assert.equal(payloads[0].g25[0], 0.01);
  $('raw-g25-source').value = 'blend';
  $('raw-g25-source').listeners.change({ currentTarget: $('raw-g25-source') });
  click('raw-analyse');
  assert.equal(analyses[1].source, 'raw-blend');
  assert.equal(analyses[1].values[0], 0.02);
  click('raw-export');
  reportWorker = lastWorker();
  assert.equal(reportWorker.sent.target.label, 'synthetic_kgocmen_scaled');
  reportWorker.onmessage({ data: { type: 'result', fits: {
    relaxedModern: [], relaxedAncient: [], strictModern: [],
  } } });
  await new Promise(setImmediate);
  assert.equal(payloads[1].g25Label, 'synthetic_kgocmen_scaled');
  assert.equal(payloads[1].g25[0], 0.02);
  $('raw-g25-source').value = 'none';
  $('raw-g25-source').listeners.change({ currentTarget: $('raw-g25-source') });
  assert.equal($('raw-analyse').disabled, true);
  assert.equal($('raw-g25-line').hidden, false);
  assert.equal($('raw-g25-blend-line').hidden, false);
  click('raw-analyse');
  assert.equal(analyses.length, 2);
  click('raw-export');
  await new Promise(setImmediate);
  assert.equal(payloads[2].includeG25, false);
  assert.equal(payloads[2].g25, undefined);
  $('raw-g25-source').value = 'both';
  $('raw-g25-source').listeners.change({ currentTarget: $('raw-g25-source') });
  assert.equal($('raw-g25-source-both').disabled, false);
  assert.equal($('raw-analyse').textContent, 'Compare both');
  click('raw-analyse');
  assert.equal(analyses[2].length, 2);
  assert.equal(analyses[2][0].values[0], 0.01);
  assert.equal(analyses[2][1].values[0], 0.02);
  click('raw-export');
  reportWorker = lastWorker();
  assert.equal(reportWorker.sent.target.label, 'synthetic_simulated_scaled');
  reportWorker.onmessage({ data: { type: 'result', fits: {
    relaxedModern: [{ distance: 1 }], relaxedAncient: [], strictModern: [],
  } } });
  await new Promise(setImmediate);
  reportWorker = lastWorker();
  assert.equal(reportWorker.sent.target.label, 'synthetic_kgocmen_scaled');
  reportWorker.onmessage({ data: { type: 'result', fits: {
    relaxedModern: [{ distance: 2 }], relaxedAncient: [], strictModern: [],
  } } });
  await new Promise(setImmediate);
  assert.equal(payloads[3].g25Profiles.length, 2);
  assert.equal(payloads[3].g25Profiles[0].analysisFits.relaxedModern[0].distance, 1);
  assert.equal(payloads[3].g25Profiles[1].analysisFits.relaxedModern[0].distance, 2);
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
  $('raw-file').files = [{ name: 'Previous sample.txt', size: 100 }];
  $('raw-file').listeners.change();
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
