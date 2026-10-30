const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const core = require("../calculator/core.js");
const modern = require("../calculator/modern_pca.js");

const app = fs.readFileSync(path.join(__dirname, "../calculator/app.js"), "utf8");
const start = app.indexOf("  function medievalWorkerMain() {");
const end = app.indexOf("  function mixtureWorkerMain() {", start);
assert.ok(start >= 0 && end > start);
const workerSource = `(${app.slice(start, end).trim()})()`;
const moduleSource = ["medieval.js", "modern_pca.js"].map((file) =>
  fs.readFileSync(path.join(__dirname, "../calculator", file), "utf8")).join("\n");
const row = (label, x, y = 0) => ["modern", label, x, y, ...Array(23).fill(0)];
const pcas = [-1, 1, 2].map((coordinate, index) => {
  const references = [1, 2, 3].map((multiple) => row(`Group${index}:Sample${multiple}`, coordinate * multiple));
  return { id: ["first", "second", "third"][index],
    title: ["First", "Second", "Third"][index], references };
});
const mixedReferences = [row("First:Sample", 0), row("Second:Sample", 1),
  row("Third:Sample", 2)];
const input = { values: Array(25).fill(0) };

function calculate(overrides = {}) {
  const messages = [];
  const self = { postMessage(message) { messages.push(message); } };
  vm.runInNewContext(`${moduleSource}\n${workerSource}`, { self, globalThis: self });
  self.onmessage({ data: { requestId: 1, target: input, references: pcas[0].references,
    groupLimit: 2, groupStyle: "modern", selectedPcaId: "auto", closestPcaId: "first",
    modernPcas: pcas, ...overrides } });
  assert.ok(messages.some((message) => message.kind === "done"));
  assert.ok(messages.every((message) => message.kind === "deep" || !message.error));
  const selected = messages.find((message) => message.kind === "selected");
  assert.equal(messages.filter((message) => message.kind === "selected").length, 1);
  return { ...selected, messages,
    pcaFitDistances: messages.filter((message) => message.kind === "profile") };
}

test("deep analysis uses only the selected main PCA groups", () => {
  const deepPcas = [{ id: "first", references: [
    row("Group0: Allowed A", -1),
    row("Group0: Allowed B", -2),
    row("Group1: Blocked", 0),
  ] }];
  for (const modernPcas of [pcas, null]) {
    const result = calculate({ selectedPcaId: "first", displayedPcaId: "first",
      groupLimit: 1, modernPcas, deepAnalysis: true, deepPcas });
    const deep = result.messages.find((message) => message.kind === "deep");
    assert.ok(deep);
    assert.deepEqual([...deep.groups], ["Group0"]);
    assert.equal(deep.referenceCount, 2);
    assert.deepEqual([...deep.fit.groups.map((group) => group.ethnicity)], ["Group0"]);
    assert.ok(deep.fit.groups[0].samples.every((sample) => sample.label.startsWith("Group0:")));
    assert.ok(result.messages.indexOf(deep) > result.messages.findIndex((message) => message.kind === "selected"));
  }
});

test("enabling deep analysis reuses the completed main fit without rescanning PCA maps", () => {
  const main = calculate({ selectedPcaId: "first", groupLimit: 1, modernPcas: pcas });
  const result = calculate({ deepOnly: true, mainFit: main.fit, mainPcaId: "first",
    mainReferences: pcas[0].references,
    deepAnalysis: true, deepPcas: [{ id: "first", references: [
      row("Group0: Allowed A", -1), row("Group0: Allowed B", -2),
      row("Group1: Excluded", 0),
    ] }], modernPcas: pcas, references: [] });
  assert.equal(result.fit, main.fit);
  assert.equal(result.pcaFitDistances.length, 0);
  assert.ok(!result.messages.some((message) => message.kind === "progress"));
  const deep = result.messages.find((message) => message.kind === "deep");
  assert.equal(deep.error, undefined);
  assert.deepEqual([...deep.groups], ["Group0"]);
  assert.equal(deep.referenceCount, 2);
});

