const assert = require("node:assert/strict");
const test = require("node:test");
const { projectPca } = require("./pca.js");

function reference(label, x, y) {
  return ["medieval", label, x, y, ...Array(23).fill(0)];
}

test("PCA separates the two principal directions across the plotted points", () => {
  const references = [
    reference("Türk:Left", -2, 0),
    reference("Türk:Right", 2, 0),
    reference("Rum:Down", 0, -1),
    reference("Rum:Up", 0, 1),
  ];
  const projected = projectPca({ label: "Input", values: Array(25).fill(0) }, references);
  assert.ok(Math.abs(projected.explained[0] - 0.8) < 1e-9);
  assert.ok(Math.abs(projected.explained[1] - 0.2) < 1e-9);
  assert.ok(Math.abs(projected.target.x) < 1e-9);
  assert.ok(Math.abs(projected.target.y) < 1e-9);
  assert.ok(Math.abs(projected.points[0].x) > 1.999999);
  assert.ok(Math.abs(projected.points[2].y) > 0.999999);
  assert.equal(projected.points[0].ethnicity, "Türk");
  assert.equal(projected.points[2].ethnicity, "Rum");
});

test("entered input participates in the plotted PCA", () => {
  const references = [reference("A:1", -2, 0), reference("B:2", 2, 0),
    reference("C:3", 0, -1), reference("D:4", 0, 1)];
  const first = projectPca({ values: Array(25).fill(0) }, references);
  const second = projectPca({ values: [100, 100, ...Array(23).fill(0)] }, references);
  assert.notDeepEqual(first.points, second.points);
  assert.notDeepEqual(first.target, second.target);
});

test("modern overlays participate in the plotted PCA", () => {
  const references = [reference("A:1", -2, 0), reference("B:2", 2, 0),
    reference("C:3", 0, -1), reference("D:4", 0, 1)];
  const target = { values: [0.5, 0.5, ...Array(23).fill(0)] };
  const baseline = projectPca(target, references);
  const modern = ["modern", "Modern:1", 0.5, 10, ...Array(23).fill(0)];
  const withModern = projectPca(target, references, [modern]);
  assert.notDeepEqual(withModern.points, baseline.points);
  assert.notDeepEqual(withModern.explained, baseline.explained);
  assert.equal(withModern.overlays[0].label, "Modern:1");
  const plotted = [...withModern.points, withModern.target, ...withModern.overlays];
  for (const axis of ["x", "y"]) {
    assert.ok(Math.abs(plotted.reduce((sum, point) => sum + point[axis], 0)) < 1e-9);
  }
});

test("modern PCA uses prepared group names", () => {
  const references = [reference("Türk_Anadolu:Sample", -1, 0),
    reference("Rum_Helen:Sample", 1, 0), reference("Ermeni_Erzurum_(n=9)", 0, 1)];
  const projected = projectPca({ values: Array(25).fill(0) }, references, [], "modern");
  assert.deepEqual(projected.points.map((point) => point.ethnicity),
    ["Türk_Anadolu", "Rum_Helen", "Ermeni"]);
});

test("mixed PCA can project only its fitted components and one closest overlay", () => {
  const target = { values: [0.5, 0.5, ...Array(23).fill(0)] };
  const components = [reference("Türk_A:First", 0, 0), reference("Türk_B:Second", 1, 0)];
  const closest = reference("Türk_İstanbul:Closest", 0, 1);
  const projected = projectPca(target, components, [closest], "modern", true);
  assert.deepEqual(projected.points.map((point) => point.label),
    ["Türk_A:First", "Türk_B:Second"]);
  assert.deepEqual(projected.overlays.map((point) => point.label), ["Türk_İstanbul:Closest"]);
  const single = projectPca(target, components.slice(0, 1), [closest], "modern", true);
  assert.equal(single.points.length, 1);
  assert.ok([...single.points, single.target, ...single.overlays]
    .every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test("invalid coordinates are rejected", () => {
  const references = [reference("A:1", 0, 0), reference("B:2", 1, 0), reference("C:3", 0, 1)];
  assert.throws(() => projectPca({ values: [0] }, references), /25 finite/);
  assert.throws(() => projectPca({ values: Array(25).fill(0) }, references.slice(0, 2)), /three/);
  assert.throws(() => projectPca({ values: Array(25).fill(0) }, references,
    [["modern", "Broken", 0]]), /overlay/);
});
