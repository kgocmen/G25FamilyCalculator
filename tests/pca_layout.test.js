const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { convexHull, neighborEdges, nearestConnections, rankNeighborDegrees,
  inputLabelLayout } = require("../calculator/pca_layout.js");

test("cluster outline excludes interior points", () => {
  const hull = convexHull([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 },
    { x: 0, y: 4 }, { x: 2, y: 2 }]);
  assert.equal(hull.length, 4);
  assert.ok(hull.every((point) => point.x !== 2 || point.y !== 2));
});

test("midpoint neighbors exclude an edge when a third point is closer to its midpoint", () => {
  const points = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 1 }];
  assert.deepEqual(neighborEdges(points), [[0, 2], [1, 2]]);
});

test("midpoint neighbors retain ties at the endpoints' distance", () => {
  const points = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 2 }];
  assert.deepEqual(neighborEdges(points), [[0, 1], [0, 2], [1, 2]]);
});

test("global blockers can remove a local edge without becoming plotted endpoints", () => {
  const points = [{ x: 0, y: 0 }, { x: 4, y: 0 }];
  assert.deepEqual(neighborEdges(points), [[0, 1]]);
  assert.deepEqual(neighborEdges(points, [{ x: 2, y: 1 }]), []);
  assert.deepEqual(neighborEdges(points, [{ x: 2, y: 2 }]), [[0, 1]]);
});

test("global blockers use the datasets of each pair's populations", () => {
  const points = [{ x: 0, y: 0 }, { x: 4, y: 0 }];
  const modern = { x: 2, y: 1, category: "modern" };
  const ancient = { x: 2, y: 1, category: "ancient" };
  assert.deepEqual(neighborEdges(points, [ancient], ["modern", "modern"]), [[0, 1]]);
  assert.deepEqual(neighborEdges(points, [modern], ["ancient", "ancient"]), [[0, 1]]);
  assert.deepEqual(neighborEdges(points, [ancient], ["ancient", "ancient"]), []);
  assert.deepEqual(neighborEdges(points, [modern], ["modern", "ancient"]), []);
  assert.deepEqual(neighborEdges(points, [ancient], ["modern", "ancient"]), []);
  assert.deepEqual(neighborEdges(points, [["modern", "Nearby", 2, 1]],
    ["modern", "modern"]), []);
});

test("midpoint neighbours use every G25 dimension, not just the plotted axes", () => {
  const row = (name, x, third) => ["modern", name, x, 0, third, ...Array(22).fill(0)];
  const a = row("A", 0, 0), b = row("B", 4, 0);
  assert.deepEqual(neighborEdges([a, b], [row("Looks close in 2D", 2, 10)]), [[0, 1]]);
  assert.deepEqual(neighborEdges([a, b], [row("Closer in G25", 2, 1)]), []);
});

test("Bursa and Biga Peninsula remain neighbours against the global modern dataset", () => {
  const browser = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../calculator/references.js"), "utf8"),
    { window: browser });
  const modern = browser.G25_REFERENCES.filter((row) => row[0] === "modern");
  const bursa = modern.find((row) => row[1] === "Turkish_Bursa_(n=6)");
  const biga = modern.find((row) => row[1] === "Turkish_Çanakkale_Biga_Peninsula_(n=3)");
  assert.ok(bursa && biga);
  assert.deepEqual(neighborEdges([bursa, biga], modern, ["modern", "modern"]), [[0, 1]]);
});

test("nearest links are directional and the count controls each source independently", () => {
  const points = [0, 1, 4].map((x) => ["modern", `P${x}`, x, ...Array(24).fill(0)]);
  assert.deepEqual(nearestConnections(points), [
    { from: 0, to: 1 }, { from: 1, to: 0 }, { from: 2, to: 1 },
  ]);
  assert.deepEqual(nearestConnections(points, points, 2).filter((edge) => edge.from === 2), [
    { from: 2, to: 1 }, { from: 2, to: 0 },
  ]);
});

test("global nearest ranks matching datasets and ignores aliases of selected points", () => {
  const row = (kind, name, x) => [kind, name, x, ...Array(24).fill(0)];
  const selected = [row("modern", "A", 0), row("modern", "B", 4)];
  const pool = [...selected, row("modern", "Alias B", 4),
    row("ancient", "Closer but ancient", .5), row("modern", "Outside", 1)];
  assert.deepEqual(nearestConnections(selected, pool, 1, true), [
    { from: 0, to: 4 }, { from: 1, to: 4 },
  ]);
  assert.deepEqual(nearestConnections(selected, pool, 2, true).filter((edge) => edge.from === 0), [
    { from: 0, to: 4 }, { from: 0, to: 1 },
  ]);
  assert.throws(() => nearestConnections(selected, pool, 11), /between 1 and 10/);
});

test("most and least neighbour lists count each visible link once", () => {
  const rows = "ABCDEFG".split("").map((name) => ["modern", name]);
  const ranks = rankNeighborDegrees(rows, [[0, 1], [1, 2], [1, 3], [2, 3], [1, 0]], 5);
  assert.deepEqual(ranks.most.map(({ index, degree }) => [index, degree]),
    [[1, 3], [2, 2], [3, 2], [0, 1], [4, 0]]);
  assert.deepEqual(ranks.least.map(({ index, degree }) => [index, degree]),
    [[4, 0], [5, 0], [6, 0], [0, 1], [2, 2]]);
  assert.equal(rankNeighborDegrees(Array.from({ length: 12 }, (_, index) => ["modern", String(index)]),
    []).most.length, 10);
});

test("input labels connect the dot edge to the label edge in every direction", () => {
  const target = { x: 200, y: 200 }, size = { width: 100, height: 24 };
  const bounds = { left: 0, right: 500, top: 0, bottom: 500 };
  for (const offset of [{ x: 30, y: -12 }, { x: -130, y: -12 },
    { x: -50, y: 40 }, { x: -50, y: -64 }, { x: 60, y: 60 }]) {
    const box = inputLabelLayout(target, offset, size, bounds);
    assert.equal(box.left, target.x + offset.x);
    assert.equal(box.top, target.y + offset.y);
    const { x1, y1, x2, y2 } = box.line;
    assert.ok(Math.abs(Math.hypot(x1 - target.x, y1 - target.y) - 11) < 1e-10);
    assert.ok(x2 >= box.left && x2 <= box.right && y2 >= box.top && y2 <= box.bottom);
    assert.ok(x2 === box.left || x2 === box.right || y2 === box.top || y2 === box.bottom);
    assert.ok(Math.abs((x1 - target.x) * (y2 - target.y) - (y1 - target.y) * (x2 - target.x)) < 1e-9);
  }
});

test("dragged input labels stay inside the plot and hide the line when covering the dot", () => {
  const target = { x: 200, y: 200 }, size = { width: 100, height: 24 };
  const bounds = { left: 62, right: 966, top: 28, bottom: 540 };
  const topLeft = inputLabelLayout(target, { x: -1000, y: -1000 }, size, bounds);
  assert.equal(topLeft.left, 66);
  assert.equal(topLeft.top, 32);
  const bottomRight = inputLabelLayout(target, { x: 1000, y: 1000 }, size, bounds);
  assert.equal(bottomRight.right, 962);
  assert.equal(bottomRight.bottom, 536);
  assert.equal(inputLabelLayout(target, { x: -50, y: -12 }, size, bounds).line, null);
  assert.deepEqual(target, { x: 200, y: 200 });
});
