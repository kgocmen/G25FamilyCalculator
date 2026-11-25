const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function workspace() {
  const elements = new Map();
  for (const id of ['analyse-export-actions', 'analyse-export', 'analyse-export-status']) {
    elements.set(id, { hidden: false, disabled: false, textContent: '', listeners: {},
      addEventListener(name, callback) { this.listeners[name] = callback; } });
  }
  const downloads = [], workers = [], reports = [];
  const document = { baseURI: 'https://example.test/calculator/',
    getElementById: (id) => elements.get(id),
    body: { append(link) { downloads.push(link); } },
    createElement() { return { click() { this.clicked = true; }, remove() {} }; },
  };
  class Worker {
    constructor(url) { this.url = url; workers.push(this); }
    postMessage(data) { this.input = data; }
    terminate() { this.terminated = true; }
  }
  class TestURL extends URL {}
  TestURL.createObjectURL = () => 'blob:analyse';
  TestURL.revokeObjectURL = () => {};
  const root = { G25ReportPdf: {
    buildAnalyseReport(data) { reports.push(data); return { sample: data.target.label, sections: [] }; },
    createPdf() { return new Blob(['%PDF-1.4'], { type: 'application/pdf' }); },
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../calculator/analyse_pdf.js'), 'utf8'),
    { window: root, document, Worker, URL: TestURL, Blob, setTimeout() {} });
  const state = { target: null, references: [['modern', 'M', ...Array(25).fill(0)]],
    referenceLabel: 'Global references' };
  const api = root.G25AnalysePdfUI.init(() => state);
  return { api, state, elements, downloads, workers, reports };
}

test('Analyse export uses a 2-way-only worker and downloads the Analyse PDF', async () => {
  const { api, state, elements, downloads, workers, reports } = workspace();
  const button = elements.get('analyse-export');
  assert.equal(button.disabled, true);
  state.target = { label: 'My sample', values: Array(25).fill(0) };
  api.update(true);
  assert.equal(button.disabled, false);
  const pending = button.listeners.click();
  assert.equal(workers.length, 1);
  assert.match(workers[0].url.pathname, /report_analysis_worker\.js$/);
  assert.equal(workers[0].input.target.label, 'My sample');
  assert.equal(workers[0].input.references.length, 1);
  workers[0].onmessage({ data: { type: 'result', fits: {
    relaxedModern: [], relaxedAncient: [], strictModern: [],
  } } });
  await pending;
  assert.equal(reports.length, 1);
  assert.equal(reports[0].target.label, 'My sample');
  assert.equal(downloads[0].download, 'My_sample_analyse.pdf');
  assert.equal(downloads[0].clicked, true);
  assert.equal(button.disabled, false);
});

test('switching away cancels a pending Analyse export', async () => {
  const { api, state, elements, workers, reports } = workspace();
  state.target = { label: 'Sample', values: Array(25).fill(0) };
  api.update(true);
  const pending = elements.get('analyse-export').listeners.click();
  api.update(false);
  await pending;
  assert.equal(workers[0].terminated, true);
  assert.equal(elements.get('analyse-export-actions').hidden, true);
  assert.equal(elements.get('analyse-export-status').textContent, '');
  assert.equal(reports.length, 0);
});
