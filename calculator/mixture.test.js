const assert = require("node:assert/strict");
const test = require("node:test");
const { estimate } = require("./mixture.js");

function row(label, values) {
  return { category: "modern", label, values };
}

test("two-way fit stays near 50/50 within 45–55%", () => {
  const references = [row("A", Array(25).fill(0)), row("B", Array(25).fill(1))];
  const result = estimate(row("Target", Array(25).fill(0.53)), references);
  assert.equal(result.parents.length, 1);
  assert.ok(result.parents[0].distance < 1e-8);
  assert.ok(Math.abs(result.parents[0].parts[0].weight - 0.47) < 1e-8);
  assert.ok(Math.abs(result.parents[0].parts[1].weight - 0.53) < 1e-8);
  assert.deepEqual(result.grandparents, []);

  const outside = estimate(row("Target", Array(25).fill(0.4)), references).parents[0];
  assert.ok(Math.abs(outside.parts[0].weight - 0.55) < 1e-8);
  assert.ok(Math.abs(outside.parts[1].weight - 0.45) < 1e-8);
  assert.ok(outside.distance > 0);
});

test("four-way fit keeps every share between 22.5% and 27.5%", () => {
  const references = Array.from({ length: 4 }, (_, index) => {
    const values = Array(25).fill(0);
    values[index] = 1;
    return row(`G${index + 1}`, values);
  });
  const target = row("Target", [0.225, 0.225, 0.275, 0.275, ...Array(21).fill(0)]);
  const result = estimate(target, references);
  assert.equal(result.grandparents.length, 1);
  const fit = result.grandparents[0];
  assert.ok(fit.distance < 1e-5);
  assert.deepEqual(fit.parts.map((part) => part.id), [0, 1, 2, 3]);
  for (const part of fit.parts) assert.ok(part.weight >= 0.225 - 1e-8 && part.weight <= 0.275 + 1e-8);
  assert.ok(Math.abs(fit.parts.reduce((sum, part) => sum + part.weight, 0) - 1) < 1e-8);
});

test("ranked mixtures use distinct references and increasing fit distance", () => {
  const references = Array.from({ length: 8 }, (_, index) => row(`R${index}`, Array(25).fill(index / 10)));
  const result = estimate(row("Target", Array(25).fill(0.35)), references);
  for (const fits of [result.parents, result.grandparents]) {
    assert.equal(fits.length, 10);
    for (let index = 0; index < fits.length; index += 1) {
      const fit = fits[index];
      assert.equal(new Set(fit.parts.map((part) => part.id)).size, fit.parts.length);
      if (index) assert.ok(fit.distance >= fits[index - 1].distance - 1e-8);
    }
  }
});