test("deep fit distance retains the input error left by the main PCA", () => {
  const references = [row("GroupA: Sample A", 1), row("GroupA: Sample B", 1),
    row("GroupA: Sample C", 1)];
  const result = calculate({ target: { values: [1.1, ...Array(24).fill(0)] },
    references, selectedPcaId: "single", displayedPcaId: "single",
    groupLimit: 1, modernPcas: [{ id: "single", references }],
    deepAnalysis: true,
    deepPcas: [{ id: "single", references: [row("GroupA: Sample", 1)] }] });
  const deep = result.messages.find((message) => message.kind === "deep");
  assert.ok(Math.abs(deep.fit.distance - 10) < 1e-9);
});

test("deep analysis does not borrow references from unfitted main groups", () => {
  const result = calculate({ selectedPcaId: "first", displayedPcaId: "first",
    groupLimit: 1, deepAnalysis: true, deepPcas: [{ id: "first", references: [
      row("Group1: Excluded", 0),
    ] }] });
  const deep = result.messages.find((message) => message.kind === "deep");
  assert.match(deep.error, /No included deep references/);
  assert.ok(result.fit);
});

test("deep mode uses the main PCA selector and retains its fitted groups", () => {
  const result = calculate({ selectedPcaId: "second", displayedPcaId: "second",
    groupLimit: "auto", deepAnalysis: true, deepPcas: [{
      id: "second",
      references: [row("Group1: Sample A", 1),
        row("Group1: Sample B", 2)],
    }] });
  const deep = result.messages.find((message) => message.kind === "deep");
  assert.equal(result.pca.id, "second");
  assert.equal(deep.pcaId, "second");
  assert.deepEqual([...deep.groups], ["Group1"]);
  assert.equal(deep.fit.groups.length, 1);
});

test("deep analysis uses manually selected main groups instead of the automatic fit", () => {
  const references = [row("GroupA: First", 0), row("GroupA: Second", 0),
    row("GroupB: First", 1)];
  const deepPcas = [{ id: "manual", references: [
    row("GroupA: First", 0), row("GroupB: First", 1),
  ] }];
  const settings = { target: { values: [0.6, 0.8, ...Array(23).fill(0)] },
    references, selectedPcaId: "manual", displayedPcaId: "manual",
    modernPcas: [{ id: "manual", references }], deepAnalysis: true,
    deepPcas };
  const automatic = calculate({ ...settings, groupLimit: "auto" });
  assert.deepEqual([...automatic.messages.find((message) => message.kind === "deep").groups],
    ["GroupB"]);
  const manual = calculate({ ...settings, groupLimit: 2 });
  assert.deepEqual(new Set(manual.messages.find((message) => message.kind === "deep").groups),
    new Set(["GroupA", "GroupB"]));
});

test("deep analysis fits only children of the selected main groups", () => {
  const map = { id: "regional", title: "Regional", references: [
    row("GroupA: A", -1), row("GroupA: B", 0), row("GroupA: C", -2),
    row("GroupB: A", 2), row("GroupB: B", 3), row("GroupB: C", 4),
  ] };
  const result = calculate({ target: { values: [1, ...Array(24).fill(0)] },
    selectedPcaId: "regional", displayedPcaId: "regional", groupLimit: 2,
    modernPcas: [map], deepAnalysis: true,
    deepPcas: [{ id: "regional", references: [
      row("GroupA: A", 0), row("GroupA: B", -1),
      row("GroupB: A", 2), row("GroupB: B", 3),
    ] }] });
  const deep = result.messages.find((message) => message.kind === "deep");
  assert.deepEqual(new Set(deep.groups), new Set(["GroupA", "GroupB"]));
  assert.equal(deep.fit.groups.length, 2);
  assert.equal(deep.results, undefined);
  for (const group of deep.fit.groups) {
    assert.ok(group.samples.every((sample) => sample.label.startsWith(`${group.ethnicity}:`)));
  }
});

