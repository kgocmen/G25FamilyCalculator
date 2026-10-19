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
const row = (label, coordinate) => ["modern", label,
  ...Array.from({ length: 25 }, (_, index) => index === coordinate ? 1 : 0)];
const pcas = [
  { id: "first", title: "First", references: [row("A:One", 0), row("A:Two", 1), row("A:Three", 2)] },
  { id: "second", title: "Second", references: [row("B:One", 3), row("B:Two", 4), row("B:Three", 5)] },
];
const input = { values: Array.from({ length: 25 }, (_, index) => index === 0 || index === 3 ? 0.5 : 0) };

function calculate(overrides = {}) {
  let result;
  const self = { postMessage(message) { result = message; } };
  vm.runInNewContext(`${moduleSource}\n${workerSource}`, { self, globalThis: self });
  self.onmessage({ data: { requestId: 1, target: input, references: pcas[0].references,
    groupLimit: 2, groupStyle: "modern", selectedPcaId: "auto", closestPcaId: "first",
    modernPcas: pcas, ...overrides } });
  assert.equal(result.error, undefined);
  return result;
}

test("worker detects a pair without Istanbul and returns full references for a new PCA plot", () => {
  for (const groupLimit of [2, 3]) {
    const result = calculate({ groupLimit });
    assert.equal(result.pcaFitDistances.length, 2);
    assert.ok(result.mixed);
    assert.equal(result.pca, null);
    assert.ok(result.fit.distance < 1e-6);
    assert.equal(result.availableMixed.references.length, 6);
    assert.equal(result.availableMixed.fit.components.length, 2);
    assert.equal(result.availableMixed.sourceIds.join(","), "first,second");
    assert.equal(result.availableMixed.sourceTitles.join(" + "), "First + Second");
  }
});

test("one-group mode stays on the closest regular PCA", () => {
  const result = calculate({ groupLimit: 1, closestPcaId: "second" });
  assert.equal(result.availableMixed, null);
  assert.equal(result.mixed, null);
  assert.equal(result.pca.id, "second");
  assert.equal(result.fit.groups.length, 1);
});

test("manual PCA selection is preserved while a better paired fit remains available", () => {
  const result = calculate({ selectedPcaId: "second" });
  assert.ok(result.availableMixed);
  assert.equal(result.mixed, null);
  assert.equal(result.pca.id, "second");
  assert.ok(result.availableMixed.fit.distance < result.fit.distance);
});

test("an exact single-source mixture does not become mixed", () => {
  const target = { values: Array.from({ length: 25 }, (_, index) => index < 3 ? 1 / 3 : 0) };
  const result = calculate({ target });
  assert.equal(result.availableMixed, null);
  assert.equal(result.mixed, null);
  assert.equal(result.pca.id, "first");
  assert.equal(result.fit.components.length, 3);
});

test("pair search respects the references remaining after population exclusions", () => {
  const result = calculate({ modernPcas: [pcas[0], { ...pcas[1], references: [] }] });
  assert.equal(result.pcaFitDistances.length, 1);
  assert.equal(result.availableMixed, null);
  assert.equal(result.mixed, null);
});
