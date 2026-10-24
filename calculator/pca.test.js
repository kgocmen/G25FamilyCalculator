const assert = require("node:assert/strict");
const test = require("node:test");
const { projectPca, projectCoordinates, coordinateExtremes } = require("./pca.js");

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

test("display-only custom populations do not move the PCA axes or existing points", () => {
  const rows = [reference("A", -2, 0), reference("B", 2, 0),
    reference("C", 0, -1), reference("D", 0, 1)];
  const input = { values: Array(25).fill(0) };
  const baseline = projectPca(input, rows);
  const custom = reference("Custom", 100, 100);
  const withCustom = projectPca(input, rows, [], "colon", false, [custom]);
  assert.deepEqual(withCustom.points, baseline.points);
  assert.deepEqual(withCustom.target, baseline.target);
  assert.deepEqual(withCustom.explained, baseline.explained);
  assert.equal(withCustom.overlays[0].label, "Custom");
});

test("modern PCA uses prepared group names", () => {
  const references = [reference("Türk_Anadolu:Sample", -1, 0),
    reference("Rum_Helen:Sample", 1, 0), reference("Ermeni_Erzurum_(n=9)", 0, 1)];
  const projected = projectPca({ values: Array(25).fill(0) }, references, [], "modern");
  assert.deepEqual(projected.points.map((point) => point.ethnicity),
    ["Türk_Anadolu", "Rum_Helen", "Ermeni"]);
});

test("deep PCA colours references by subregion", () => {
  const references = [reference("Turk Anatolia: Inner: Sample A", -1, 0),
    reference("Turk Anatolia: Inner: Sample B", 1, 0),
    reference("Turk Anatolia: Aegean: Sample C", 0, 1)];
  const projected = projectPca({ values: Array(25).fill(0) }, references, [], "deep");
  assert.deepEqual(projected.points.map((point) => point.ethnicity),
    ["Turk Anatolia: Inner", "Turk Anatolia: Inner", "Turk Anatolia: Aegean"]);
});

test("mixed PCA colours map points by the ethnicity after the colon", () => {
  const references = [reference("Batı_Anadolu:Türk_Orta_Karadeniz", -1, 0),
    reference("İç_Anadolu:Türk_Doğu_İç_Anadolu", 1, 0),
    reference("Balkanlar:Yunan;Ege", 0, 1)];
  const projected = projectPca({ values: Array(25).fill(0) }, references, [], "mixed");
  assert.deepEqual(projected.points.map((point) => point.ethnicity),
    ["Türk", "Türk", "Yunan"]);
});

test("sparse PCA can project only its fitted components and one closest overlay", () => {
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

test("reference-only PCA fits axes without an input or centroid overlays", () => {
  const rows = [reference("A", -2, 0), reference("B", 2, 0),
    reference("C", 0, -1), reference("D", 0, 1)];
  const centroid = { label: "Center", values: Array(25).fill(0) };
  const projection = projectPca(null, rows, [centroid], "population", true);
  const withoutOverlay = projectPca(null, rows, [], "population", true);
  assert.equal(projection.target, null);
  assert.deepEqual(projection.points, withoutOverlay.points);
  assert.deepEqual(projection.explained, withoutOverlay.explained);
  assert.ok(Math.abs(projection.overlays[0].x) < 1e-9);
  assert.ok(Math.abs(projection.overlays[0].y) < 1e-9);
  assert.ok(projectPca(null, rows.slice(0, 1), [], "population", true).points
    .every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test("invalid coordinates are rejected", () => {
  const references = [reference("A:1", 0, 0), reference("B:2", 1, 0), reference("C:3", 0, 1)];
  assert.throws(() => projectPca({ values: [0] }, references), /25 finite/);
  assert.throws(() => projectPca({ values: Array(25).fill(0) }, references.slice(0, 2)), /three/);
  assert.throws(() => projectPca({ values: Array(25).fill(0) }, references,
    [["modern", "Broken", 0]]), /overlay/);
});

test("PC view reads the original first through twenty-fifth coordinates without centering or rotation", () => {
  const rows = [1, -1].map((sign) => ["modern", `Sample_${sign}`,
    ...Array.from({ length: 25 }, (_, i) => sign * (i + 1) / 100)]);
  const original = JSON.stringify(rows);
  const overlays = [{ label: "Centroid", values: Array(25).fill(0.125) }];
  const projection = projectCoordinates(rows, 25, 1, overlays);
  assert.deepEqual(projection.points, [
    { label: "Sample_1", x: 0.25, y: 0.01 },
    { label: "Sample_-1", x: -0.25, y: -0.01 },
  ]);
  assert.deepEqual(projection.overlays, [{ label: "Centroid", x: 0.125, y: 0.125 }]);
  assert.deepEqual(projectCoordinates(rows).points.map(({ x, y }) => [x, y]), [[0.01, 0.02], [-0.01, -0.02]]);
  assert.deepEqual(projectCoordinates(rows, 7, 7).points.map(({ x, y }) => [x, y]), [[0.07, 0.07], [-0.07, -0.07]]);
  assert.equal(JSON.stringify(rows), original);
  for (const axis of [0, 26, 1.5, NaN]) assert.throws(() => projectCoordinates(rows, axis, 2), /1 to 25/);
  assert.throws(() => projectCoordinates([["modern", "Broken", 0]]), /invalid G25/);
});

test("PC extrema rank each direction independently and share the five to one hundred row limit", () => {
  const points = Array.from({ length: 120 }, (_, i) => ({ label: `Sample_${i}`, x: i - 60, y: 60 - i }));
  const original = JSON.stringify(points);
  const extremes = coordinateExtremes(points);
  assert.deepEqual(extremes.xMin.map(({ x }) => x), [-60, -59, -58, -57, -56]);
  assert.deepEqual(extremes.xMax.map(({ x }) => x), [59, 58, 57, 56, 55]);
  assert.deepEqual(extremes.yMin.map(({ y }) => y), [-59, -58, -57, -56, -55]);
  assert.deepEqual(extremes.yMax.map(({ y }) => y), [60, 59, 58, 57, 56]);
  for (const [requested, expected] of [[1, 5], [37, 37], [100, 100], [150, 100]]) {
    assert.ok(Object.values(coordinateExtremes(points, requested)).every((list) => list.length === expected));
  }
  assert.ok(Object.values(coordinateExtremes(points.slice(0, 1), 100)).every((list) => list.length === 1));
  assert.ok(Object.values(coordinateExtremes([], 100)).every((list) => list.length === 0));
  assert.equal(JSON.stringify(points), original);
});
