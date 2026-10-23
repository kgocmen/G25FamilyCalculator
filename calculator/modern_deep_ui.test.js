const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const core = require("./core.js");
const modernPca = require("./modern_pca.js");
const row = (label, first) => ["modern", label, first, ...Array(24).fill(0)];

test("deep mode keeps the main selection and shows whole-result subregion percentages", () => {
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
  const deep = [row("GroupA: Inner: First", 0), row("GroupA: Coast: Second", 0.1),
    row("GroupB: Inner: First", 1)];
  const window = { G25Core: core, G25ModernPca: modernPca,
    G25MedievalModule() {}, G25ModernPcaModule() {},
    G25_REFERENCES: main,
    G25_MODERN_PCAS: [
      { id: "ordinary", title: "Ordinary", references: main },
      { id: "regional", title: "Regional", references: main, deepReferences: deep },
    ] };
  let lastWorker;
  class Worker {
    constructor() { lastWorker = this; }
    postMessage(data) { this.data = data; }
    terminate() {}
  }
  const URL = { createObjectURL() { return "blob:deep-ui-test"; }, revokeObjectURL() {} };
  const sessionStorage = { getItem() { return null; }, setItem() {} };
  let source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  source = source.replace("  function renderMedievalPca(", "  function unusedRenderMedievalPca(");
  source = source.replace("  render();\n})();",
    "  function renderMedievalPca() {}\n  window.testApi = { state, renderMedievalBreakdown, renderMedievalFit, renderDeepFit };\n  render();\n})();");
  vm.runInNewContext(source, { window, document, Worker, URL, Blob, sessionStorage });
  const { state, renderMedievalBreakdown } = window.testApi;
  state.mode = 1;
  state.analysisView = "modern";
  state.single = { label: "Target", values: [0.6, ...Array(24).fill(0)] };
  renderMedievalBreakdown();
  const ordinary = document.querySelector("#modern-pca-options").children
    .find((option) => option.children[0].textContent === "Ordinary");
  ordinary.listeners.click();
  assert.equal(document.querySelector("#modern-deep-filter").hidden, true);
  const choice = document.querySelector("#modern-pca-options").children
    .find((option) => option.children[0].textContent === "Regional");
  choice.listeners.click();
  assert.equal(state.modernPcaId, "regional");
  state.modernGroupLimit = 2;
  const toggle = document.querySelector("#modern-deep-toggle");
  toggle.checked = true;
  toggle.listeners.change({ currentTarget: toggle });
  assert.equal(state.deepPcaId, "regional");
  assert.equal(lastWorker.data.selectedPcaId, "regional");
  assert.equal(lastWorker.data.groupLimit, 2);
  assert.equal(lastWorker.data.deepAnalysis, true);
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
      { label: "Turk Azerbaijan", sample: "Azerbaijan", weight: 0.6 },
    ] },
    { ethnicity: "Turk Balkans", weight: 0.4, samples: [
      { label: "Turk Balkans", sample: "Balkans", weight: 0.4 },
    ] },
  ];
  renderDeepFit({ pcaId: "missing", groups: adjustedGroups.map((group) => group.ethnicity),
    fit: { values: state.single.values, distance: 0.5, groups: adjustedGroups },
    referenceCount: 42, results: [
      { ethnicity: "Turk Azerbaijan", weight: 0.6, fit: { groups: [
        { ethnicity: "Turk Azerbaijan: Azerbaijan", weight: 0.6, samples: [
          { sample: "Gabala", weight: 0.382 }, { sample: "Shaki", weight: 0.286 },
          { sample: "Karabakh", weight: 0.205 }, { sample: "Nakhchivan", weight: 0.127 },
        ] },
      ] } },
      { ethnicity: "Turk Balkans", weight: 0.4, fit: { groups: [
        { ethnicity: "Turk Balkans: Balkans", weight: 0.4, samples: [
          { sample: "Thessaly", weight: 0.664 }, { sample: "Eastern Macedonia", weight: 0.228 },
          { sample: "Mixed", weight: 0.108 },
        ] },
      ] } },
    ] });
  const parents = document.querySelector("#medieval-breakdown-list").children;
  const azerbaijan = parents.find((parent) => parent.dataset.deepGroup === "Turk Azerbaijan");
  const azerbaijanSubregion = azerbaijan.querySelector(".deep-breakdown").children[1];
  assert.equal(azerbaijan.children[0].children[1].textContent, "60.0%");
  assert.equal(azerbaijanSubregion.children[0].children[1].textContent, "60.0%");
  assert.deepEqual(azerbaijanSubregion.children[1].children.map((sample) =>
    sample.children[1].textContent), ["22.9%", "17.2%", "12.3%", "7.6%"]);
  const balkans = parents.find((parent) => parent.dataset.deepGroup === "Turk Balkans");
  const subregion = balkans.querySelector(".deep-breakdown").children[1];
  assert.equal(balkans.children[0].children[1].textContent, "40.0%");
  assert.equal(subregion.children[0].children[1].textContent, "40.0%");
  assert.deepEqual(subregion.children[1].children.map((sample) => sample.children[1].textContent),
    ["26.6%", "9.1%", "4.3%"]);
  assert.equal(document.querySelector("#medieval-breakdown-distance").textContent,
    "Deep fit distance 0.500");
});
