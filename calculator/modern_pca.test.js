const assert = require("node:assert/strict");
const test = require("node:test");
const { nearestMatches } = require("./core.js");
const { selectModernPca } = require("./modern_pca.js");

const row = (label, first) => ["modern", label, first, ...Array(24).fill(0)];
const target = (first) => ({ label: "Input", values: [first, ...Array(24).fill(0)] });

test("selects a custom PCA from the closest Turkish modern population", () => {
  const references = [row("East", 0), row("West", 1)];
  const pcas = [{ id: "east", anchorLabels: ["East"] }, { id: "west", anchorLabels: ["West"] }];
  assert.equal(selectModernPca(target(0.1), references, pcas, nearestMatches).pca.id, "east");
  assert.equal(selectModernPca(target(0.9), references, pcas, nearestMatches).pca.id, "west");
});

test("does not show an unrelated PCA when the closest population has no map", () => {
  const references = [row("East", 0), row("West", 1)];
  const result = selectModernPca(target(0.9), references,
    [{ id: "east", anchorLabels: ["East"] }], nearestMatches);
  assert.equal(result.closest.label, "West");
  assert.equal(result.pca, null);
});

test("manual selection overrides the closest population and auto restores it", () => {
  const references = [row("East", 0), row("West", 1)];
  const pcas = [{ id: "east", anchorLabels: ["East"] }, { id: "west", anchorLabels: ["West"] }];
  assert.equal(selectModernPca(target(0), references, pcas, nearestMatches, "west").pca.id, "west");
  assert.equal(selectModernPca(target(0), references, pcas, nearestMatches, "auto").pca.id, "east");
  assert.equal(selectModernPca(target(0), [], pcas, nearestMatches, "west").pca.id, "west");
});

test("shared anchors route to the PCA with the closest unique neighbour", () => {
  const references = [row("Shared", 0), row("East", -0.4), row("West", 0.4)];
  const pcas = [
    { id: "east", anchorLabels: ["Shared", "East"] },
    { id: "west", anchorLabels: ["Shared", "West"] },
  ];
  assert.equal(selectModernPca(target(-0.1), references, pcas, nearestMatches).pca.id, "east");
  assert.equal(selectModernPca(target(0.1), references, pcas, nearestMatches).pca.id, "west");
  assert.equal(selectModernPca(target(-0.1), references, pcas, nearestMatches, "west").pca.id, "west");
});
