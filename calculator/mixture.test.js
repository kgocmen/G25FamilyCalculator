const assert = require("node:assert/strict");
const test = require("node:test");
const { estimateStrict, estimateRelaxed, estimateRelaxedByCategory } = require("./mixture.js");

function row(label, values, category = "modern") {
  return { category, label, values };
}

test("strict two-way fit uses exactly 50/50", () => {
  const references = [row("A", Array(25).fill(0)), row("B", Array(25).fill(1))];
  const exact = estimateStrict(row("Target", Array(25).fill(0.5)), references);
  assert.equal(exact.parents.length, 3);
  assert.ok(exact.parents[0].distance < 1e-8);
  assert.deepEqual(exact.parents[0].parts.map((part) => part.id), [0, 1]);
  assert.deepEqual(exact.parents[0].parts.map((part) => part.weight), [0.5, 0.5]);

  const offCenter = estimateStrict(row("Target", Array(25).fill(0.4)), references).parents[0];
  assert.deepEqual(offCenter.parts.map((part) => part.weight), [0.5, 0.5]);
  assert.ok(offCenter.distance > 0);
  assert.equal(exact.grandparents.length, 5);
  assert.deepEqual(exact.grandparents[0].parts.map((part) => part.id), [0, 0, 1, 1]);
});

test("strict fits can reuse one reference in multiple slots", () => {
  const a = row("A", Array(25).fill(0));
  const onlyA = estimateStrict(row("Target", [0.1, ...Array(24).fill(0)]), [a]);
  assert.deepEqual(onlyA.parents[0].parts.map((part) => part.id), [0, 0]);
  assert.deepEqual(onlyA.grandparents[0].parts.map((part) => part.id), [0, 0, 0, 0]);
  assert.ok(onlyA.parents[0].distance > 0);
  assert.ok(onlyA.grandparents[0].distance > 0);

  const references = [a, row("B", [1, ...Array(24).fill(0)]),
    row("C", [0, 1, ...Array(23).fill(0)])];
  const repeated = estimateStrict(row("Target", [0.25, 0.25, ...Array(23).fill(0)]), references);
  assert.ok(repeated.grandparents[0].distance < 1e-8);
  assert.deepEqual(repeated.grandparents[0].parts.map((part) => part.label), ["A", "A", "B", "C"]);
});

test("strict fits exclude every reference identical to the target, preserving other reference IDs", () => {
  const target = row("Target", Array(25).fill(0));
  const references = [
    row("Exact", Array(25).fill(0)),
    row("Positive", [1, ...Array(24).fill(0)]),
    row("Negative", [-1, ...Array(24).fill(0)]),
    row("Close", [1e-9, ...Array(24).fill(0)]),
    row("Exact copy", Array(25).fill(0)),
  ];
  const result = estimateStrict(target, references);
  for (const fit of [...result.parents, ...result.grandparents]) {
    assert.ok(fit.parts.every((part) => part.id !== 0 && part.id !== 4));
  }
  assert.deepEqual(result.parents[0].parts.map((part) => part.id), [1, 2]);
  assert.deepEqual(result.grandparents[0].parts.map((part) => part.id), [1, 1, 2, 2]);
  assert.ok(result.parents.some((fit) => fit.parts.some((part) => part.id === 3)));
  assert.deepEqual(estimateStrict(target, [references[0]]), { parents: [], grandparents: [] });
});

test("strict four-way fit uses exactly 25% per slot", () => {
  const references = Array.from({ length: 4 }, (_, index) => {
    const values = Array(25).fill(0);
    values[index] = 1;
    return row(`G${index + 1}`, values);
  });
  const target = row("Target", [0.25, 0.25, 0.25, 0.25, ...Array(21).fill(0)]);
  const result = estimateStrict(target, references);
  assert.equal(result.grandparents.length, 10);
  assert.ok(result.grandparents[0].distance < 1e-8);
  assert.deepEqual(result.grandparents[0].parts.map((part) => part.id), [0, 1, 2, 3]);
  assert.deepEqual(result.grandparents[0].parts.map((part) => part.weight), [0.25, 0.25, 0.25, 0.25]);
});

test("strict four-way search finds a balanced combination outside the shortlist", () => {
  const decoys = Array.from({ length: 70 }, (_, index) => {
    const values = Array(25).fill(0);
    values[0] = 0.01 + index * 0.00001;
    return row(`Nearby ${index}`, values);
  });
  const balanced = [[1, 0], [0, 1], [-0.7, -0.2], [-0.3, -0.8]].map((coordinates, index) =>
    row(`Balanced ${index}`, [...coordinates, ...Array(23).fill(0)]));
  const progress = [];
  const result = estimateStrict(row("Target", Array(25).fill(0)), [...decoys, ...balanced], null,
    (value) => progress.push(value));
  assert.equal(result.grandparents.length, 10);
  assert.ok(result.grandparents[0].distance < 1e-8);
  assert.deepEqual(result.grandparents[0].parts.map((part) => part.label),
    ["Balanced 0", "Balanced 1", "Balanced 2", "Balanced 3"]);
  for (let index = 1; index < result.grandparents.length; index += 1) {
    assert.ok(result.grandparents[index].distance >= result.grandparents[index - 1].distance - 1e-8);
  }
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), 100);
  assert.ok(progress.some((value) => value > 10 && value < 100));
  assert.ok(progress.every((value, index) => index === 0 || value >= progress[index - 1]));
});

