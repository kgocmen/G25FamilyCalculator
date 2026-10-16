const assert = require("node:assert/strict");
const test = require("node:test");
const { convexHull } = require("./pca_layout.js");

test("cluster outline excludes interior points", () => {
  const hull = convexHull([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 },
    { x: 0, y: 4 }, { x: 2, y: 2 }]);
  assert.equal(hull.length, 4);
  assert.ok(hull.every((point) => point.x !== 2 || point.y !== 2));
});
