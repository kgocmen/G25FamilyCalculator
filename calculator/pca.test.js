const assert = require("node:assert/strict");
const test = require("node:test");
const { projectPca } = require("./pca.js");

function reference(label, x, y) {
  return ["medieval", label, x, y, ...Array(23).fill(0)];
}

test("PCA separates the two principal directions and projects the input", () => {
  const references = [
    reference("Türk:Left", -2, 0),
    reference("Türk:Right", 2, 0),
    reference("Rum:Down", 0, -1),
    reference("Rum:Up", 0, 1),
  ];
  const projected = projectPca({ label: "Input", values: [1, 1, ...Array(23).fill(0)] }, references);
  assert.ok(Math.abs(projected.explained[0] - 0.8) < 1e-9);
  assert.ok(Math.abs(projected.explained[1] - 0.2) < 1e-9);
  assert.ok(Math.abs(projected.target.x) > 0.999999);
  assert.ok(Math.abs(projected.target.y) > 0.999999);
  assert.equal(projected.points[0].ethnicity, "Türk");
  assert.equal(projected.points[2].ethnicity, "Rum");
});

test("reference PCA positions stay fixed when the entered input changes", () => {
  const references = [reference("A:1", -2, 0), reference("B:2", 2, 0),
    reference("C:3", 0, -1), reference("D:4", 0, 1)];
  const first = projectPca({ values: Array(25).fill(0) }, references);
  const second = projectPca({ values: [100, 100, ...Array(23).fill(0)] }, references);
  assert.deepEqual(first.points, second.points);
  assert.notDeepEqual(first.target, second.target);
});

test("modern overlays use the medieval PCA axes without changing them", () => {
  const references = [reference("A:1", -2, 0), reference("B:2", 2, 0),
    reference("C:3", 0, -1), reference("D:4", 0, 1)];
  const target = { values: [0.5, 0.5, ...Array(23).fill(0)] };
  const baseline = projectPca(target, references);
  const modern = ["modern", "Modern:1", 0.5, 0.5, ...Array(23).fill(0)];
  const withModern = projectPca(target, references, [modern]);
  assert.deepEqual(withModern.points, baseline.points);
  assert.deepEqual(withModern.target, baseline.target);
  assert.deepEqual(withModern.explained, baseline.explained);
  assert.equal(withModern.overlays[0].label, "Modern:1");
  assert.equal(withModern.overlays[0].x, withModern.target.x);
  assert.equal(withModern.overlays[0].y, withModern.target.y);
});

test("invalid coordinates are rejected", () => {
  const references = [reference("A:1", 0, 0), reference("B:2", 1, 0), reference("C:3", 0, 1)];
  assert.throws(() => projectPca({ values: [0] }, references), /25 finite/);
  assert.throws(() => projectPca({ values: Array(25).fill(0) }, references.slice(0, 2)), /three/);
  assert.throws(() => projectPca({ values: Array(25).fill(0) }, references,
    [["modern", "Broken", 0]]), /overlay/);
});