test("deep analysis can replace a mixed main fit with one exact child sample", () => {
  const references = [row("GroupA: Main", 0), row("GroupA: Alternate", 0),
    row("GroupB: Main", 1)];
  const result = calculate({ target: { values: [0.5, ...Array(24).fill(0)] },
    references, selectedPcaId: "reweight", displayedPcaId: "reweight",
    groupLimit: 2, modernPcas: [{ id: "reweight", references }],
    deepAnalysis: true, deepPcas: [{ id: "reweight", references: [
      row("GroupA: Sample", 0), row("GroupB: Exact", 0.5),
    ] }] });
  const deep = result.messages.find((message) => message.kind === "deep");
  const mainWeights = Object.fromEntries(result.fit.groups.map((group) =>
    [group.ethnicity, group.weight]));
  assert.ok(Math.abs(mainWeights.GroupB - 0.5) < 1e-6);
  assert.equal(deep.fit.groups.length, 1);
  assert.equal(deep.fit.groups[0].ethnicity, "GroupB");
  assert.equal(deep.fit.groups[0].weight, 1);
  assert.equal(deep.fit.components[0].label, "GroupB: Exact");
  assert.ok(deep.fit.distance < 1e-9);
});

test("Ukrainian Pontic resolves to its exact deep reference", () => {
  const source = fs.readFileSync(path.join(__dirname,
    "../data/pca/modern_pca14.g25.txt"), "utf8");
  const sections = { Main: [], Deep: [] };
  let section = null;
  for (const line of source.split(/\r?\n/)) {
    if (line === "Main:" || line === "Deep:") {
      section = line.slice(0, -1);
      continue;
    }
    if (!line.trim() || !section) continue;
    const [label, ...coordinates] = line.split(",");
    sections[section].push(["modern", label, ...coordinates.map(Number)]);
  }
  const pontic = sections.Deep.find((reference) =>
    reference[1] === "Slavic: Ukrainian_Pontic_(n=3)");
  assert.ok(pontic);
  const pca = { id: "northeast", references: sections.Main };
  const result = calculate({ target: { values: pontic.slice(2) },
    references: pca.references, selectedPcaId: pca.id, displayedPcaId: pca.id,
    groupLimit: 2, modernPcas: [pca], deepAnalysis: true,
    deepPcas: [{ id: pca.id, references: sections.Deep }] });
  assert.ok(result.fit.groups.some((group) => group.ethnicity === "Slavic"));
  const deep = result.messages.find((message) => message.kind === "deep");
  assert.equal(deep.error, undefined);
  assert.equal(deep.fit.components.length, 1);
  assert.equal(deep.fit.components[0].label, pontic[1]);
  assert.equal(deep.fit.components[0].weight, 1);
  assert.ok(deep.fit.distance < 1e-9);
});

test("mixed deep analysis refits only the selected source groups", () => {
  const references = [row("Southeast_Europe:Albanian", 0, 0),
    row("Southeast_Europe:Balkans", 1, 0),
    row("West_Asia_and_Caucasus:North Caucasus", 0, 1)];
  const result = calculate({ target: { values: [0.3, 0.3, ...Array(23).fill(0)] },
    references, selectedPcaId: "mixed", displayedPcaId: "mixed", groupStyle: "mixed",
    groupLimit: 2, modernPcas: null, deepAnalysis: true,
    deepPcas: [
      { id: "southeast", title: "Southeast Europe", references: [
        row("Albanian: Albanian_A", -0.2, 0),
        row("Balkans: Bulgarian_A", 1, 0),
        row("Greek: Greek_A", 0.3, 0.3),
      ] },
      { id: "caucasus", title: "West Asia and Caucasus", references: [
        row("North Caucasus: Abkhazian_A", 0, 1.2),
        row("Levant: Levantine_A", 0.3, 0.3),
      ] },
    ] });
  const deep = result.messages.find((message) => message.kind === "deep");
  assert.equal(deep.error, undefined);
  assert.equal(deep.pcaId, "mixed");
  assert.equal(deep.referenceCount, 3);
  assert.deepEqual([...deep.groups], ["Southeast_Europe", "West_Asia_and_Caucasus"]);
  assert.deepEqual(new Set(deep.fit.components.map((part) => part.label)), new Set([
    "Southeast_Europe:Albanian_A",
    "Southeast_Europe:Bulgarian_A",
    "West_Asia_and_Caucasus:Abkhazian_A",
  ]));
  assert.ok(Math.abs(deep.fit.groups.reduce((sum, group) => sum + group.weight, 0) - 1) < 1e-9);
  assert.ok(Math.abs(result.fit.groups.find((group) => group.ethnicity === "Southeast_Europe").weight - 0.7) < 1e-6);
  assert.ok(Math.abs(deep.fit.groups.find((group) => group.ethnicity === "Southeast_Europe").weight - 0.75) < 1e-6);
  assert.ok(deep.fit.distance < 1e-6);
});

