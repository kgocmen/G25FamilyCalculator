const assert = require("node:assert/strict");
const test = require("node:test");
const { fitClusters, clusterSeries } = require("./clusters.js");

const row = (label, x, y = 0) => ["modern", label, x, y, ...Array(23).fill(0)];

test("k-means uses all G25 coordinates and names the population nearest each centroid", () => {
  const rows = [row("A1", 0, 0), row("A2", 0.2, 0),
    row("B1", 0, 0), row("B2", 0.2, 0)];
  rows[2][4] = 10;
  rows[3][4] = 10;
  const result = fitClusters(rows, 2);
  assert.deepEqual(result.assignments, [0, 0, 1, 1]);
  assert.deepEqual(result.clusters.map((cluster) => cluster.size), [2, 2]);
  assert.deepEqual(result.clusters.map((cluster) => cluster.representativeIndex), [0, 2]);
  assert.ok(Math.abs(result.clusters[0].centroid[0] - 0.1) < 1e-12);
  assert.ok(result.clusters.every((cluster) => Math.abs(cluster.representativeDistance - 10) < 1e-9));
  assert.ok(Math.abs(result.inertia - 0.04) < 1e-9);
});

test("elbow default finds three separated groups and every k remains selectable", () => {
  const rows = [row("A1", 0), row("A2", 0.1), row("A3", -0.1),
    row("B1", 10), row("B2", 10.1), row("B3", 9.9),
    row("C1", 20), row("C2", 20.1), row("C3", 19.9)];
  const result = clusterSeries(rows);
  assert.equal(result.defaultK, 3);
  assert.equal(result.fits.length, 9);
  for (const fit of result.fits) {
    assert.equal(fit.assignments.length, rows.length);
    assert.equal(fit.clusters.length, fit.k);
    assert.ok(fit.clusters.every((cluster) => cluster.size > 0));
  }
});

test("one population and identical populations retain usable clusters", () => {
  assert.equal(clusterSeries([row("Only", 0)]).defaultK, 1);
  const identical = Array.from({ length: 5 }, (_, index) => row(`Same_${index}`, 1));
  const result = clusterSeries(identical);
  assert.equal(result.defaultK, 1);
  assert.ok(result.fits.every((fit) => fit.clusters.every((cluster) => cluster.size > 0)));
});

test("invalid cluster counts or coordinates are rejected", () => {
  assert.throws(() => fitClusters([row("Only", 0)], 2), /Choose between/);
  assert.throws(() => fitClusters([["modern", "Broken", 1]], 1), /valid G25/);
});
