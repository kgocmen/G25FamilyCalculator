const assert = require("node:assert/strict");
const test = require("node:test");
const { ancestorWeights, calculate, calculateComparison, closestMatches, formatLine, parseLine, prepareMatches, rankMatches, resultLabel } = require("./core.js");

function person(label, value) {
  return { label, values: Array(25).fill(value) };
}

for (const count of [2, 4, 8, 16]) {
  test(`${count} ancestors produce the expected offspring and recover one missing ancestor`, () => {
    const ancestors = Array.from({ length: count }, (_, index) => person(`A${index + 1}`, index + 1));
    const expected = (count + 1) / 2;
    const result = calculate(null, ancestors);
    assert.equal(result.kind, "offspring");
    assert.deepEqual(result.values, Array(25).fill(expected));

    const withGap = [...ancestors];
    withGap[count - 1] = null;
    const recovered = calculate(person("Child", expected), withGap);
    assert.equal(recovered.kind, "residual");
    assert.deepEqual(recovered.missing, [count - 1]);
    assert.deepEqual(recovered.inferred, ancestors[count - 1].values);
    assert.deepEqual(recovered.values, Array(25).fill(count / count));

    withGap[0] = null;
    const combined = calculate(person("Child", expected), withGap);
    assert.equal(combined.kind, "residual");
    assert.equal(combined.inferred, null);
    assert.deepEqual(combined.values, Array(25).fill((count + 1) / count));
    assert.equal(resultLabel(person("Child", expected), withGap),
      `Child${withGap.filter(Boolean).map((ancestor) => `-${1 / count}*${ancestor.label}`).join("")}`);
  });
}

test("output labels use ancestor names and residual coefficients", () => {
  const a = person("Pop1", 1);
  const b = person("Pop2", 2);
  assert.equal(resultLabel(null, [a, b]), "Pop1+Pop2");
  assert.equal(resultLabel(person("Child", 0), [a, null]), "Child-0.5*Pop1");
  assert.equal(resultLabel(person("Child", 0), [a, b, null, null]), "Child-0.25*Pop1-0.25*Pop2");
  assert.equal(resultLabel(person("Child", 0), [a, null, null, null, null, null, null, null]), "Child-0.125*Pop1");
  assert.equal(resultLabel(person("Child", 0), [a, ...Array(15).fill(null)]), "Child-0.0625*Pop1");
});

test("male weighting applies only to the two-parent calculation and its inverse", () => {
  const mother = person("Mother", 10);
  const father = person("Father", 20);
  const child = person("Child", 14.9);
  assert.deepEqual(ancestorWeights(2, false), [0.5, 0.5]);
  assert.deepEqual(ancestorWeights(2, true), [0.51, 0.49]);
  assert.deepEqual(ancestorWeights(4, true), Array(4).fill(0.25));
  assert.equal(calculate(null, [mother, father]).values[0], 15);
  assert.ok(Math.abs(calculate(null, [mother, father], true).values[0] - 14.9) < 1e-12);

  const missingMother = calculate(child, [null, father], true);
  const missingFather = calculate(child, [mother, null], true);
  assert.ok(Math.abs(missingMother.inferred[0] - 10) < 1e-12);
  assert.ok(Math.abs(missingFather.inferred[0] - 20) < 1e-12);
  assert.equal(resultLabel(child, [mother, null], true), "Child-0.51*Mother");
  assert.equal(resultLabel(child, [null, father], true), "Child-0.49*Father");

  const motherComparison = calculateComparison(child, [mother, father], 0, true);
  const fatherComparison = calculateComparison(child, [mother, father], 1, true);
  assert.ok(Math.abs(motherComparison.calculated.values[0] - 10) < 1e-12);
  assert.ok(Math.abs(fatherComparison.calculated.values[0] - 20) < 1e-12);
  assert.equal(motherComparison.calculated.label, "(Child-0.49*Father)/0.51");
  assert.equal(fatherComparison.calculated.label, "(Child-0.51*Mother)/0.49");
});

test("a selected ancestor is inferred from offspring and all other ancestors", () => {
  const ancestors = [person("A", 1), person("B", 2), person("C", 3), person("D", 4)];
  const offspring = person("Child", 2.75);
  const childComparison = calculateComparison(offspring, ancestors);
  assert.equal(childComparison.actual.label, "Child");
  assert.equal(childComparison.calculated.label, "A+B+C+D");
  assert.deepEqual(childComparison.calculated.values, Array(25).fill(2.5));

  const ancestorComparison = calculateComparison(offspring, ancestors, 2);
  assert.equal(ancestorComparison.actual.label, "C");
  assert.equal(ancestorComparison.calculated.label, "4*Child-A-B-D");
  assert.deepEqual(ancestorComparison.calculated.values, Array(25).fill(4));
  assert.ok(ancestorComparison.distance > childComparison.distance);
});

test("selected ancestor comparison works with 16 slots", () => {
  const ancestors = Array.from({ length: 16 }, (_, index) => person(`A${index + 1}`, index + 1));
  const comparison = calculateComparison(person("Child", 8.5), ancestors, 15);
  assert.equal(comparison.calculated.label.startsWith("16*Child-A1-A2"), true);
  assert.deepEqual(comparison.calculated.values, Array(25).fill(16));
  assert.equal(comparison.distance, 0);
});

