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


test("Istanbul must contribute in at least two maps before trying a mixed fit", () => {
  const pcas = [
    { id: "first", references: [row("A:One", -1), row("A:Two", -2), row("A:Three", -3)] },
    { id: "second", references: [row("B:One", 1), row("B:Two", 2), row("B:Three", 3)] },
  ];
  const fits = pcas.map((pca) => ({ pca, fit: fitAdmixture(target(0), pca.references, 2, "modern") }));
  assert.equal(buildMixedPca(fits), null);
  assert.equal(findMixedPca(target(0), fits, 2, () => { throw Error("Must not search arbitrary pairs"); }), null);
  fits[0].fit.groups.push({ ethnicity: "Türk_İstanbul", weight: 0.5 });
  assert.equal(buildMixedPca(fits), null);
  fits[1].fit.groups.push({ ethnicity: "Türk_İstanbul", weight: 0 });
  assert.equal(buildMixedPca(fits), null);
});

test("Istanbul-gated refitting applies each group threshold against the regular PCA baseline", () => {
  const fits = [-1, 1, 2].map((coordinate, index) => ({
    pca: { id: String(index), references: [row("Türk_İstanbul:Shared", 10),
      row(`Group${index}:Selected`, coordinate), row(`Group${index}:Unused`, coordinate * 3)] },
    fit: { distance: 0.5, groups: [{ ethnicity: "Türk_İstanbul", weight: 0.5 }],
      components: [{ ethnicity: `Group${index}`, label: `Group${index}:Selected` }] },
  }));
  const baseline = [{ fit: { distance: 2 } }, { fit: { distance: 4 } }];
  const refit = (_target, references, limit, style) => {
    assert.ok(references.every((row) => row[1].endsWith(":Selected")));
    assert.equal(references.length, 3);
    assert.equal(style, "modern");
    return { distance: 1.4, groupLimit: limit };
  };
  const result = findMixedPca(target(0), fits, 2, refit, baseline);
  assert.equal(result.fit.groupLimit, 2);
  assert.equal(findMixedPca(target(0), fits, 3, refit, baseline), null);
  assert.equal(findMixedPca(target(0), fits, 1, refit, baseline), null);
});

test("the bundled four-sample southern Anatolian control remains a single-source fit", () => {
  const bundle = fs.readFileSync(path.join(__dirname, "modern_pca_references.js"), "utf8");
  const pcas = JSON.parse(bundle.slice(bundle.indexOf("=") + 1).trim().replace(/;$/, ""));
  const southern = pcas.find((pca) => pca.id === "guney-anadolu").references.filter((row) =>
    /:Türk_(Adana|Mersin|Osmaniye|Gaziantep)_/.test(row[1]));
  assert.equal(southern.length, 4);
  const input = { values: southern[0].slice(2).map((_, index) =>
    southern.reduce((sum, row) => sum + row[index + 2] / 4, 0)) };
  for (const limit of [2, 3]) {
    const baseline = pcas.map((pca) => ({ pca, fit: fitAdmixture(input,
      pca.references.filter((row) => !isIstanbulReference(row)), limit, "modern") }));
    const sourceFits = pcas.map((pca) => ({ pca, fit: fitAdmixture(input, pca.references, limit, "modern") }));
    assert.equal(findMixedPca(input, sourceFits, limit, fitAdmixture, baseline), null);
  }
});
