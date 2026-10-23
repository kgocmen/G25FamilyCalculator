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
    ],
    G25_MODERN_MIXED_PCA: { id: "mixed", title: "Mixed PCA", references: [
      row("Southeast_Europe:Albanian", 0), row("Southeast_Europe:Slavic Balkans", 1),
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
  let source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
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

  const southeastMain = [row("Albanian:Albanian_Gheg", 0),
    row("Slavic Balkans:Bulgarian", 1), row("Albanian:Albanian_Tosk", 0.1),
    row("Greek:Greek_Attica", 2)];
  const caucasusMain = [row("North Caucasus:Abkhazian", 3),
    row("Levant:Lebanese", 4), row("North Caucasus:Chechen", 5)];
  const southeastPca = { id: "southeast", title: "Southeast Europe", references: southeastMain,
    deepReferences: [row("Albanian: North: Albanian_A", 0),
      row("Slavic Balkans: South: Bulgarian_A", 1)] };
  window.G25_MODERN_PCAS.push(
    southeastPca,
    { id: "caucasus", title: "West Asia and Caucasus", references: caucasusMain });

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

  const mixedResults = [
    { ethnicity: "Southeast_Europe", weight: 0.7, sourceGroups: [
      { ethnicity: "Slavic Balkans", weight: 0.5, subregions: [
        { ethnicity: "Southeast_Europe:Slavic Balkans: South", weight: 0.5, samples: [
          { label: "Southeast_Europe:Slavic Balkans: South: Bulgarian_A", sample: "Bulgarian_A", weight: 0.5 },
        ] },
      ] },
      { ethnicity: "Albanian", weight: 0.2, subregions: [
        { ethnicity: "Southeast_Europe:Albanian: North", weight: 0.2, samples: [
          { label: "Southeast_Europe:Albanian: North: Albanian_A", sample: "Albanian_A", weight: 0.2 },
        ] },
      ] },
    ] },
    { ethnicity: "West_Asia_and_Caucasus", weight: 0.3, sourceGroups: [
      { ethnicity: "North Caucasus", weight: 0.3, subregions: [
        { ethnicity: "West_Asia_and_Caucasus:North Caucasus: Highlands", weight: 0.3, samples: [
          { label: "West_Asia_and_Caucasus:North Caucasus: Highlands: Abkhazian_A",
            sample: "Abkhazian_A", weight: 0.3 },
        ] },
      ] },
    ] },
  ];
  const mixedRows = [row("Southeast_Europe:Slavic Balkans: South: Bulgarian_A", 0),
    row("Southeast_Europe:Albanian: North: Albanian_A", 1),
    row("West_Asia_and_Caucasus:North Caucasus: Highlands: Abkhazian_A", 2)];
  renderDeepFit({ pcaId: "mixed", groups: mixedResults.map((result) => result.ethnicity),
    fit: { values: state.single.values, distance: 0.3,
      groups: mixedResults.map((result) => ({ ethnicity: result.ethnicity, weight: result.weight,
        samples: [{ label: result.ethnicity, sample: result.ethnicity, weight: result.weight }] })) },
    referenceCount: 3, results: mixedResults, references: mixedRows });
  const mixedParents = document.querySelector("#medieval-breakdown-list").children;
  const europe = mixedParents.find((parent) => parent.dataset.deepGroup === "Southeast_Europe");
  const europeSources = europe.querySelector(".deep-breakdown").children;
  assert.equal(europe.children[0].children[1].textContent, "70.0%");
  assert.deepEqual(europeSources.map((source) => source.children[0].children[0].textContent),
    ["Slavic Balkans", "Albanian"]);
  assert.deepEqual(europeSources.map((source) => source.children[0].children[1].textContent),
    ["50.0%", "20.0%"]);
  const caucasus = mixedParents.find((parent) => parent.dataset.deepGroup === "West_Asia_and_Caucasus");
  assert.equal(caucasus.querySelector(".deep-breakdown").children[0].children[0].children[1].textContent,
    "30.0%");
  assert.deepEqual(window.lastPcaRows.map((reference) => reference[1]), [
    "Southeast_Europe:Albanian:Albanian_Gheg",
    "Southeast_Europe:Slavic Balkans:Bulgarian",
    "Southeast_Europe:Albanian:Albanian_Tosk",
    "West_Asia_and_Caucasus:North Caucasus:Abkhazian",
    "West_Asia_and_Caucasus:North Caucasus:Chechen",
  ]);
  assert.ok(window.lastPcaRows.every((reference) => !mixedRows.some((deepRow) =>
    deepRow[1] === reference[1])));
  assert.equal(document.querySelector("#pca-heading-title").textContent, "Mixed · Deep");

  const minus = europeSources[0].children[0].children[2];
  assert.equal(minus["aria-label"], "Blacklist entire Slavic Balkans group");
  let prevented = false;
  let stopped = false;
  minus.listeners.click({ preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; } });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.ok(window.testApi.blacklist.has(JSON.stringify(["modern", "Slavic Balkans", "group"])));
  assert.ok(window.testApi.allowedPcaReferences(window.G25_MODERN_MIXED_PCA)
    .every((reference) => reference[1] !== "Southeast_Europe:Slavic Balkans"));
  assert.ok(window.testApi.allowedPcaReferences(southeastPca)
    .every((reference) => !reference[1].startsWith("Slavic Balkans:")));
  assert.ok(window.testApi.allowedDeepPcaReferences(southeastPca)
    .every((reference) => !reference[1].startsWith("Slavic Balkans:")));
});