test("Mixed deep analysis can fit a Deep Mixed profile", () => {
  const references = [row("Northwest_Europe:British Isles", 0),
    row("Indigenous_America:Andes", 1), row("Southwest_Europe:Iberia", 2)];
  const result = calculate({ references, selectedPcaId: "mixed",
    displayedPcaId: "mixed", groupStyle: "mixed", groupLimit: 1,
    modernPcas: null, deepAnalysis: true,
    deepPcas: [{ id: "northwest", title: "Northwest Europe",
      references: [row("British Isles: English", 0.2)],
      deepMixedReferences: [row("British Isles: Anglo-American_Kentucky_(n=125)", 0)],
    }] });
  const deep = result.messages.find((message) => message.kind === "deep");
  assert.equal(deep.error, undefined);
  assert.equal(deep.fit.components.length, 1);
  assert.equal(deep.fit.components[0].label,
    "Northwest_Europe:Anglo-American_Kentucky_(n=125)");
  assert.equal(deep.fit.components[0].weight, 1);
  assert.ok(deep.fit.distance < 1e-9);
});

test("automatic group search stops when one group fits below one", () => {
  const references = [row("GroupA: First", 0.0098),
    row("GroupA: Second", 0.0098), row("GroupA: Third", 0.0098),
    row("GroupB: First", -0.0098)];
  const result = calculate({ references, selectedPcaId: "threshold",
    displayedPcaId: "threshold", groupLimit: "auto",
    modernPcas: [{ id: "threshold", references }] });
  assert.equal(result.fit.groups.length, 1);
  assert.equal(result.fit.groups[0].ethnicity, "GroupA");
  assert.ok(Math.abs(result.fit.distance - 0.98) < 1e-9);
  assert.equal(result.pcaFitDistances[0].groupLimit, 1);
  assert.ok(!result.messages.some((message) =>
    message.kind === "progress" && message.groupLimit > 1));
});

test("automatic PCA stays regular even when the combined references fit better", () => {
  const result = calculate();
  assert.equal(result.pca.id, "first");
  assert.ok(result.fit.distance > 0);
  assert.equal(result.pcaFitDistances.length, 3);
});

test("auto selects the lowest regular fit above two and when it clears the ratio below two", () => {
  const near = { id: "near", title: "Near", references: [
    row("Near:A", 0.1), row("Near:B", 0.2), row("Near:C", 0.3),
  ] };
  const better = { id: "better", title: "Better", references: [
    row("West:A", -1), row("East:B", 1), row("East:C", 2),
  ] };
  const result = calculate({ groupLimit: "auto", closestPopulationDistance: 2.001,
    closestPcaId: "near", modernPcas: [near, better] });
  assert.equal(result.pca.id, "better");
  assert.ok(result.pcaFitDistances.find((entry) => entry.id === "better").distance <
    result.pcaFitDistances.find((entry) => entry.id === "near").distance);
  const lowDistance = calculate({ groupLimit: "auto", closestPopulationDistance: 2,
    closestPcaId: "near", modernPcas: [near, better] });
  assert.equal(lowDistance.pca.id, "better");
});

test("mixed becomes automatic above a closest-population distance of two when its fit wins", () => {
  const result = calculate({ groupLimit: "auto", closestPopulationDistance: 2.001,
    modernPcas: [...pcas,
    { id: "mixed", title: "Mixed PCA", references: mixedReferences }] });
  assert.equal(result.pca.id, "mixed");
  assert.ok(result.pcaFitDistances.find((entry) => entry.id === "first").distance > 2);
  assert.ok(result.fit.distance < result.pcaFitDistances.find((entry) => entry.id === "first").distance);
});

