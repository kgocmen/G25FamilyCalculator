const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { nearestMatches } = require("./core.js");
const { selectModernPca, rankModernPcas, defaultGroupFit,
  shouldAutoSelectMixed, isIstanbulReference, selectFitReferences, selectDeepReferences,
  selectMixedDeepReferences, selectMixedMainReferences } = require("./modern_pca.js");

const row = (label, first) => ["modern", label, first, ...Array(24).fill(0)];
const target = (first) => ({ label: "Input", values: [first, ...Array(24).fill(0)] });

test("bundled modern PCAs match their source files", () => {
  const bundle = fs.readFileSync(path.join(__dirname, "turkish_modern_pca_references.js"), "utf8");
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

test("large regional maps fit nearest samples from every group", () => {
  const references = [row("A:Far", 0.9), row("A:Near", 0.1), row("A:Middle", 0.2),
    row("B:Far", -0.9), row("B:Near", -0.1), row("B:Middle", -0.2)];
  assert.deepEqual(selectFitReferences(target(0), references, nearestMatches, 2)
    .map((reference) => reference[1]), ["A:Near", "A:Middle", "B:Near", "B:Middle"]);
});

test("deep references use only groups present in the main PCA fit", () => {
  const references = [row("Turk Anatolia: Sample A", 0),
    row("Turk Anatolia: Sample B", 0.1),
    row("Turk East: Sample C", 0.2),
    row("Turk Anatolia Extended: Sample D", 0.3)];
  assert.deepEqual(selectDeepReferences({ groups: [
    { ethnicity: "Turk Anatolia", weight: 1 },
    { ethnicity: "Turk East", weight: 0 },
  ] }, references).map((reference) => reference[1]),
  ["Turk Anatolia: Sample A", "Turk Anatolia: Sample B"]);
  assert.deepEqual(selectDeepReferences({ groups: [
    { ethnicity: "Turk Anatolia", weight: 0.6 },
    { ethnicity: "Turk East", weight: 0.4 },
  ] }, references).map((reference) => reference[1]),
  references.slice(0, 3).map((reference) => reference[1]));
});

test("mixed deep references come from each fitted source group only", () => {
  const fit = { components: [
    { label: "Southeast_Europe:Albanian", weight: 0.4 },
    { label: "Southeast_Europe:Balkan Slav", weight: 0.3 },
    { label: "West_Asia_and_Caucasus:North Caucasus", weight: 0.3 },
  ] };
  const pcas = [
    { title: "Southeast Europe", references: [
      row("Albanian: Albanian_A", 0),
      row("Balkan Slav: Bulgarian_A", 1),
      row("Balkan Slav: Albanian_A", 0),
      row("Greek: Greek_A", 2),
    ] },
    { title: "West Asia and Caucasus", references: [
      row("North Caucasus: Abkhazian_A", 3),
      row("Levant: Levantine_A", 4),
    ] },
  ];
  assert.deepEqual(selectMixedDeepReferences(fit, pcas).map((reference) => reference[1]), [
    "Southeast_Europe:Albanian_A",
    "Southeast_Europe:Bulgarian_A",
    "West_Asia_and_Caucasus:Abkhazian_A",
  ]);
});

test("mixed deep plots use fitted population rows from the main PCA files", () => {
  const mainFit = { components: [
    { label: "Southeast_Europe:Albanian", weight: 0.2 },
    { label: "Southeast_Europe:Slavic Balkans", weight: 0.5 },
    { label: "West_Asia_and_Caucasus:North Caucasus", weight: 0.3 },
  ] };
  const pcas = [
    { title: "Southeast Europe", references: [
      row("Albanian:Albanian_Gheg", 0), row("Greek:Greek_Attica", 0.1),
      row("Slavic Balkans:Bulgarian", 1), row("Albanian:Albanian_Tosk", 0.2),
    ] },
    { title: "West Asia and Caucasus", references: [
      row("North Caucasus:Abkhazian", 2), row("Levant:Lebanese", 3),
    ] },
  ];
  assert.deepEqual(selectMixedMainReferences(mainFit, pcas).map((reference) => reference[1]), [
    "Southeast_Europe:Albanian:Albanian_Gheg",
    "Southeast_Europe:Slavic Balkans:Bulgarian",
    "Southeast_Europe:Albanian:Albanian_Tosk",
    "West_Asia_and_Caucasus:North Caucasus:Abkhazian",
  ]);
  assert.deepEqual(selectMixedMainReferences(mainFit, [{ title: "Doğu Anadolu", references: [
    row("Türk_Doğu:Türk_Artvin", 1), row("Ermeni:Ermeni", 2),
  ] }]).map((reference) => reference[1]), []);
  assert.deepEqual(selectMixedMainReferences({ components: [
    { label: "Doğu_Anadolu:Türk_Doğu", weight: 1 },
  ] }, [{ title: "Doğu Anadolu", references: [
    row("Türk_Doğu:Türk_Artvin", 1), row("Ermeni:Ermeni", 2),
  ] }]).map((reference) => reference[1]), ["Doğu_Anadolu:Türk_Doğu:Türk_Artvin"]);
});

test("global PCA bundles include deep references only for maps with a deep file", () => {
  const bundle = fs.readFileSync(path.join(__dirname, "modern_pca_references.js"), "utf8");
  const pcas = JSON.parse(bundle.slice(bundle.indexOf("=") + 1).trim().replace(/;$/, ""));
  const config = JSON.parse(fs.readFileSync(path.join(__dirname,
    "../data/pca/pca_config.txt"), "utf8"));
  assert.deepEqual(pcas.map((pca) => pca.id), config.modern.map((entry) => entry.id));
  for (const [index, entry] of config.modern.entries()) {
    const deepPath = path.join(__dirname, "../data/pca",
      entry.file.replace(/\.g25\.txt$/, "_deep.g25.txt"));
    if (!fs.existsSync(deepPath)) {
      assert.equal(pcas[index].deepReferences, undefined);
      continue;
    }
    const source = fs.readFileSync(deepPath, "utf8").trim().split(/\r?\n/)
      .map((line) => line.split(",", 1)[0])
      .filter((label) => label.split(":", 1)[0].trim().toLowerCase() !== "deprecated");
    assert.deepEqual(pcas[index].deepReferences.map((reference) => reference[1]), source);
    assert.equal(pcas[index].deepReferenceAnchors.length, source.length);
  }
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

test("PCA ties retain source order before auto fits are known", () => {
  const pcas = [
    { id: "west", references: [row("Shared", 0), row("West", 0.5)] },
    { id: "east", references: [row("Shared", 0), row("East", 0.2)] },
  ];
  assert.deepEqual(rankModernPcas(target(0), pcas, nearestMatches).map(({ pca }) => pca.id),
    ["west", "east"]);
});

test("equal closest distances use the lower auto fit as the PCA tie break", () => {
  const pcas = [
    { id: "first", references: [row("Shared", 0.1)] },
    { id: "second", references: [row("Shared", -0.1)] },
  ];
  const autoFits = new Map([
    ["first", { distance: 2.5 }], ["second", { distance: 1.2 }],
  ]);
  const ranked = rankModernPcas(target(0), pcas, nearestMatches,
    (pca) => pca.references, autoFits);
  assert.deepEqual(ranked.map(({ pca }) => pca.id), ["second", "first"]);
  assert.equal(selectModernPca(target(0), [], pcas, nearestMatches, "auto",
    (pca) => pca.references, ranked).pca.id, "second");
});

test("a closest population over two ranks PCAs by ascending fit", () => {
  const pcas = [
    { id: "near", references: [row("Near", 0.1)] },
    { id: "far", references: [row("Far", 1)] },
    { id: "mixed", references: [row("Mixed", 2)] },
  ];
  const fits = new Map([
    ["near", { distance: 4 }], ["far", { distance: 1.5 }],
    ["mixed", { distance: 1 }],
  ]);
  const ids = (closestDistance) => rankModernPcas(target(0), pcas, nearestMatches,
    (pca) => pca.references, fits, closestDistance).map(({ pca }) => pca.id);
  assert.deepEqual(ids(2.001), ["mixed", "far", "near"]);
  assert.deepEqual(ids(2), ["near", "far", "mixed"]);
  assert.deepEqual(ids(1.999), ["near", "far", "mixed"]);
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

test("closest-distance ranking starts on a regular PCA while mixed remains selectable", () => {
  const regular = { id: "regular", references: [row("Regular", 0.5)] };
  const mixed = { id: "mixed", references: [row("Other:Near", 0)] };
  const choices = [regular, mixed];
  const ranked = rankModernPcas(target(0), choices, nearestMatches);
  assert.equal(ranked[0].pca.id, "mixed");
  assert.equal(selectModernPca(target(0), [...regular.references, ...mixed.references],
    choices, nearestMatches, "auto", (pca) => pca.references, ranked).pca.id, "regular");
  assert.equal(selectModernPca(target(0), [...regular.references, ...mixed.references],
    choices, nearestMatches, "mixed", (pca) => pca.references, ranked).pca.id, "mixed");
});

test("default group count advances only after a 25 percent fit improvement", () => {
  const fits = [4, 2.9, 2.1, 1.9, 0.5]
    .map((distance, index) => ({ groupLimit: index + 1, fit: { distance } }));
  assert.equal(defaultGroupFit(fits).groupLimit, 3);
  assert.equal(defaultGroupFit([fits[0], { groupLimit: 2, fit: { distance: 3 } }]).groupLimit, 1);
  assert.equal(defaultGroupFit([]), null);
});

test("mixed uses the new threshold above two and keeps the existing rule below it", () => {
  assert.equal(shouldAutoSelectMixed(2.001, 2, 1.499), true);
  assert.equal(shouldAutoSelectMixed(2.001, 2, 1.5), false);
  assert.equal(shouldAutoSelectMixed(2, 3, 1), true);
  assert.equal(shouldAutoSelectMixed(1.999, 3, 1), true);
  assert.equal(shouldAutoSelectMixed(1.999, 2, 1), false);
  assert.equal(shouldAutoSelectMixed(3, 1, 0.74), true);
  assert.equal(shouldAutoSelectMixed(3, 3, 2.25), false);
  assert.equal(shouldAutoSelectMixed(Infinity, 3, 1), true);
  assert.equal(shouldAutoSelectMixed(3, Infinity, 1), false);
  assert.equal(shouldAutoSelectMixed(3, 3, undefined), false);
});

test("bundled mixed PCA uses the editable dataset with ten groups", () => {
  const bundle = fs.readFileSync(path.join(__dirname, "turkish_mixed_pca_references.js"), "utf8");
  const mixed = JSON.parse(bundle.slice(bundle.indexOf("=") + 1).trim().replace(/;$/, ""));
  const source = fs.readFileSync(path.join(__dirname,
    "../data/pca/turkish_modern_pca_mixed.g25.txt"), "utf8").trim().split(/\r?\n/);
  assert.equal(mixed.id, "mixed");
  assert.equal(mixed.references.length, source.length);
  assert.equal(new Set(mixed.references.map((reference) => reference[1].split(":", 1)[0])).size, 10);
  for (const [index, line] of source.entries()) {
    const [label, ...coordinates] = line.split(",");
    assert.deepEqual(mixed.references[index], ["modern", label, ...coordinates.map(Number)]);
    assert.doesNotMatch(label, /centroid/i);
  }
});
