const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const core = require("../calculator/core.js");
const modernPca = require("../calculator/modern_pca.js");
const row = (label, first) => ["modern", label, first, ...Array(24).fill(0)];

test("deep mode keeps the main selection and shows one level of clusters", () => {
  class Element {
    constructor() {
      this.children = [];
      this.listeners = {};
      this.style = {};
      this.dataset = {};
      this.classList = { toggle() {}, add() {}, remove() {} };
    }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    setAttribute(name, value) { this[name] = value; }
    querySelector(selector) {
      for (const child of this.children) {
        if (child.className === selector.slice(1)) return child;
        const nested = child.querySelector?.(selector);
        if (nested) return nested;
      }
      return null;
    }
    focus() {}
  }
  const elements = new Map();
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, new Element());
      return elements.get(selector);
    },
    querySelectorAll() { return []; },
    createElement() { return new Element(); },
    createTextNode(text) { return { textContent: text }; },
  };
  const main = [row("GroupA: First", 0), row("GroupA: Second", 0.1),
    row("GroupB: First", 1)];
  const deep = [row("GroupA: First", 0), row("GroupA: Second", 0.1),
    row("GroupB: First", 1)];
  const window = { G25Core: core, G25ModernPca: modernPca,
    G25MedievalModule() {}, G25ModernPcaModule() {},
    G25_REFERENCES: main,
    G25_MODERN_PCAS: [
      { id: "ordinary", title: "Ordinary", references: main },
      { id: "regional", title: "Regional", references: main, deepReferences: deep },
    ],
    G25_MODERN_MIXED_PCA: { id: "mixed", title: "Mixed PCA", references: [
      row("Southeast_Europe:Albanian", 0), row("Southeast_Europe:Balkans", 1),
      row("West_Asia_and_Caucasus:North Caucasus", 2),
    ] } };
  let lastWorker;
  class Worker {
    constructor() { lastWorker = this; }
    postMessage(data) { this.data = data; }
    terminate() {}
  }
  const URL = { createObjectURL() { return "blob:deep-ui-test"; }, revokeObjectURL() {} };
  const sessionStorage = { getItem() { return null; }, setItem() {} };
  let source = fs.readFileSync(path.join(__dirname, "../calculator/app.js"), "utf8");
  source = source.replace("  function renderMedievalPca(", "  function unusedRenderMedievalPca(");
  source = source.replace("  render();\n})();",
    "  function renderMedievalPca(rows) { window.lastPcaRows = rows; window.plotCount = (window.plotCount || 0) + 1; }\n  window.testApi = { state, render, renderMedievalBreakdown, renderMedievalFit, renderDeepFit, blacklist, allowedPcaReferences, allowedDeepPcaReferences };\n  render();\n})();");
  vm.runInNewContext(source, { window, document, Worker, URL, Blob, sessionStorage });
  const { state, render } = window.testApi;
  state.mode = 10;
  state.analysisView = "modern";
  state.single = { label: "Target", values: [0.6, ...Array(24).fill(0)] };
  render();
  assert.equal(document.querySelector("#period-tabs").hidden, false);
  assert.equal(document.querySelector("#medieval-breakdown-panel").hidden, false);
  assert.equal(document.querySelector("#matches-panel").hidden, true);
  const ordinary = document.querySelector("#modern-pca-options").children
    .find((option) => option.children[0].textContent === "Ordinary");
  ordinary.listeners.click();
  assert.equal(document.querySelector("#modern-deep-filter").hidden, true);
  const choice = document.querySelector("#modern-pca-options").children
    .find((option) => option.children[0].textContent === "Regional");
  choice.listeners.click();
  assert.equal(state.modernPcaId, "regional");
  assert.equal(state.deepAnalysis, false);
  const toggle = document.querySelector("#modern-deep-toggle");
  assert.equal(toggle.disabled, true);
  state.modernGroupLimit = 2;
  render();
  const mainFit = { values: state.single.values, distance: 1,
    groups: [{ ethnicity: "GroupA", weight: 0.6, samples: [
      { label: "GroupA: First", sample: "First", weight: 0.6 }] },
    { ethnicity: "GroupB", weight: 0.4, samples: [
      { label: "GroupB: First", sample: "First", weight: 0.4 }] }],
    components: [{ label: "GroupA: First", weight: 0.6 },
      { label: "GroupB: First", weight: 0.4 }] };
  const mainWorker = lastWorker;
  mainWorker.onmessage({ data: { requestId: mainWorker.data.requestId, kind: "selected",
    fit: mainFit, pca: { id: "regional", title: "Regional", references: main } } });
  mainWorker.onmessage({ data: { requestId: mainWorker.data.requestId, kind: "done" } });
  assert.equal(toggle.disabled, false);
  toggle.checked = true;
  toggle.listeners.change({ currentTarget: toggle });
  assert.equal(state.deepPcaId, "regional");
  assert.equal(lastWorker.data.selectedPcaId, "regional");
  assert.equal(lastWorker.data.groupLimit, 2);
  assert.equal(lastWorker.data.deepAnalysis, true);
  assert.equal(lastWorker.data.deepOnly, true);
  assert.equal(lastWorker.data.mainFit, mainFit);
  assert.equal(lastWorker.data.mainPcaId, "regional");
  assert.equal(lastWorker.data.modernPcas, null);
  assert.deepEqual(lastWorker.data.deepPcas.map((pca) => pca.id), ["regional"]);
  assert.equal(document.querySelector("#modern-pca-current-fit").textContent,
    "Main fit · max 2 groups");

  const { renderMedievalFit, renderDeepFit } = window.testApi;
  const mainGroups = [
    { ethnicity: "Turk Azerbaijan", weight: 0.728 },
    { ethnicity: "Turk Balkans", weight: 0.272 },
  ];
  document.querySelector("#medieval-breakdown-list").replaceChildren();
  renderMedievalFit({ values: state.single.values, distance: 1,
    groups: mainGroups.map((group) => ({ ...group, samples: [
      { label: group.ethnicity, sample: group.ethnicity, weight: group.weight },
    ] })) }, true);
  const adjustedGroups = [
    { ethnicity: "Turk Azerbaijan", weight: 0.6, samples: [
      { label: "Turk Azerbaijan: Gabala", sample: "Gabala", weight: 0.229 },
      { label: "Turk Azerbaijan: Shaki", sample: "Shaki", weight: 0.172 },
      { label: "Turk Azerbaijan: Karabakh", sample: "Karabakh", weight: 0.123 },
      { label: "Turk Azerbaijan: Nakhchivan", sample: "Nakhchivan", weight: 0.076 },
    ] },
    { ethnicity: "Turk Balkans", weight: 0.4, samples: [
      { label: "Turk Balkans: Thessaly", sample: "Thessaly", weight: 0.266 },
      { label: "Turk Balkans: Eastern Macedonia", sample: "Eastern Macedonia", weight: 0.091 },
      { label: "Turk Balkans: Mixed", sample: "Mixed", weight: 0.043 },
    ] },
  ];
  renderDeepFit({ pcaId: "missing", groups: adjustedGroups.map((group) => group.ethnicity),
    fit: { values: state.single.values, distance: 0.5, groups: adjustedGroups },
    referenceCount: 42 });
  const parents = document.querySelector("#medieval-breakdown-list").children;
  const azerbaijan = parents[0];
  assert.equal(azerbaijan.children[0].children[1].textContent, "60.0%");
  assert.deepEqual(azerbaijan.children[2].children.map((sample) =>
    sample.children[1].textContent), ["22.9%", "17.2%", "12.3%", "7.6%"]);
  const balkans = parents[1];
  assert.equal(balkans.children[0].children[1].textContent, "40.0%");
  assert.deepEqual(balkans.children[2].children.map((sample) => sample.children[1].textContent),
    ["26.6%", "9.1%", "4.3%"]);
  assert.ok(parents.every((parent) => parent.children.length === 3));
  assert.equal(document.querySelector("#medieval-breakdown-distance").textContent,
    "Deep fit distance 0.500");

  renderDeepFit({ pcaId: "regional", mainFit, referenceCount: 3,
    fit: { values: state.single.values, distance: 0,
      groups: [{ ethnicity: "GroupA", weight: 1, samples: [
        { label: "GroupA: First", sample: "First", weight: 1 },
      ] }] } });
  assert.deepEqual(window.lastPcaRows.map((reference) => reference[1]), [
    "GroupA: First", "GroupA: Second", "GroupB: First",
  ]);

  const southeastMain = [row("Albanian:Albanian_Gheg", 0),
    row("Balkans:Bulgarian", 1), row("Albanian:Albanian_Tosk", 0.1),
    row("Greek:Greek_Attica", 2)];
  const caucasusMain = [row("North Caucasus:Abkhazian", 3),
    row("Levant:Lebanese", 4), row("North Caucasus:Chechen", 5)];
  const southeastPca = { id: "southeast", title: "Southeast Europe", references: southeastMain,
    deepReferences: [row("Albanian: Albanian_A", 0),
      row("Balkans: Bulgarian_A", 1)] };
  window.G25_MODERN_PCAS.push(
    southeastPca,
    { id: "caucasus", title: "West Asia and Caucasus", references: caucasusMain,
      deepReferences: [row("North Caucasus: Abkhazian_A", 3)] });

  const mixed = document.querySelector("#modern-pca-options").children
    .find((option) => option.children[0].textContent === "Mixed");
  assert.ok(mixed);
  const plotsBeforeMixed = window.plotCount;
  mixed.listeners.click();
  assert.equal(state.deepPcaId, "mixed");
  assert.equal(lastWorker.data.selectedPcaId, "mixed");
  assert.equal(lastWorker.data.deepAnalysis, true);
  assert.equal(document.querySelector("#pca-heading-title").textContent, "Mixed");
  assert.equal(window.plotCount, plotsBeforeMixed);
  assert.equal(document.querySelector("#medieval-pca-plot").textContent, "Calculating fitted groups…");

  const mixedGroups = [
    { ethnicity: "Southeast_Europe", weight: 0.7, samples: [
      { label: "Southeast_Europe:Bulgarian_A", sample: "Bulgarian_A", weight: 0.5 },
      { label: "Southeast_Europe:Albanian_A", sample: "Albanian_A", weight: 0.2 },
    ] },
    { ethnicity: "West_Asia_and_Caucasus", weight: 0.3, samples: [
      { label: "West_Asia_and_Caucasus:Abkhazian_A", sample: "Abkhazian_A", weight: 0.3 },
    ] },
  ];
  renderDeepFit({ pcaId: "mixed", groups: mixedGroups.map((group) => group.ethnicity),
    fit: { values: state.single.values, distance: 0.3, groups: mixedGroups },
    mainFit: { components: [
      { label: "Southeast_Europe:Balkans", weight: 0.5 },
      { label: "Southeast_Europe:Albanian", weight: 0.2 },
      { label: "West_Asia_and_Caucasus:North Caucasus", weight: 0.3 },
    ] },
    referenceCount: 3 });
  const mixedParents = document.querySelector("#medieval-breakdown-list").children;
  const europe = mixedParents[0];
  assert.equal(europe.children[0].children[1].textContent, "70.0%");
  assert.deepEqual(europe.children[2].children.map((sample) => sample.children[0].textContent),
    ["Bulgarian A", "Albanian A"]);
  assert.deepEqual(europe.children[2].children.map((sample) => sample.children[1].textContent),
    ["50.0%", "20.0%"]);
  const caucasus = mixedParents[1];
  assert.equal(caucasus.children[0].children[1].textContent, "30.0%");
  assert.ok(mixedParents.every((parent) => parent.children.length === 3));
  assert.deepEqual(window.lastPcaRows.map((reference) => reference[1]), [
    "Southeast_Europe:Albanian_A",
    "Southeast_Europe:Bulgarian_A",
    "West_Asia_and_Caucasus:Abkhazian_A",
  ]);
  assert.equal(document.querySelector("#pca-heading-title").textContent, "Mixed · Deep");

});
