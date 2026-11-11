const test = require("node:test");
const assert = require("node:assert/strict");
const { labels, distanceColor, parseProfile, nearest, twoWay, twoWayCross,
  referenceRows } = require("../calculator/k12b.js");

test("parses GEDmatch-style labeled lines in any order and normalizes rounding", () => {
  const input = labels.map((label, i) => `${i + 1} ${label} ${i === 0 ? "50.1" : i === 1 ? "49.8" : "0"}%`).reverse().join("\n");
  const result = parseProfile(input);
  assert.equal(result.length, 12);
  assert.ok(Math.abs(result.reduce((a, b) => a + b, 0) - 100) < 1e-9);
  assert.ok(result[0] > result[1]);
});

test("parses named CSV row and rejects incomplete or invalid profiles", () => {
  const row = `My sample_K12b,${[25, 75, ...Array(10).fill(0)].join(",")}`;
  assert.deepEqual(parseProfile(row).slice(0, 2), [25, 75]);
  assert.throws(() => parseProfile("Gedrosia 12"), /all twelve/);
  assert.throws(() => parseProfile(`Sample,${[100, -1, ...Array(10).fill(0)].join(",")}`), /twelve|nonnegative/);
  assert.throws(() => parseProfile(Array(12).fill(0).join(",")), /above zero/);
});

test("nearest and two-way comparisons use twelve-component Euclidean fits", () => {
  const target = [50, 50, ...Array(10).fill(0)];
  const rows = [["A", 100, 0, ...Array(10).fill(0)], ["B", 0, 100, ...Array(10).fill(0)], ["C", 60, 40, ...Array(10).fill(0)]];
  assert.equal(nearest(target, rows, 1)[0].name, "C");
  const fit = twoWay(target, rows, 1)[0];
  assert.ok(fit.distance < 1e-8);
  assert.ok(fit.weight >= 0 && fit.weight <= 1);
});

test("K12b Oracle only shows two-way fits strictly below four", () => {
  const target = Array(12).fill(0);
  const row = (name, first, second) => [name, first, second, ...Array(10).fill(0)];
  assert.equal(twoWay(target, [row("At_four", 4, 0), row("At_four_other", 4, 1)]).length, 0);
  assert.equal(twoWay(target, [row("Above_four", 5, 0), row("Above_four_other", 5, 1)]).length, 0);
  assert.equal(twoWay(target, [row("Below_four", 3.9, 0), row("Below_four_other", 3.9, 1)]).length, 1);
  assert.equal(nearest(target, [row("At_four", 4, 0)]).length, 1);
});

test("All Oracle can show a genuine modern and ancient pair", () => {
  const modern = [["Modern", 100, 0, ...Array(10).fill(0)]];
  const ancient = [["Ancient", 0, 100, ...Array(10).fill(0)]];
  const mixed = twoWayCross([50, 50, ...Array(10).fill(0)], modern, ancient);
  assert.equal(mixed.length, 1);
  assert.equal(mixed[0].name, "Modern");
  assert.equal(mixed[0].other, "Ancient");
  assert.equal(mixed[0].weight, 0.5);
  assert.ok(mixed[0].distance < 1e-8);
  assert.equal(twoWayCross(modern[0].slice(1), modern, ancient).length, 0,
    "an endpoint with 0% ancient ancestry is not a mixed pair");
});

test("K12b distance colors match the source site's threshold palette", () => {
  assert.equal(distanceColor(0.2), "#2E7D5C");
  assert.equal(distanceColor(3.8), "#4EB456");
  assert.equal(distanceColor(4.1), "#75B64D");
  assert.equal(distanceColor(4.1001), "#9CB945");
  assert.equal(distanceColor(5.0), "#EABE34");
  assert.equal(distanceColor(7.4), "#FB8C00");
  assert.equal(distanceColor(11.4), "#E4223A");
  assert.equal(distanceColor(26), "#303FB7");
});

test("ancient category includes source averages and individual samples", () => {
  const ancient = referenceRows("yakinlik1", "ancient");
  const modern = referenceRows("yakinlik1", "modern");
  const all = referenceRows("yakinlik1", "all");
  assert.equal(ancient.length, 150);
  assert.equal(modern.length, 521);
  assert.equal(all.length, ancient.length + modern.length);
  assert.equal(ancient[0][0], "Orta_Çağ_Türk_Ortalaması");
  assert.ok(ancient.some((row) => row[0] === "Kilis_Orta_Çağ_Türk_MS_950-1050_%10"));
  assert.ok(!modern.some((row) => row[0] === "Kilis_Orta_Çağ_Türk_MS_950-1050_%10"));
  assert.equal(referenceRows("yakinlik2tr", "ancient").length, 150);
  assert.equal(referenceRows("yakinlik2tr", "modern").length, 650);
  assert.equal(referenceRows("ikili1", "ancient").length, 150);
  assert.equal(referenceRows("ikili2tr", "ancient").length, 0);
});
