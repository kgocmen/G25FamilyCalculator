const assert = require("node:assert/strict");
const test = require("node:test");
const { convexHull, inputLabelLayout } = require("./pca_layout.js");

test("cluster outline excludes interior points", () => {
  const hull = convexHull([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 },
    { x: 0, y: 4 }, { x: 2, y: 2 }]);
  assert.equal(hull.length, 4);
  assert.ok(hull.every((point) => point.x !== 2 || point.y !== 2));
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
