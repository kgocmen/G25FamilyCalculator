const assert = require("node:assert/strict");
const test = require("node:test");
const { nearestMatches } = require("./core.js");
const { selectModernPca, rankModernPcas } = require("./modern_pca.js");

const row = (label, first) => ["modern", label, first, ...Array(24).fill(0)];
const target = (first) => ({ label: "Input", values: [first, ...Array(24).fill(0)] });

test("auto selects the best-fitting PCA", () => {
  const references = [row("East", 0), row("West", 1)];
  const pcas = [{ id: "east", references: [row("East", 0)] },
    { id: "west", references: [row("West", 1)] }];
  assert.equal(selectModernPca(target(0.1), references, pcas, nearestMatches).pca.id, "east");
  assert.equal(selectModernPca(target(0.9), references, pcas, nearestMatches).pca.id, "west");
});

test("reports the closest population independently of the best-fitting PCA", () => {
  const references = [row("East", 0), row("West", 1)];
  const result = selectModernPca(target(0.9), references,
    [{ id: "east", references: [row("East", 0.89)] }], nearestMatches);
  assert.equal(result.closest.label, "West");
  assert.equal(result.pca.id, "east");
});

test("manual selection overrides the best fit and auto restores it", () => {
  const references = [row("East", 0), row("West", 1)];
  const pcas = [{ id: "east", references: [row("East", 0)] },
    { id: "west", references: [row("West", 1)] }];
  assert.equal(selectModernPca(target(0), references, pcas, nearestMatches, "west").pca.id, "west");
  assert.equal(selectModernPca(target(0), references, pcas, nearestMatches, "auto").pca.id, "east");
  assert.equal(selectModernPca(target(0), [], pcas, nearestMatches, "west").pca.id, "west");
});

test("auto selection uses the included references for each PCA", () => {
  const references = [row("East", 0), row("West", 1)];
  const pcas = [
    { id: "east", references: [row("Excluded", 0), row("East", 0.5)] },
    { id: "west", references: [row("West", 0.2)] },
  ];
  const included = (pca) => pca.references.filter((reference) => reference[1] !== "Excluded");
  assert.equal(selectModernPca(target(0), references, pcas, nearestMatches, "auto", included).pca.id, "west");
});

test("PCA options sort by genetic distance while retaining their original numbers", () => {
  const pcas = [
    { id: "far", references: [row("Far", 1)] },
    { id: "near", references: [row("Near", 0.1)] },
    { id: "unavailable", references: [] },
  ];
  const ranked = rankModernPcas(target(0), pcas, nearestMatches);
  assert.deepEqual(ranked.map(({ pca, number }) => [pca.id, number]),
    [["near", 2], ["far", 1], ["unavailable", 3]]);
  assert.ok(ranked[0].distance < ranked[1].distance);
});

test("shared nearest references are ordered by the next nearest population", () => {
  const pcas = [
    { id: "west", references: [row("Shared", 0), row("West", 0.5)] },
    { id: "east", references: [row("Shared", 0), row("East", 0.2)] },
  ];
  assert.deepEqual(rankModernPcas(target(0), pcas, nearestMatches).map(({ pca }) => pca.id),
    ["east", "west"]);
});