test("below two, the previous mixed override still applies when regular fits exceed two", () => {
  const result = calculate({ groupLimit: "auto", closestPopulationDistance: 1.999,
    modernPcas: [...pcas,
      { id: "mixed", title: "Mixed PCA", references: mixedReferences }] });
  assert.equal(result.pca.id, "mixed");
});

test("automatic Mixed selection continues into deep analysis", () => {
  const mixed = { id: "mixed", title: "Mixed", references: [
    row("First:Group0", 0), row("Second:Group1", 1), row("Third:Group2", 2),
  ] };
  const result = calculate({ groupLimit: "auto", closestPopulationDistance: 2.001,
    modernPcas: [...pcas, mixed],
    deepAnalysis: true, deepPcas: [
      { id: "first", title: "First", references: [row("Group0: A", 0)] },
    ] });
  assert.equal(result.pca.id, "mixed");
  const deep = result.messages.find((message) => message.kind === "deep");
  assert.equal(deep.error, undefined);
  assert.equal(deep.pcaId, "mixed");
  assert.deepEqual([...deep.groups], ["First"]);
});

test("below two, a substantially better regular fit overrides the closest PCA", () => {
  const closest = { id: "closest", title: "Closest", references: [
    row("Closest:A", 0.03), row("Closest:B", 0.04), row("Closest:C", 0.05),
  ] };
  const better = { id: "better", title: "Better fit", references: [
    row("Better:A", -0.04), row("Better:B", 0.04), row("Better:C", 0.06),
  ] };
  const mixed = { id: "mixed", title: "Mixed", references: [
    row("Mixed:A", 0), row("Mixed:B", 0.1), row("Mixed:C", 0.2),
  ] };
  const result = calculate({ closestPcaId: "closest", closestPopulationDistance: 1.999,
    modernPcas: [closest, mixed, better],
    groupLimit: "auto" });
  assert.equal(result.pca.id, "better");
  assert.ok(result.pcaFitDistances.find((entry) => entry.id === "better").distance < 2);
});

test("Udi selects Caucasus over the closer West Turkistan PCA without selecting Mixed", () => {
  const source = fs.readFileSync(path.join(__dirname, "../data/modern_g25.txt"), "utf8")
    .split(/\r?\n/).find((line) => line.startsWith("Udi_(n=3),"));
  const target = core.parseLine(source);
  const bundle = fs.readFileSync(path.join(__dirname,
    "../calculator/modern_pca_references.js"), "utf8");
  const allPcas = JSON.parse(bundle.slice(bundle.indexOf("=") + 1).trim().replace(/;$/, ""));
  const mixedBundle = fs.readFileSync(path.join(__dirname,
    "../calculator/mixed_pca_references.js"), "utf8");
  const mixed = JSON.parse(mixedBundle.slice(mixedBundle.indexOf("=") + 1).trim().replace(/;$/, ""));
  const regular = ["global-anatolian-turks-and-azerbaijanis", "global-caucasus"]
    .map((id) => allPcas.find((pca) => pca.id === id))
    .map((pca) => ({ ...pca,
      references: modern.selectFitReferences(target, pca.references, core.nearestMatches) }));
  const result = calculate({ target, groupLimit: "auto", closestPopulationDistance: 0,
    closestPcaId: regular[0].id, modernPcas: [...regular, mixed] });
  assert.equal(result.pca.id, "global-caucasus");
  const fits = Object.fromEntries(result.pcaFitDistances.map(({ id, distance }) => [id, distance]));
  assert.ok(fits["global-caucasus"] < fits["global-anatolian-turks-and-azerbaijanis"] * 0.75);
  assert.ok(fits.mixed > fits["global-caucasus"]);
});

