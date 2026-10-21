const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { nearestMatches } = require("./core.js");
const { fitAdmixture } = require("./medieval.js");
const { selectModernPca, rankModernPcas, buildMixedPca, fitMixedPca,
  isIstanbulReference } = require("./modern_pca.js");

const row = (label, first) => ["modern", label, first, ...Array(24).fill(0)];
const target = (first) => ({ label: "Input", values: [first, ...Array(24).fill(0)] });

test("bundled modern PCAs match their source files", () => {
  const bundle = fs.readFileSync(path.join(__dirname, "modern_pca_references.js"), "utf8");
  const pcas = JSON.parse(bundle.slice(bundle.indexOf("=") + 1).trim().replace(/;$/, ""));
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/pca/turkish_pca_config.txt"), "utf8"));
  assert.deepEqual(pcas.map(({ id, title }) => ({ id, title })),
    config.modern.map(({ id, title }) => ({ id, title })));
  assert.equal(pcas.length, 11);
  assert.deepEqual({ id: pcas[6].id, title: pcas[6].title },
    { id: "ic-anadolu", title: "İç Anadolu" });
  assert.deepEqual(pcas.slice(-3).map(({ id, title }) => ({ id, title })), [
    { id: "kafkasya", title: "Kafkasya" },
    { id: "turkistan", title: "Türkistan" },
    { id: "istanbul", title: "İstanbul" },
  ]);
  for (const [index, entry] of config.modern.entries()) {
    const source = fs.readFileSync(path.join(__dirname, "../data/pca", entry.file), "utf8");
    const labels = source.trim().split(/\r?\n/).map((line) => line.split(",", 1)[0]);
    assert.deepEqual(pcas[index].references.map((reference) => reference[1]), labels, entry.file);
    assert.equal(pcas[index].referenceAnchors.length, labels.length, entry.file);
  }
});

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

test("mixed PCA averages each inner group into a point under its source PCA", () => {
  const pcas = [
    { id: "south", title: "Güney Anadolu", references: [
      row("Türk_A:One", 0), row("Türk_A:Two", 2), row("Kürt:Sample", 4),
    ] },
    { id: "east", title: "Doğu Anadolu", references: [
      row("Türk_A:One", 10), row("Türk_A:Two", 14), row("Ermeni:Sample", 20),
    ] },
    { id: "istanbul", title: "İstanbul", references: [row("İstanbul:Sample", 100)] },
  ];
  const mixed = buildMixedPca(pcas);
  assert.equal(mixed.id, "mixed");
  assert.deepEqual(mixed.sourceIds, ["south", "east"]);
  assert.deepEqual(mixed.references.map((reference) => reference[1]), [
    "Güney Anadolu:Türk_A centroid", "Güney Anadolu:Kürt centroid",
    "Doğu Anadolu:Türk_A centroid", "Doğu Anadolu:Ermeni centroid",
  ]);
  assert.deepEqual(mixed.references.map((reference) => reference[2]), [1, 4, 12, 20]);
  assert.ok(mixed.references.every((reference) => reference.length === 27));
  assert.equal(buildMixedPca([pcas[2]]), null);
});

test("mixed PCA remains selectable but never becomes automatic", () => {
  const regular = { id: "regular", references: [row("Regular", 0.5)] };
  const mixed = buildMixedPca([regular, { id: "other", references: [
    row("Other", 1), row("Near", 0), row("Extra", 2),
  ] }]);
  const choices = [regular, mixed];
  const ranked = rankModernPcas(target(0), choices, nearestMatches);
  assert.equal(ranked[0].pca.id, "mixed");
  assert.equal(selectModernPca(target(0), [...regular.references, ...mixed.references],
    choices, nearestMatches, "auto", (pca) => pca.references, ranked).pca.id, "regular");
  assert.equal(selectModernPca(target(0), [...regular.references, ...mixed.references],
    choices, nearestMatches, "mixed", (pca) => pca.references, ranked).pca.id, "mixed");
});

test("bundled mixed PCA has ten source groups and their inner-group centroids", () => {
  const bundle = fs.readFileSync(path.join(__dirname, "modern_pca_references.js"), "utf8");
  const pcas = JSON.parse(bundle.slice(bundle.indexOf("=") + 1).trim().replace(/;$/, ""));
  const mixed = buildMixedPca(pcas);
  const sources = pcas.filter((pca) => pca.id !== "istanbul");
  assert.deepEqual(mixed.sourceIds, sources.map((pca) => pca.id));
  assert.equal(mixed.sourceIds.length, 10);
  assert.deepEqual([...new Set(mixed.references.map((reference) => reference[1].split(":", 1)[0]))],
    sources.map((pca) => pca.title));
  for (const pca of sources) {
    const groups = new Map();
    for (const reference of pca.references) {
      const name = reference[1].split(":", 1)[0];
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(reference);
    }
    const centroids = mixed.references.filter((reference) => reference[1].startsWith(`${pca.title}:`));
    assert.equal(centroids.length, groups.size);
    for (const [name, rows] of groups) {
      const point = centroids.find((reference) => reference[1] === `${pca.title}:${name} centroid`);
      assert.ok(point);
      for (let coordinate = 0; coordinate < 25; coordinate += 1) {
        const expected = rows.reduce((sum, row) => sum + row[coordinate + 2], 0) / rows.length;
        assert.ok(Math.abs(point[coordinate + 2] - expected) < 1e-12);
      }
    }
  }
});

test("mixed fit uses the complete centroid dataset and requires two or three groups", () => {
  const references = [row("West:A centroid", -1), row("East:B centroid", 1),
    ["modern", "North:C centroid", 3, 0.5, ...Array(23).fill(0)]];
  const fit = fitMixedPca(target(0), references, 2, fitAdmixture);
  assert.ok(fit.distance < 0.001);
  assert.deepEqual(new Set(fit.groups.map((group) => group.ethnicity)), new Set(["West", "East"]));
  assert.throws(() => fitMixedPca(target(0), references, 1, fitAdmixture), /requires 2 or 3/);
});
