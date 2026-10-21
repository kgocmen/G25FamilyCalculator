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
  return { id: ["first", "second", "third"][index], references };
});
const mixedReferences = pcas.flatMap((pca) => pca.references);
const input = { values: Array(25).fill(0) };

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

test("automatic PCA stays regular even when the combined references fit better", () => {
  const result = calculate();
  assert.equal(result.pca.id, "first");
  assert.ok(result.fit.distance > 0);
  assert.equal(result.pcaFitDistances.length, 3);
});

test("mixed PCA fits the combined references only when selected", () => {
  for (const groupLimit of [2, 3]) {
    const result = calculate({ selectedPcaId: "mixed", references: mixedReferences, groupLimit });
    assert.equal(result.pca, null);
    assert.ok(result.fit.distance < 0.001);
    assert.equal(result.pcaFitDistances.length, 3);
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

test("worker fits mixed selection without scanning every regular PCA", () => {
  const result = calculate({ selectedPcaId: "mixed", references: mixedReferences, modernPcas: null });
  assert.equal(result.pca, null);
  assert.equal(result.pcaFitDistances, null);
  assert.ok(result.fit.distance < 0.001);
});