test("mixed needs a 25 percent fit improvement over the best regular PCA", () => {
  const regular = { id: "regular", title: "Regular", references: [
    row("Regular:A", 0.03), row("Regular:B", 0.04), row("Regular:C", 0.05),
  ] };
  const mixed = { id: "mixed", title: "Mixed", references: [
    row("Mixed:A", 0.024), row("Mixed:B", 0.03), row("Mixed:C", 0.04),
  ] };
  const result = calculate({ closestPcaId: "regular", closestPopulationDistance: 2.001,
    modernPcas: [regular, mixed],
    groupLimit: "auto" });
  assert.equal(result.pca.id, "regular");
  assert.ok(result.pcaFitDistances.find((entry) => entry.id === "mixed").distance <
    result.pcaFitDistances.find((entry) => entry.id === "regular").distance);
});

test("a manual group count still uses auto fits to choose the default PCA", () => {
  const result = calculate({ groupLimit: 1, closestPopulationDistance: 2.001,
    modernPcas: [...pcas,
    { id: "mixed", title: "Mixed PCA", references: mixedReferences }] });
  assert.equal(result.pca.id, "mixed");
  assert.equal(result.fit.groups.length, 1);
});

test("mixed does not override a closest PCA with a fit at or below two", () => {
  const near = { id: "first", title: "First", references: [row("First:A", 0),
    row("First:B", 1), row("First:C", 2)] };
  const result = calculate({ groupLimit: "auto", modernPcas: [near,
    { id: "mixed", title: "Mixed PCA", references: mixedReferences }] });
  assert.equal(result.pca.id, "first");
  assert.equal(result.fit.distance, 0);
});

test("mixed does not override an equally fitting closest PCA", () => {
  const equallyDistant = [1, 2, 3].map((index) => row(`Mixed:Sample${index}`, -index));
  const result = calculate({ groupLimit: "auto", modernPcas: [pcas[0],
    { id: "mixed", title: "Mixed PCA", references: equallyDistant }] });
  assert.equal(result.pca.id, "first");
});

test("tied closest PCAs choose the one with the lower auto fit", () => {
  const better = { id: "second", title: "Second", references: [
    row("Second:A", 1), row("Second:B", -1), row("Second:C", 3),
  ] };
  const result = calculate({ groupLimit: "auto", closestPcaIds: ["first", "second"],
    modernPcas: [pcas[0], better] });
  assert.equal(result.pca.id, "second");
  assert.ok(result.fit.distance < 0.001);
  assert.ok(result.pcaFitDistances.find((entry) => entry.id === "first").distance > 0);
});

test("mixed override compares against the best tied regular PCA", () => {
  const better = { id: "second", title: "Second", references: [
    row("Second:A", 1), row("Second:B", -1), row("Second:C", 3),
  ] };
  const result = calculate({ groupLimit: "auto", closestPcaIds: ["first", "second"],
    modernPcas: [pcas[0], better,
      { id: "mixed", title: "Mixed PCA", references: mixedReferences }] });
  assert.equal(result.pca.id, "second");
});

test("mixed PCA fits its own dataset at every selected group limit", () => {
  for (const groupLimit of [1, 2, 3, 4, 5]) {
    const result = calculate({ selectedPcaId: "mixed", references: mixedReferences,
      groupStyle: "mixed", groupLimit, modernPcas: null });
    assert.equal(result.pca, null);
    assert.ok(result.fit.distance < 0.001);
    assert.equal(result.pcaFitDistances.length, 0);
  }
});

test("one-group mode stays on the closest regular PCA", () => {
  const result = calculate({ groupLimit: 1, closestPcaId: "second" });
  assert.equal(result.pca.id, "second");
  assert.equal(result.fit.groups.length, 1);
});

test("manual PCA selection remains regular", () => {
  const result = calculate({ selectedPcaId: "second" });
  assert.equal(result.pca.id, "second");
  assert.ok(result.fit.distance > 0);
});

test("mixed PCA selection uses its own map when profiles are scanned", () => {
  const result = calculate({ selectedPcaId: "mixed", references: mixedReferences,
    groupStyle: "mixed", groupLimit: "auto", modernPcas: [...pcas,
      { id: "mixed", title: "Mixed PCA", references: mixedReferences }] });
  assert.equal(result.pca.id, "mixed");
  assert.equal(result.pcaFitDistances.length, 4);
  assert.ok(result.fit.distance < 0.001);
});
