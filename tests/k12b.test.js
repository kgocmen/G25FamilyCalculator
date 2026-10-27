const test = require("node:test");
const assert = require("node:assert/strict");
const { labels, parseProfile, nearest, twoWay, referenceRows } = require("../calculator/k12b.js");

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
