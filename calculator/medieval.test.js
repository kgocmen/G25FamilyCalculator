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
