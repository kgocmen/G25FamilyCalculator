const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { nearestMatches } = require("./core.js");
const { fitAdmixture, fitDeepAdmixture } = require("./medieval.js");

function reference(label, first, second = 0) {
  return ["medieval", label, first, second, ...Array(23).fill(0)];
}

test("an exact medieval reference fits at 100%", () => {
  const references = [reference("Türk:Göktürk", 0), reference("Rum:Bizans", 1)];
  const fit = fitAdmixture({ values: Array(25).fill(0) }, references);
  assert.equal(fit.distance, 0);
  assert.equal(fit.groups.length, 1);
  assert.equal(fit.groups[0].ethnicity, "Türk");
  assert.equal(fit.groups[0].weight, 1);
});

test("deep fit groups by main cluster and subregion", () => {
  const references = [reference("Turk Anatolia: Inner: Turkish_Nevşehir", 0),
    reference("Turk Anatolia: Aegean: Turkish_Aydın", 1),
    reference("Turk East: Highlands: Turkish_Erzurum", 2)];
  const fit = fitDeepAdmixture({ values: Array(25).fill(0) }, references);
  assert.equal(fit.distance, 0);
  assert.equal(fit.groups.length, 1);
  assert.equal(fit.groups[0].ethnicity, "Turk Anatolia: Inner");
  assert.equal(fit.groups[0].samples[0].sample, "Turkish_Nevşehir");
});

test("deep group limit fits subregions and improves with a second group", () => {
  const references = [reference("Turk Anatolia: Inner: Sample A", 0),
    reference("Turk Anatolia: Aegean: Sample B", 2),
    reference("Turk Anatolia: Black Sea: Sample C", 5)];
  const target = { values: [1, ...Array(24).fill(0)] };
  const one = fitDeepAdmixture(target, references, 1);
  const two = fitDeepAdmixture(target, references, 2);
  assert.equal(one.groups.length, 1);
  assert.equal(two.groups.length, 2);
  assert.ok(two.distance < one.distance);
});

test("nonnegative mixture weights add to 100% and group by ethnicity", () => {
  const references = [
    reference("Türk:Karluk", 0, 0),
    reference("Türk:Kıpçak", 1, 0),
    reference("Rum:Bizans", 0, 1),
  ];
  const fit = fitAdmixture({ values: [0.25, 0.5, ...Array(23).fill(0)] }, references);
  assert.ok(fit.distance < 1e-4);
  assert.ok(fit.components.every((component) => component.weight >= 0));
  assert.ok(Math.abs(fit.groups.reduce((sum, group) => sum + group.weight, 0) - 1) < 1e-12);
  assert.ok(Math.abs(fit.groups.find((group) => group.ethnicity === "Türk").weight - 0.5) < 1e-4);
  assert.ok(Math.abs(fit.groups.find((group) => group.ethnicity === "Rum").weight - 0.5) < 1e-4);
  assert.equal(fit.groups.find((group) => group.ethnicity === "Türk").samples.length, 2);
  assert.equal(fit.values.length, 25);
  assert.ok(fit.values.every((value, coordinate) => Math.abs(value - fit.components.reduce((sum, part) =>
    sum + part.weight * references[part.referenceIndex][coordinate + 2], 0)) < 1e-12));
});

test("invalid G25 vectors are rejected", () => {
  assert.throws(() => fitAdmixture({ values: [1] }, [reference("Türk:Karluk", 0)]), /25 finite/);
  assert.throws(() => fitAdmixture({ values: Array(25).fill(0) }, []), /unavailable/);
});

