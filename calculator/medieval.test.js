const assert = require("node:assert/strict");
const test = require("node:test");
const { fitAdmixture } = require("./medieval.js");

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
    assert.ok(Math.abs(fit.components.reduce((sum, part) => sum + part.weight, 0) - 1) < 1e-12);
    assert.ok(Math.abs(fit.distance - Math.sqrt((6 - limit) / (6 * limit)) * 100) < 1e-5);
    assert.ok(fit.distance < previousDistance);
    previousDistance = fit.distance;
  }
  assert.equal(fitAdmixture(target, references).groups.length, 5);
  assert.throws(() => fitAdmixture(target, references, 2), /3, 4 or 5/);
});

test("several samples in one ancestry group do not consume extra group slots", () => {
  const references = Array.from({ length: 4 }, (_, sample) => ["medieval", `Rum:Sample${sample}`,
    ...Array.from({ length: 25 }, (_, k) => k === sample ? 1 : 0)]);
  const fit = fitAdmixture({ values: Array.from({ length: 25 }, (_, k) => k < 4 ? 0.25 : 0) }, references, 3);
  assert.equal(fit.groups.length, 1);
  assert.equal(fit.components.length, 4);
  assert.ok(fit.distance < 1e-5);
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
  for (const limit of [1, 2, 3]) {
    const fit = fitAdmixture(target, references, limit, "modern");
    assert.equal(fit.groups.length, limit);
    assert.ok(Math.abs(fit.groups.reduce((sum, group) => sum + group.weight, 0) - 1) < 1e-12);
  }
  assert.throws(() => fitAdmixture(target, references, 4, "modern"), /1, 2 or 3/);
});
