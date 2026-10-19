const assert = require("node:assert/strict");
const test = require("node:test");
const { nearestMatches } = require("./core.js");
const { selectModernPca, rankModernPcas, buildMixedPca, mixedFitIsBetter } = require("./modern_pca.js");

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

test("mixed PCA uses non-Istanbul fitted components from all maps without duplicate samples", () => {
  const istanbul = row("Türk_İstanbul:Shared", 0);
  const shared = row("Türk_A:Shared", 1);
  const fits = [
    { pca: { id: "first", references: [istanbul, shared, row("Türk_A:Other", 2)] },
      fit: { distance: 1, groups: [{ ethnicity: "Türk_İstanbul", weight: 0.4 },
        { ethnicity: "Türk_A", weight: 0.6 }],
      components: [{ label: "Türk_İstanbul:Shared", ethnicity: "Türk_İstanbul" },
        { label: "Türk_A:Shared", ethnicity: "Türk_A" },
        { label: "Türk_A:Other", ethnicity: "Türk_A" }] } },
    { pca: { id: "second", references: [istanbul, shared, row("Türk_B:Sample", 3)] },
      fit: { distance: 2, groups: [{ ethnicity: "Türk_İstanbul", weight: 0.5 },
        { ethnicity: "Türk_A", weight: 0.25 }, { ethnicity: "Türk_B", weight: 0.25 }],
      components: [{ label: "Türk_İstanbul:Shared", ethnicity: "Türk_İstanbul" },
        { label: "Türk_A:Shared", ethnicity: "Türk_A" },
        { label: "Türk_B:Sample", ethnicity: "Türk_B" }] } },
    { pca: { id: "third", references: [row("Türk_C:Sample", 4)] },
      fit: { distance: 3, groups: [{ ethnicity: "Türk_C", weight: 1 }],
        components: [{ label: "Türk_C:Sample", ethnicity: "Türk_C" }] } },
  ];
  const mixed = buildMixedPca(fits);
  assert.deepEqual(mixed.sourceIds, ["first", "second", "third"]);
  assert.deepEqual(mixed.references.map((reference) => reference[1]),
    ["Türk_A:Shared", "Türk_A:Other", "Türk_B:Sample", "Türk_C:Sample"]);
  assert.equal(buildMixedPca(fits.slice(0, 1)), null);
});

test("mixed PCA needs more than a 25% distance improvement over the best single fit", () => {
  const fits = [{ fit: { distance: 2 } }, { fit: { distance: 4 } }];
  assert.equal(mixedFitIsBetter({ distance: 1.49 }, fits), true);
  assert.equal(mixedFitIsBetter({ distance: 1.5 }, fits), false);
  assert.equal(mixedFitIsBetter({ distance: 1.8 }, fits), false);
  assert.equal(mixedFitIsBetter({ distance: 0 }, [{ fit: { distance: 0 } }]), false);
});