test("group caps refit and normalize the selected groups instead of hiding components", () => {
  const references = Array.from({ length: 6 }, (_, group) => ["medieval", `Group${group}:Sample`,
    ...Array.from({ length: 25 }, (_, k) => k === group ? 1 : 0)]);
  const target = { values: Array.from({ length: 25 }, (_, k) => k < 6 ? 1 / 6 : 0) };
  let previousDistance = Infinity;
  for (const limit of [3, 4, 5]) {
    const fit = fitAdmixture(target, references, limit);
    assert.equal(fit.groups.length, limit);
    assert.ok(fit.components.every((part) => references[part.referenceIndex][1] === part.label));
    assert.ok(Math.abs(fit.components.reduce((sum, part) => sum + part.weight, 0) - 1) < 1e-12);
    assert.ok(Math.abs(fit.distance - Math.sqrt((6 - limit) / (6 * limit)) * 100) < 1e-5);
    assert.ok(fit.distance < previousDistance);
    previousDistance = fit.distance;
  }
  assert.equal(fitAdmixture(target, references).groups.length, 5);
  assert.throws(() => fitAdmixture(target, references, 2), /3, 4 or 5/);
});

test("medieval PCA refits at most four samples from one ancestry group", () => {
  const references = Array.from({ length: 5 }, (_, sample) => ["medieval", `Rum:Sample${sample}`,
    ...Array.from({ length: 25 }, (_, k) => k === sample ? 1 : 0)]);
  const fit = fitAdmixture({ values: Array.from({ length: 25 }, (_, k) => k < 5 ? 0.2 : 0) }, references, 3);
  assert.equal(fit.groups.length, 1);
  assert.equal(fit.components.length, 4);
  assert.equal(fit.groups[0].samples.length, 4);
  assert.ok(Math.abs(fit.distance - 100 / Math.sqrt(20)) < 1e-5);
  assert.ok(fit.components.every((component) =>
    references[component.referenceIndex][1] === component.label));
});

test("modern PCA limits each group to four samples at every group count", () => {
  const references = Array.from({ length: 10 }, (_, index) => ["modern",
    `Group_${Math.floor(index / 5)}:Sample${index}`,
    ...Array.from({ length: 25 }, (_, coordinate) => coordinate === index ? 1 : 0)]);
  const target = { values: Array.from({ length: 25 }, (_, index) => index < 10 ? 1 / 10 : 0) };
  for (const limit of [1, 2, 3, 4, 5]) {
    const fit = fitAdmixture(target, references, limit, "modern");
    assert.ok(fit.groups.length <= limit);
    assert.ok(fit.groups.every((group) => group.samples.length === 4));
    assert.ok(fit.components.every((component) =>
      references[component.referenceIndex][1] === component.label));
    assert.ok(Math.abs(fit.components.reduce((sum, component) => sum + component.weight, 0) - 1) < 1e-12);
  }
});

test("modern PCA recovers the four-sample eastern Mediterranean mixture", () => {
  const bundle = fs.readFileSync(path.join(__dirname, "turkish_modern_pca_references.js"), "utf8");
  const pcas = JSON.parse(bundle.slice(bundle.indexOf("=") + 1).trim().replace(/;$/, ""));
  const references = pcas.find((pca) => pca.id === "guney-anadolu").references;
  const target = { values: [
    0.09637333225, 0.06672886375, -0.02578890875, -0.03954812975, -0.027518719,
    -0.01451822925, 0.0029430794, 0.000953666827, -0.0171818185, -0.002563099637,
    -0.003444578, -0.000684475097, 0.001376235427, -0.00316876975, 0.00035611372,
    0.0029880456, -0.001011978853, -0.000330336468, -0.000287897557, -0.001086716163,
    -0.00102764708, -0.00260781345, 0.00020757331, -0.001336821427, 0.001493352925,
  ] };
  const expectedLabels = ["Türk_Adana_(n=28)", "Türk_Mersin_(n=19)",
    "Türk_Osmaniye_(n=2)", "Türk_Gaziantep_(n=19)"].sort();
  for (const limit of [1, 2, 3]) {
    const fit = fitAdmixture(target, references, limit, "modern");
    assert.deepEqual(fit.components.map((part) => part.sample).sort(), expectedLabels);
    assert.ok(fit.components.every((part) => Math.abs(part.weight - 0.25) < 1e-6));
    assert.ok(fit.distance < 1e-6);
  }
});

