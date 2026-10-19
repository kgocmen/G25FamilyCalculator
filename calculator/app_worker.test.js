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
  return { id: ["first", "second", "third"][index], references,
    mixedReferences: [...references, row("Türk_İstanbul:Shared", 0, 1)] };
});
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

test("worker restores Istanbul-gated mixed fitting using only selected non-Istanbul references", () => {
  for (const groupLimit of [2, 3]) {
    const result = calculate({ groupLimit });
    assert.equal(result.pcaFitDistances.length, 3);
    assert.ok(result.mixed);
    assert.equal(result.pca, null);
    assert.ok(result.fit.distance < 1e-6);
    assert.equal(result.availableMixed.references.length, 3);
    assert.ok(result.availableMixed.references.every((row) => !row[1].startsWith("Türk_İstanbul:")));
    assert.equal(result.availableMixed.sourceIds.join(","), "first,second,third");
  }
});

test("one-group mode stays on the closest regular PCA", () => {
  const result = calculate({ groupLimit: 1, closestPcaId: "second" });
  assert.equal(result.availableMixed, null);
  assert.equal(result.mixed, null);
  assert.equal(result.pca.id, "second");
  assert.equal(result.fit.groups.length, 1);
});

test("manual PCA selection is preserved while an Istanbul-gated fit remains available", () => {
  const result = calculate({ selectedPcaId: "second" });
  assert.ok(result.availableMixed);
  assert.equal(result.mixed, null);
  assert.equal(result.pca.id, "second");
  assert.ok(result.availableMixed.fit.distance < result.fit.distance);
});

test("an exact single-source mixture does not become mixed", () => {
  const target = { values: pcas[0].references[0].slice(2) };
  const result = calculate({ target });
  assert.equal(result.availableMixed, null);
  assert.equal(result.mixed, null);
  assert.equal(result.pca.id, "first");
  assert.equal(result.fit.components.length, 1);
});

test("regular and mixed calculations respect the references remaining after population exclusions", () => {
  const result = calculate({ modernPcas: [pcas[0], { ...pcas[1], references: [], mixedReferences: [] }] });
  assert.equal(result.pcaFitDistances.length, 1);
  assert.equal(result.availableMixed, null);
  assert.equal(result.mixed, null);
});

test("a possible cross-map fit stays regular when Istanbul is absent or blacklisted", () => {
  const result = calculate({ modernPcas: pcas.map((pca) => ({ ...pca, mixedReferences: pca.references })) });
  assert.equal(result.availableMixed, null);
  assert.equal(result.mixed, null);
  assert.equal(result.pca.id, "first");
  assert.ok(result.fit.distance > 0);
});
