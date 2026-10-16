const assert = require("node:assert/strict");
const test = require("node:test");
const { convexHull, pointLabel, layoutLabels } = require("./pca_layout.js");

test("cluster outline excludes interior points", () => {
  const hull = convexHull([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 },
    { x: 0, y: 4 }, { x: 2, y: 2 }]);
  assert.equal(hull.length, 4);
  assert.ok(hull.every((point) => point.x !== 2 || point.y !== 2));
});

test("point labels show sample names and distinguish profile and sample count", () => {
  assert.equal(pointLabel("Rum:Bizans_İznik_(Anadolu_Tunç_Çağı_Profili)_n=1"),
    "Bizans İznik · Anadolu Tunç Çağı · n=1");
});

test("dense point labels remain inside the plot without overlapping", () => {
  const points = Array.from({ length: 36 }, (_, index) => ({
    label: `Türk:Örnek_${index}_n=1`, x: 300 + index % 3 * 4, y: 260 + Math.floor(index / 3) * 3,
  }));
  const bounds = { left: 30, right: 900, top: 20, bottom: 680 };
  const labels = layoutLabels(points, bounds);
  assert.equal(labels.filter(Boolean).length, points.length);
  for (let index = 0; index < labels.length; index += 1) {
    const first = labels[index].box;
    assert.ok(first.x >= bounds.left && first.x + first.width <= bounds.right);
    assert.ok(first.y >= bounds.top && first.y + first.height <= bounds.bottom);
    for (let other = index + 1; other < labels.length; other += 1) {
      const second = labels[other].box;
      const overlapWidth = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
      const overlapHeight = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
      assert.ok(overlapWidth <= 0 || overlapHeight <= 0);
    }
  }
});
