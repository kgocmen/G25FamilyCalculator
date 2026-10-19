const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { nearestMatches } = require("./core.js");
const { fitAdmixture } = require("./medieval.js");
const { selectModernPca, rankModernPcas, buildMixedPca, findMixedPca, mixedFitIsBetter,
  isIstanbulReference } = require("./modern_pca.js");

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

test("PCA order uses only the closest distance, preserving original order on ties", () => {
  const pcas = [
    { id: "west", references: [row("Shared", 0), row("West", 0.5)] },
    { id: "east", references: [row("Shared", 0), row("East", 0.2)] },
  ];
  assert.deepEqual(rankModernPcas(target(0), pcas, nearestMatches).map(({ pca }) => pca.id),
    ["west", "east"]);
});

test("Istanbul informs admixture but never ranks the closest PCA", () => {
  const istanbul = row("Türk_İstanbul:Türk_İstanbul_(Anadolu_Türkü_Profili)", 0);
  const pcas = [
    { id: "far", references: [istanbul, row("Türk_A:Far", 0.5)] },
    { id: "near", references: [istanbul, row("Türk_B:Near", 0.2)] },
    { id: "only-istanbul", references: [istanbul] },
  ];
  const ranked = rankModernPcas(target(0), pcas, nearestMatches);
  assert.deepEqual(ranked.map(({ pca }) => pca.id), ["near", "far", "only-istanbul"]);
  assert.ok(Number.isFinite(ranked[0].distance));
  assert.equal(ranked[2].distance, Infinity);
  const selected = selectModernPca(target(0), [istanbul, row("Türk_B:Near", 0.2)], pcas, nearestMatches);
  assert.equal(selected.closest.label, "Türk_B:Near");
  assert.equal(selected.closest.id, 1);
  assert.equal(selected.pca.id, "near");
  assert.ok(pcas.every((pca) => pca.references.includes(istanbul)));
  assert.equal(isIstanbulReference(istanbul), true);
  assert.equal(isIstanbulReference(row("Türk_Balkan:Türk_İstanbul_(Balkan_Profili)", 0)), false);
});

const pcaFits = (input, pcas, limit = 2) => pcas.map((pca) => ({
  pca, fit: fitAdmixture(input, pca.references, limit, "modern"),
}));

test("paired PCA includes unused references and tracks duplicate samples across sources", () => {
  const shared = row("Shared:Sample", 2);
  const first = { id: "first", references: [row("A:Near", -1), row("A:Unused", -2), shared] };
  const second = { id: "second", references: [row("B:Near", 1), row("B:Unused", 3),
    row("Renamed:Shared", 2), row("Türk_İstanbul:Shared", 0)] };
  const mixed = buildMixedPca(first, second);
  assert.deepEqual(mixed.sourceIds, ["first", "second"]);
  assert.deepEqual(mixed.references.map((reference) => reference[1]),
    ["A:Near", "A:Unused", "Shared:Sample", "B:Near", "B:Unused"]);
  assert.deepEqual(mixed.referenceSources, [[0], [0], [0, 1], [1], [1]]);
});

test("mixed PCA must be strictly below 75.00% for two groups and 66.66% for three", () => {
  const fits = [{ fit: { distance: 4 } }, { fit: { distance: 2 } }];
  for (const [limit, boundary] of [[2, 1.5], [3, 1.3332]]) {
    assert.equal(mixedFitIsBetter({ distance: boundary - 1e-8 }, fits, limit), true);
    assert.equal(mixedFitIsBetter({ distance: boundary }, fits, limit), false);
    assert.equal(mixedFitIsBetter({ distance: boundary + 1e-8 }, fits, limit), false);
    assert.equal(mixedFitIsBetter({ distance: 0 }, [{ fit: { distance: 0 } }], limit), false);
    assert.equal(mixedFitIsBetter({ distance: 0 }, [{ fit: { distance: 1e-8 } }], limit), false);
  }
  assert.equal(mixedFitIsBetter({ distance: 1.4 }, fits, 2), true);
  assert.equal(mixedFitIsBetter({ distance: 1.4 }, fits, 3), false);
});

test("a paired fit can recover a useful sample omitted by the individual fits", () => {
  const point = (label, x, y) => ["modern", label, x, y, ...Array(23).fill(0)];
  const pcas = [
    { id: "first", references: [point("A:Near", 1, 0), point("A:Unused", 2, 3), point("A:Far", 3, 0)] },
    { id: "second", references: [point("B:Near", 1, 1), point("B:Far", -2, -3), point("B:Other", 2, 2)] },
  ];
  const input = target(0);
  const fits = pcaFits(input, pcas);
  assert.ok(!fits[0].fit.components.some((part) => part.label === "A:Unused"));
  const mixed = findMixedPca(input, fits, 2, fitAdmixture);
  assert.ok(mixed.fit.distance < 1e-5);
  assert.ok(mixed.fit.components.some((part) => part.label === "A:Unused"));
});

const basis = (label, coordinate) => ["modern", label,
  ...Array.from({ length: 25 }, (_, index) => index === coordinate ? 1 : 0)];
const mixturePcas = [
  { id: "A", title: "Region A", references: [basis("A:One", 0), basis("A:Two", 1), basis("A:Three", 2)] },
  { id: "B", title: "Region B", references: [basis("B:One", 3), basis("B:Two", 4), basis("B:Three", 5)] },
  { id: "C", title: "Region C", references: [basis("C:One", 6), basis("C:Two", 7), basis("C:Three", 8)] },
];

