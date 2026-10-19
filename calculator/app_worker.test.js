const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { fitAdmixture } = require("./medieval.js");
const { buildMixedPca, mixedFitIsBetter } = require("./modern_pca.js");

test("mixed PCA is offered only below 75% of the best PCA fit at two or three groups", () => {
  const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const start = app.indexOf("  function medievalWorkerMain() {");
  const end = app.indexOf("  function mixtureWorkerMain() {", start);
  assert.ok(start >= 0 && end > start);
  const workerSource = `(${app.slice(start, end).trim()})()`;
  const pcas = [
    { id: "first", references: [1, 2, 3] },
    { id: "second", references: [4, 5, 6] },
  ];
  const candidate = { references: [7, 8, 9] };

  function calculate(groupLimit, mixedDistance, closestPcaId = null) {
    let result;
    const calls = [];
    let mixedBuilds = 0;
    const self = {
      G25Medieval: {
        fitAdmixture(_target, references, limit) {
          calls.push({ references, limit });
          return { distance: references === pcas[0].references ? 2
            : references === pcas[1].references ? 3 : mixedDistance };
        },
      },
      G25ModernPca: { buildMixedPca: () => { mixedBuilds += 1; return candidate; },
        mixedFitIsBetter },
      postMessage(message) { result = message; },
    };
    vm.runInNewContext(workerSource, { self });
    self.onmessage({ data: { requestId: 1, target: {}, references: [],
      groupLimit, groupStyle: "modern", selectedPcaId: "auto", closestPcaId,
      modernPcas: pcas } });
    assert.equal(result.error, undefined);
    assert.equal(result.pcaFitDistances.length, 2);
    assert.equal(result.pcaFitDistances.find(({ id }) => id === "first").distance, 2);
    assert.equal(result.pcaFitDistances.find(({ id }) => id === "second").distance, 3);
    if (groupLimit === 1) {
      assert.equal(mixedBuilds, 0);
      assert.ok(!calls.some(({ references }) => references === candidate.references));
    } else assert.ok(calls.some(({ references, limit }) =>
      references === candidate.references && limit === groupLimit));
    return result;
  }

  const oneGroup = calculate(1, 0);
  assert.equal(oneGroup.availableMixed, null);
  assert.equal(oneGroup.mixed, null);
  assert.equal(oneGroup.pca.id, "first");
  const nearestOverridesFit = calculate(1, 0, "second");
  assert.equal(nearestOverridesFit.pca.id, "second");
  assert.equal(nearestOverridesFit.fit.distance, 3);

  for (const limit of [2, 3]) {
    const rejected = calculate(limit, 1.5);
    assert.equal(rejected.availableMixed, null);
    assert.equal(rejected.mixed, null);
    assert.equal(rejected.pca.id, "first");

    const accepted = calculate(limit, 1.49);
    assert.ok(accepted.availableMixed);
    assert.ok(accepted.mixed);
    assert.equal(accepted.fit.distance, 1.49);
  }
});

test("one group stays on a regular PCA even when a mixed fit could improve it", () => {
  const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const source = app.slice(app.indexOf("  function medievalWorkerMain() {"),
    app.indexOf("  function mixtureWorkerMain() {")).trim();
  const row = (label, first, second) => ["modern", label, first, second, ...Array(23).fill(0)];
  const pcas = [-1, 1, 2].map((coordinate, index) => ({
    id: `pca${index}`,
    references: [
      row("Türk_İstanbul:Shared", 0, 1),
      row(`Türk_A:Sample${index}`, coordinate, 0),
      row(`Türk_B:Far${index}`, 5, 5),
    ],
  }));
  let result;
  const self = {
    G25Medieval: { fitAdmixture },
    G25ModernPca: { buildMixedPca, mixedFitIsBetter },
    postMessage(message) { result = message; },
  };
  vm.runInNewContext(`(${source})()`, { self });
  self.onmessage({ data: { requestId: 1, target: { values: Array(25).fill(0) },
    references: [], groupLimit: 1, groupStyle: "modern",
    selectedPcaId: "auto", modernPcas: pcas } });

  assert.equal(result.error, undefined);
  assert.equal(result.availableMixed, null);
  assert.equal(result.mixed, null);
  assert.ok(result.pca);
  assert.equal(result.fit.groups.length, 1);
  assert.ok(result.fit.distance >= 75);
});