test("pasted rows parse and copy as 25-coordinate G25 rows", () => {
  const line = formatLine('Sample, "A"', Array.from({ length: 25 }, (_, index) => (index - 12) / 100));
  assert.deepEqual(parseLine(line), {
    label: 'Sample, "A"',
    values: Array.from({ length: 25 }, (_, index) => (index - 12) / 100),
  });
  assert.throws(() => parseLine("Sample,0.1,0.2"), /25 numbers/);
  assert.throws(() => parseLine(`Sample,${Array(24).fill("0").join(",")},oops`), /finite number/);
});

test("both closest lists rank reference populations and can include the other offspring", () => {
  const actual = person("Actual", 0);
  const calculated = person("Calculated", 0.01);
  const references = [
    { category: "modern", label: "Near actual", values: Array(25).fill(0.001) },
    { category: "modern", label: "Near calculated", values: Array(25).fill(0.009) },
    { category: "modern", label: "Exact calculated", values: Array(25).fill(0.01) },
  ];
  const lists = closestMatches(actual, calculated, references, 4);
  assert.deepEqual(lists.actual.map((row) => row.label), ["Near actual", "Near calculated", "Calculated", "Exact calculated"]);
  assert.deepEqual(lists.calculated.map((row) => row.label), ["Exact calculated", "Near calculated", "Near actual", "Actual"]);
  assert.equal(lists.actual[0].ac < lists.actual[0].bc, true);
  assert.equal(lists.calculated[0].bc < lists.calculated[0].ac, true);

  assert.equal(lists.smallestDifference[0].label, "Near actual");
  assert.equal(lists.largestDifference[0].label, "Exact calculated");
  assert.equal(lists.smallestRatio[0].label, "Near actual");
  assert.equal(lists.largestRatio[0].label, "Near calculated");
  assert.equal(lists.smallestRatio.some((row) => row.label === "Exact calculated"), false);
  assert.equal(lists.smallestD3[0].label, "Near actual");
  assert.equal(lists.largestD3[0].label, "Exact calculated");
  assert.ok(Math.abs(lists.smallestD3[0].d3 + 0.8) < 1e-12);
  assert.equal(lists.largestD3[0].d3, 1);

  const limited = closestMatches(actual, calculated, references, 2);
  assert.equal(limited.actual.some((row) => row.category === "target"), false);
  assert.equal(limited.calculated.some((row) => row.category === "target"), false);
});

test("D3 excludes a reference when both offspring distances are zero", () => {
  const target = person("Same", 0);
  const rows = [{ category: "modern", label: "Exact", values: Array(25).fill(0) }];
  const lists = closestMatches(target, target, rows);
  assert.deepEqual(lists.smallestD3, []);
  assert.deepEqual(lists.largestD3, []);
});

test("closest lists have no cutoff while metric lists follow the adjustable AC and BC limit", () => {
  const actual = person("Actual", 0);
  const calculated = person("Calculated", 0.03);
  const references = [
    { category: "modern", label: "Near actual only", values: Array(25).fill(0.005) },
    { category: "modern", label: "Near both", values: Array(25).fill(0.015) },
    { category: "modern", label: "Between 10 and 12", values: Array(25).fill(0.023) },
    { category: "modern", label: "Near calculated only", values: Array(25).fill(0.025) },
  ];
  const prepared = prepareMatches(actual, calculated, references);
  assert.ok(Math.abs(prepared.furthestDistance - 12.5) < 1e-12);
  const closestKeys = ["actual", "calculated"];
  const metricKeys = ["smallestDifference", "largestDifference", "smallestRatio", "largestRatio", "smallestD3", "largestD3"];

  const defaultLists = rankMatches(prepared);
  for (const key of closestKeys) {
    assert.deepEqual(new Set(defaultLists[key].map((row) => row.label)),
      new Set([...references.map((row) => row.label), key === "actual" ? "Calculated" : "Actual"]));
    assert.ok(defaultLists[key].some((row) => row.category === "target" && row[key === "actual" ? "ac" : "bc"] > 12));
    assert.ok(defaultLists[key].some((row) => row.ac > 12 || row.bc > 12));
  }
  for (const key of metricKeys) {
    assert.deepEqual(defaultLists[key].map((row) => row.label), ["Near both"]);
  }

  const widerLists = rankMatches(prepared, 10, 12);
  for (const key of closestKeys) {
    assert.deepEqual(widerLists[key], defaultLists[key]);
  }
  for (const key of metricKeys) {
    assert.deepEqual(new Set(widerLists[key].map((row) => row.label)), new Set(["Near both", "Between 10 and 12"]));
  }

  const furthestLists = rankMatches(prepared, 10, prepared.furthestDistance);
  for (const key of metricKeys) {
    assert.deepEqual(new Set(furthestLists[key].map((row) => row.label)), new Set(references.map((row) => row.label)));
  }
});
