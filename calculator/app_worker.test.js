const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const start = app.indexOf("  function medievalWorkerMain() {");
const end = app.indexOf("  function mixtureWorkerMain() {", start);
assert.ok(start >= 0 && end > start);
const workerSource = `(${app.slice(start, end).trim()})()`;
const moduleSource = ["medieval.js", "modern_pca.js"].map((file) =>
  fs.readFileSync(path.join(__dirname, file), "utf8")).join("\n");
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
  assert.ok(messages.every((message) => !message.error));
  const selected = messages.find((message) => message.kind === "selected");
  assert.equal(messages.filter((message) => message.kind === "selected").length, 1);
  return { ...selected, pcaFitDistances: messages.filter((message) => message.kind === "profile") };
}

test("automatic PCA stays regular even when the combined references fit better", () => {
  const result = calculate();
  assert.equal(result.pca.id, "first");
  assert.ok(result.fit.distance > 0);
  assert.equal(result.pcaFitDistances.length, 3);
});

test("mixed becomes the automatic PCA when its auto fit beats a closest PCA above two", () => {
  const result = calculate({ groupLimit: "auto", modernPcas: [...pcas,
    { id: "mixed", title: "Mixed PCA", references: mixedReferences }] });
  assert.equal(result.pca.id, "mixed");
  assert.ok(result.pcaFitDistances.find((entry) => entry.id === "first").distance > 2);
  assert.ok(result.fit.distance < result.pcaFitDistances.find((entry) => entry.id === "first").distance);
});

test("a manual group count still uses auto fits to choose the default PCA", () => {
  const result = calculate({ groupLimit: 1, modernPcas: [...pcas,
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