test("strict four-way indexed search matches exhaustive top 10 and top 100 rankings", () => {
  let seed = 42;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const references = Array.from({ length: 65 }, (_, index) =>
    row(`R${index}`, [...Array.from({ length: 5 }, () => random() - 0.5), ...Array(20).fill(0)]));
  const target = row("Target", [0.04, -0.08, 0.02, -0.03, 0.05, ...Array(20).fill(0)]);
  const expected = [];
  for (let a = 0; a < 65; a += 1) {
    for (let b = a; b < 65; b += 1) {
      for (let c = b; c < 65; c += 1) {
        for (let d = c; d < 65; d += 1) {
          let square = 0;
          for (let k = 0; k < 5; k += 1) {
            const average = (references[a].values[k] + references[b].values[k] +
              references[c].values[k] + references[d].values[k]) / 4;
            square += (average - target.values[k]) ** 2;
          }
          if (expected.length < 100 || square < expected[99]) {
            expected.push(square);
            expected.sort((first, second) => first - second);
            expected.length = Math.min(100, expected.length);
          }
        }
      }
    }
  }
  for (const limit of [10, 100]) {
    const result = estimateStrict(target, references, null, null, limit);
    assert.equal(result.parents.length, limit);
    assert.equal(result.grandparents.length, limit);
    const combinations = result.grandparents.map((fit) => fit.parts.map((part) => part.id).join(","));
    assert.equal(new Set(combinations).size, limit);
    result.grandparents.forEach((fit, index) => {
      assert.ok(Math.abs((fit.distance / 100) ** 2 - expected[index]) < 1e-10);
    });
    if (limit === 100) {
      assert.ok(result.grandparents.some((fit) => new Set(fit.parts.map((part) => part.id)).size < 4));
    }
  }
  assert.throws(() => estimateStrict(target, references, null, null, 101), /1 to 100/);
});

test("relaxed two-way fit optimizes freely across modern and ancient references", () => {
  const references = [
    row("Modern", Array(25).fill(0)),
    row("Ancient", Array(25).fill(1), "ancient"),
    row("Far", Array(25).fill(3)),
  ];
  const result = estimateRelaxed(row("Target", Array(25).fill(0.4)), references);
  assert.equal(result[0].distance, 0);
  assert.deepEqual(result[0].parts.map((part) => part.category), ["modern", "ancient"]);
  assert.ok(Math.abs(result[0].parts[0].weight - 0.6) < 1e-8);
  assert.ok(Math.abs(result[0].parts[1].weight - 0.4) < 1e-8);
  assert.equal(estimateRelaxed(row("Target", Array(25).fill(0.4)), references, 1).length, 1);
});

test("relaxed category tables keep modern and ancient pairs separate with optimized shares", () => {
  const references = [
    row("M0", Array(25).fill(0)),
    row("M1", Array(25).fill(1)),
    row("A0", Array(25).fill(-1), "ancient"),
    row("A1", Array(25).fill(2), "ancient"),
  ];
  const { modern, ancient } = estimateRelaxedByCategory(row("Target", Array(25).fill(0.4)), references);
  assert.equal(modern.length, 1);
  assert.equal(ancient.length, 1);
  assert.deepEqual(modern[0].parts.map((part) => part.label), ["M0", "M1"]);
  assert.deepEqual(ancient[0].parts.map((part) => part.label), ["A0", "A1"]);
  for (const fit of [modern[0], ancient[0]]) {
    assert.ok(fit.distance < 1e-8);
    assert.ok(Math.abs(fit.parts.reduce((sum, part) => sum + part.weight, 0) - 1) < 1e-8);
    assert.ok(fit.parts.every((part) => part.weight > 0));
  }
  assert.ok(Math.abs(modern[0].parts[0].weight - 0.6) < 1e-8);
  assert.ok(Math.abs(ancient[0].parts[0].weight - (1.6 / 3)) < 1e-8);
});

test("relaxed search excludes pairs whose best fit has a zero-share partner", () => {
  const references = [row("Exact", Array(25).fill(0)), row("Other", Array(25).fill(1))];
  assert.deepEqual(estimateRelaxed(row("Target", Array(25).fill(0)), references), []);
});

test("fit rankings use unique combinations and increasing distance", () => {
  const references = Array.from({ length: 8 }, (_, index) => row(`R${index}`, Array(25).fill(index / 10)));
  const target = row("Target", Array(25).fill(0.35));
  const strict = estimateStrict(target, references);
  const relaxed = estimateRelaxed(target, references, 20);
  for (const fits of [strict.parents, strict.grandparents, relaxed]) {
    assert.equal(fits.length, fits === relaxed ? 16 : 10);
    for (let index = 0; index < fits.length; index += 1) {
      const fit = fits[index];
      if (fits === relaxed) assert.equal(new Set(fit.parts.map((part) => part.id)).size, fit.parts.length);
      if (index) assert.ok(fit.distance >= fits[index - 1].distance - 1e-8);
    }
    assert.equal(new Set(fits.map((fit) => fit.parts.map((part) => part.id).join(","))).size, fits.length);
  }
});