test("modern groups use the prefix before the colon and tolerate one ungrouped label", () => {
  const references = [
    reference("Türk_Anadolu:Sample_A", 0, 0),
    reference("Türk_Anadolu:Sample_B", 1, 0),
    reference("Rum_Helen:Sample_C", 0, 1),
    reference("Ermeni_Erzurum_(n=9)", 1, 1),
  ];
  for (const [index, name] of [[1, "Türk_Anadolu"], [2, "Rum_Helen"], [3, "Ermeni"]]) {
    const fit = fitAdmixture({ values: references[index].slice(2) }, references, 2, "modern");
    assert.equal(fit.groups[0].ethnicity, name);
    assert.equal(fit.groups[0].weight, 1);
  }
});

test("modern group limit refits selected groups", () => {
  const references = Array.from({ length: 6 }, (_, group) => ["modern", `Group_${group}:Sample`,
    ...Array.from({ length: 25 }, (_, k) => k === group ? 1 : 0)]);
  const target = { values: Array.from({ length: 25 }, (_, k) => k < 6 ? 1 / 6 : 0) };
  for (const limit of [1, 2, 3, 4, 5]) {
    const fit = fitAdmixture(target, references, limit, "modern");
    assert.equal(fit.groups.length, limit);
    assert.ok(fit.components.every((part) => references[part.referenceIndex][1] === part.label));
    assert.ok(Math.abs(fit.groups.reduce((sum, group) => sum + group.weight, 0) - 1) < 1e-12);
  }
  assert.throws(() => fitAdmixture(target, references, 6, "modern"), /1 to 5/);
  for (const limit of [1, 2, 3, 4, 5]) {
    const fit = fitAdmixture(target, references, limit, "mixed");
    assert.equal(fit.groups.length, limit);
  }
  assert.throws(() => fitAdmixture(target, references, 6, "mixed"), /1 to 5/);
});

test("modern group cap can use nearby Kayseri after the İç Anadolu groups merge", () => {
  const lines = fs.readFileSync(path.join(__dirname, "../data/pca/turkish_modern_pca7.g25.txt"), "utf8")
    .trim().split(/\r?\n/);
  const references = lines.map((line) => {
    const [label, ...values] = line.split(",");
    return ["modern", label, ...values.map(Number)];
  });
  const target = { values: [
    0.10621584672971009, 0.09934483736544361, -0.03291658267864724, -0.039769705644961906,
    -0.0175526041383392, -0.006309499666359866, 0.012830702500288844, 0.004449936211094262,
    -0.022396095969441043, 0.005164945108520909, 0.0016179440069558806, -0.0013112783104991296,
    -0.010769485270681462, 0.001887963082314531, -0.0027368650637525, 0.0002636846838486348,
    0.0005694489936761001, 0.00361306159529566, -0.004044535424191946, -0.0032080453218116833,
    0.004108002539511114, 0.002100420583153855, -0.008578813259379422, 0.00032514928429953275,
    0.0074868480063518495,
  ] };
  const nearest = nearestMatches(target, references, 1)[0];
  assert.match(references[nearest.id][1], /Türk_Kayseri_\(n=35\)/);
  const oneGroup = fitAdmixture(target, references, 1, "modern");
  assert.equal(oneGroup.groups[0].ethnicity, "Türk_İç_Anadolu");
  assert.ok(oneGroup.components.some((component) => /Türk_Kayseri_\(n=35\)/.test(component.label)));
  assert.ok(oneGroup.distance <= nearest.distance + 1e-9);
  const twoGroups = fitAdmixture(target, references, 2, "modern");
  assert.ok(twoGroups.distance < oneGroup.distance - 0.05);
  assert.ok(twoGroups.groups.length <= 2);
  assert.ok(twoGroups.components.every((component) =>
    references[component.referenceIndex][1] === component.label));
});