test("pair search applies the threshold for the selected group limit", () => {
  const fits = mixturePcas.slice(0, 2).map((pca, index) => ({ pca, fit: { distance: 2 + index } }));
  const pairedFit = () => ({ distance: 1.4, components: [
    { referenceIndex: 0, weight: 0.5 }, { referenceIndex: 3, weight: 0.5 },
  ] });
  assert.ok(findMixedPca(target(0), fits, 2, pairedFit));
  assert.equal(findMixedPca(target(0), fits, 3, pairedFit), null);
});

test("finds 50/50, 75/25 and 90/10 mixtures without Istanbul at two and three groups", () => {
  for (const limit of [2, 3]) {
    for (const [first, second] of [[0, 1], [0, 2], [1, 2]]) {
      for (const weight of [0.5, 0.75, 0.9]) {
        const input = { values: Array.from({ length: 25 }, (_, index) =>
          index === first * 3 ? weight : index === second * 3 ? 1 - weight : 0) };
        const mixed = findMixedPca(input, pcaFits(input, mixturePcas, limit), limit, fitAdmixture);
        assert.deepEqual(mixed.sourceIds, [mixturePcas[first].id, mixturePcas[second].id]);
        assert.deepEqual(mixed.sourceTitles, [mixturePcas[first].title, mixturePcas[second].title]);
        assert.ok(mixed.fit.distance < 1e-6);
        assert.ok(Math.abs(mixed.exclusiveWeights[0] - weight) < 1e-6);
        assert.ok(Math.abs(mixed.exclusiveWeights[1] - (1 - weight)) < 1e-6);
        assert.ok(mixed.fit.groups.length <= limit);
        assert.ok(mixed.fit.groups.every((group) => group.samples.length <= 4));
        assert.ok(mixed.fit.components.every((part) => mixed.references[part.referenceIndex][1] === part.label));
      }
    }
  }
});

test("bundled Southern Anatolian and Turkistan references recover known mixes and preserve a single-source control", () => {
  const bundle = fs.readFileSync(path.join(__dirname, "modern_pca_references.js"), "utf8");
  const pcas = JSON.parse(bundle.slice(bundle.indexOf("=") + 1).trim().replace(/;$/, ""))
    .filter((pca) => ["guney-anadolu", "turkistan"].includes(pca.id))
    .map((pca) => ({ ...pca, references: pca.references.filter((row) => !isIstanbulReference(row)) }));
  for (const weight of [0.5, 0.75, 0.9]) {
    const input = { values: pcas[0].references[0].slice(2).map((value, index) =>
      value * weight + pcas[1].references[0][index + 2] * (1 - weight)) };
    const mixed = findMixedPca(input, pcaFits(input, pcas), 2, fitAdmixture);
    assert.deepEqual(mixed.sourceIds, ["guney-anadolu", "turkistan"]);
    assert.ok(mixed.fit.distance < 1e-4);
    assert.ok(Math.abs(mixed.exclusiveWeights[0] - weight) < 1e-4);
  }
  const southern = pcas[0].references.filter((row) =>
    /:Türk_(Adana|Mersin|Osmaniye|Gaziantep)_/.test(row[1]));
  assert.equal(southern.length, 4);
  const control = { values: southern[0].slice(2).map((_, index) =>
    southern.reduce((sum, row) => sum + row[index + 2] / 4, 0)) };
  assert.equal(findMixedPca(control, pcaFits(control, pcas), 2, fitAdmixture), null);
});

test("single-source fits, tiny second contributions and one-group mode stay single", () => {
  for (const weight of [1, 0.95]) {
    const input = { values: Array.from({ length: 25 }, (_, index) =>
      index === 0 ? weight : index === 3 ? 1 - weight : 0) };
    assert.equal(findMixedPca(input, pcaFits(input, mixturePcas), 2, fitAdmixture), null);
  }
  const input = { values: Array.from({ length: 25 }, (_, index) => index < 3 ? 1 / 3 : 0) };
  assert.equal(findMixedPca(input, pcaFits(input, mixturePcas), 2, fitAdmixture), null);
  assert.equal(findMixedPca(target(0), [], 1, () => { throw Error("Must not fit pairs"); }), null);
});

test("shared samples cannot supply the minimum contribution for a second source", () => {
  const shared = basis("Shared:One", 0);
  const pcas = [
    { id: "first", references: [shared, basis("A:One", 1)] },
    { id: "second", references: [shared, basis("B:One", 2)] },
  ];
  const input = { values: Array.from({ length: 25 }, (_, i) => i === 0 ? 0.8 : i < 3 ? 0.1 : 0) };
  const accepted = findMixedPca(input, pcaFits(input, pcas), 2, fitAdmixture);
  // Three groups are necessary to retain the shared component and both unique ones.
  assert.equal(accepted, null);
  const mixed = findMixedPca(input, pcaFits(input, pcas, 3), 3, fitAdmixture);
  assert.ok(mixed);
  assert.ok(mixed.exclusiveWeights.every((weight) => Math.abs(weight - 0.1) < 1e-6));
  const mostlyShared = { values: Array.from({ length: 25 }, (_, i) => i === 0 ? 0.9 : i < 3 ? 0.05 : 0) };
  assert.equal(findMixedPca(mostlyShared, pcaFits(mostlyShared, pcas, 3), 3, fitAdmixture), null);
});
