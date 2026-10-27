const assert = require("node:assert/strict");
const test = require("node:test");
const { ancestorWeights, calculate, calculateComparison, closestMatches, estimateChildFromKnown, excludeTargetReferences, formatLine, missingAncestorLabel, nearestMatches, parseLine, prepareMatches, rankMatches, resultLabel } = require("../calculator/core.js");

function person(label, value) {
  return { label, values: Array(25).fill(value) };
}

test("target remainders participate in fitting but their result rows are hidden", () => {
  const { remainingAdmixture, visibleRemainingAdmixture } = require("../calculator/core.js");
  const targets = [person("A", 0), person("B", 1)];
  const references = [person("A", 0), person("B", 1), person("Other", 2)];
  const fits = remainingAdmixture(targets[0], targets[1], references);
  assert.ok(fits.every((fit) => fit.best.label === "A"));
  assert.deepEqual(visibleRemainingAdmixture(fits, references, targets), []);
  assert.ok(fits.every((fit) => fit.best.label === "A"));
  const rows = references.map((row, id) => ({ best: { id, label: row.label } }));
  assert.deepEqual(visibleRemainingAdmixture(rows, references, targets), [rows[2]]);
  const alias = [{ best: { id: 0, label: "Alias A" } }];
  assert.deepEqual(visibleRemainingAdmixture(alias, references, targets), []);
});

test("remaining rows exceeding the direct A-B distance are hidden in both directions", () => {
  const { distance, visibleRemainingAdmixture } = require("../calculator/core.js");
  const targets = [person("A", 0), person("B", 1)];
  const references = [person("Other", 2)];
  const between = distance(targets[0].values, targets[1].values);
  const rows = [between - 1, between, between + 1].map((distance) => ({
    best: { id: 0, label: "Other", distance },
  }));
  for (const pair of [targets, [...targets].reverse()]) {
    assert.deepEqual(visibleRemainingAdmixture(rows, references, pair), rows.slice(0, 2));
  }
  assert.equal(rows.length, 3);
});

test("remaining admixture supports each step and marks the best row within each group", () => {
  const { remainingAdmixture, summarizeRemainingAdmixture } = require("../calculator/core.js");
  const target = person("A", 0.17);
  const source = person("B", 1);
  const references = [person("Zero", 0)];
  for (const step of [1, 5, 10]) {
    const fits = remainingAdmixture(target, source, references, step);
    assert.deepEqual(fits.map((fit) => fit.percent), Array.from({ length: 100 / step - 1 }, (_, i) => (i + 1) * step));
    const summary = summarizeRemainingAdmixture(fits, target, source, references);
    assert.deepEqual(summary.filter((fit) => fit.isGroupBest).map((fit) => fit.percent), [17]);
  }
  const range = remainingAdmixture(target, source, references, 10).slice(0, 2);
  const summary = summarizeRemainingAdmixture(range, target, source, references);
  assert.deepEqual(summary.map((fit) => [fit.percent, fit.isGroupBest]), [[10, false], [17, true], [20, false]]);
  const endpoint = person("A", 0);
  const endpointFits = remainingAdmixture(endpoint, source, references, 10);
  assert.deepEqual(summarizeRemainingAdmixture(endpointFits, endpoint, source, references)
    .filter((fit) => fit.isGroupBest).map((fit) => fit.percent), [10]);
  assert.throws(() => remainingAdmixture(target, source, references, 0), /percentage step/);
});

test("remaining admixture summary searches whole percentages within each population run", () => {
  const { remainingAdmixture, summarizeRemainingAdmixture } = require("../calculator/core.js");
  const source = person("B", 1);
  const references = [{ ...person("Zero", 0), category: "modern" }];
  const summarize = (target) => summarizeRemainingAdmixture(
    remainingAdmixture(target, source, references), target, source, references);
  const fits = summarize(person("A", 0.37));
  assert.deepEqual(fits.map((fit) => fit.percent), [5, 37, 95]);
  assert.equal(fits[1].remainingPercent, 63);
  assert.equal(fits[1].best.distance, 0);
  const target47 = person("A", 0.47);
  const range = remainingAdmixture(target47, source, references)
    .filter((fit) => fit.percent >= 30 && fit.percent <= 80);
  const summary = summarizeRemainingAdmixture(range, target47, source, references);
  assert.deepEqual(summary.map((fit) => fit.percent), [30, 47, 80]);
  assert.equal(summary[1].best.distance, 0);
  assert.ok(summary[1].best.distance < range.find((fit) => fit.percent === 45).best.distance);
  assert.ok(summary[1].best.distance < range.find((fit) => fit.percent === 50).best.distance);
  assert.deepEqual(summarize(person("A", 0)).map((fit) => fit.percent), [5, 95]);
  assert.deepEqual(summarize(person("A", 1)).map((fit) => fit.percent), [5, 95]);
  const flat = person("Flat", 0);
  const tied = remainingAdmixture(flat, flat, references);
  assert.deepEqual(summarizeRemainingAdmixture(tied, flat, flat, references).map((fit) => fit.percent), [5, 95]);
  assert.deepEqual(summarizeRemainingAdmixture([]), []);
  const empty = [{ percent: 5, best: null }, { percent: 10, best: null }, { percent: 15, best: null }];
  assert.deepEqual(summarizeRemainingAdmixture(empty), [empty[0], empty[2]].map((fit) => ({ ...fit, isGroupBest: false })));

  // Search only inside each consecutive run, even when a population returns later.
  const runs = [tied[0], tied[1], { ...tied[2], best: { ...tied[2].best, id: 1 } }, tied[3], tied[4]];
  const result = summarizeRemainingAdmixture(runs, flat, flat, [...references, references[0]]);
  assert.deepEqual(result.map((fit) => fit.percent), [5, 10, 15, 20, 25]);
});

test("remaining admixture finds the best single population at every fixed percentage", () => {
  const { remainingAdmixture, distance } = require("../calculator/core.js");
  const target = person("A", 0.01);
  const source = person("B", 0.02);
  const references = [
    ["modern", "Zero", ...Array(25).fill(0)],
    ["ancient", "Negative", ...Array(25).fill(-0.02)],
    ["modern", "Near", ...Array(25).fill(0.009)],
  ];
  const fits = remainingAdmixture(target, source, references);
  assert.deepEqual(fits.map((fit) => fit.percent), Array.from({ length: 19 }, (_, i) => (i + 1) * 5));
  assert.equal(fits[9].best.label, "Zero");
  assert.equal(fits[9].best.distance, 0);
  assert.equal(fits[14].best.label, "Negative");
  assert.ok(fits[14].best.distance < 1e-12);
  for (const fit of fits) {
    assert.equal(fit.remainingPercent, 100 - fit.percent);
    const distances = references.map((row) => distance(target.values,
      source.values.map((value, i) => value * fit.percent / 100 + row[i + 2] * fit.remainingPercent / 100)));
    assert.ok(Math.abs(fit.best.distance - Math.min(...distances)) < 1e-12);
  }
  const reverse = remainingAdmixture(source, target, references);
  assert.ok(reverse[9].best.distance > 0);
});

test("remaining admixture handles empty references, ties, objects and invalid coordinates", () => {
  const { remainingAdmixture } = require("../calculator/core.js");
  const target = person("A", 0);
  assert.ok(remainingAdmixture(target, target, []).every((fit) => fit.best === null));
  const references = ["First", "Second"].map((label) => ({ ...person(label, 0), category: "modern" }));
  assert.ok(remainingAdmixture(target, target, references).every((fit) => fit.best.label === "First" && fit.best.distance === 0));
  assert.throws(() => remainingAdmixture(null, target, references), /valid G25/);
  assert.throws(() => remainingAdmixture(target, target, [{ values: [0] }]), /Invalid G25/);
});

test("partial child estimates normalize known contributors and rank their closest references", () => {
  assert.equal(estimateChildFromKnown([null, null]), null);
  const parents = [person("Mother", 10), null];
  const partial = estimateChildFromKnown(parents, true);
  assert.equal(partial.knownCount, 1);
  assert.equal(partial.knownWeight, 0.51);
  assert.ok(partial.values.every((value) => Math.abs(value - 10) < 1e-12));
  const references = [["modern", "Near", ...Array(25).fill(10)], ["modern", "Far", ...Array(25).fill(20)]];
  assert.equal(nearestMatches({ label: "child", values: partial.values }, references, 10)[0].label, "Near");

  const grandparents = [person("M1", 10), null, person("P1", 30), null];
  const weighted = estimateChildFromKnown(grandparents, true);
  assert.equal(weighted.knownCount, 2);
  assert.equal(weighted.knownWeight, 0.5);
  assert.ok(weighted.values.every((value) => Math.abs(value - 19.8) < 1e-12));
  assert.deepEqual(estimateChildFromKnown([person("A", 10), person("B", 20)]).values,
    calculate(null, [person("A", 10), person("B", 20)]).values);
});

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
    assert.equal(missingAncestorLabel(person("Child", expected), withGap),
      `${count}*Child${ancestors.slice(0, -1).map((ancestor) => `-${ancestor.label}`).join("")}`);

    withGap[0] = null;
    const combined = calculate(person("Child", expected), withGap);
    assert.equal(combined.kind, "residual");
    assert.equal(combined.inferred, null);
    assert.deepEqual(combined.values, Array(25).fill((count + 1) / count));
    assert.deepEqual(combined.combined, Array(25).fill((count + 1) / 2));
    assert.equal(resultLabel(person("Child", expected), withGap),
      count === 2 ? "Child"
        : `(Child${withGap.filter(Boolean).map((ancestor) => `-${1 / count}*${ancestor.label}`).join("")})/${2 / count}`);
  });
}

test("identical offspring and known ancestors infer the same missing G25 row", () => {
  const sample = {
    label: "X",
    values: Array.from({ length: 25 }, (_, index) => Number(((index - 12) * 0.004321).toFixed(6))),
  };
  for (const count of [2, 4, 8, 16]) {
    for (const male of count <= 4 ? [false, true] : [false]) {
      for (let missingIndex = 0; missingIndex < count; missingIndex += 1) {
        const ancestors = Array(count).fill(sample);
        ancestors[missingIndex] = null;
        const inferred = calculate(sample, ancestors, male).inferred;
        inferred.forEach((value, index) => {
          assert.ok(Math.abs(value - sample.values[index]) < 1e-12,
            `${count} ancestors, male=${male}, missing=${missingIndex}, coordinate=${index}`);
        });
        const copied = formatLine(missingAncestorLabel(sample, ancestors, male), inferred);
        assert.deepEqual(parseLine(copied).values, sample.values);
      }
    }
  }
});

test("output labels show the normalized multi-ancestor calculation", () => {
  const a = person("Pop1", 1);
  const b = person("Pop2", 2);
  assert.equal(resultLabel(null, [a, b]), "Pop1+Pop2");
  assert.equal(resultLabel(person("Child", 0), [a, null]), "Child-0.5*Pop1");
  assert.equal(resultLabel(person("Child", 0), [a, b, null, null]), "(Child-0.25*Pop1-0.25*Pop2)/0.5");
  assert.equal(resultLabel(person("Child", 0), [a, null, null, null]), "(Child-0.25*Pop1)/0.75");
  assert.equal(resultLabel(person("Child", 0), [a, null, null, null, null, null, null, null]), "(Child-0.125*Pop1)/0.875");
  assert.equal(resultLabel(person("Child", 0), [a, ...Array(15).fill(null)]), "(Child-0.0625*Pop1)/0.9375");
  assert.equal(resultLabel(person("Child", 0), [null, null, null, null]), "Child");
});

test("three missing grandparents produce full normalized coordinates", () => {
  const child = person("Child", 25);
  const result = calculate(child, [person("Known", 10), null, null, null]);
  assert.deepEqual(result.values, Array(25).fill(22.5));
  assert.deepEqual(result.combined, Array(25).fill(30));
  assert.equal(resultLabel(child, [person("Known", 10), null, null, null]), "(Child-0.25*Known)/0.75");
  assert.deepEqual(calculate(child, Array(4).fill(null)).combined, child.values);
});

test("male weighting applies to the two-parent calculation and its inverse", () => {
  const mother = person("Mother", 10);
  const father = person("Father", 20);
  const child = person("Child", 14.9);
  assert.deepEqual(ancestorWeights(2, false), [0.5, 0.5]);
  assert.deepEqual(ancestorWeights(2, true), [0.51, 0.49]);
  assert.equal(calculate(null, [mother, father]).values[0], 15);
  assert.ok(Math.abs(calculate(null, [mother, father], true).values[0] - 14.9) < 1e-12);

  const missingMother = calculate(child, [null, father], true);
  const missingFather = calculate(child, [mother, null], true);
  assert.ok(Math.abs(missingMother.inferred[0] - 10) < 1e-12);
  assert.ok(Math.abs(missingFather.inferred[0] - 20) < 1e-12);
  assert.equal(resultLabel(child, [mother, null], true), "Child-0.51*Mother");
  assert.equal(resultLabel(child, [null, father], true), "Child-0.49*Father");
  assert.equal(missingAncestorLabel(child, [mother, null], true), "(Child-0.51*Mother)/0.49");

  const motherComparison = calculateComparison(child, [mother, father], 0, true);
  const fatherComparison = calculateComparison(child, [mother, father], 1, true);
  assert.ok(Math.abs(motherComparison.calculated.values[0] - 10) < 1e-12);
  assert.ok(Math.abs(fatherComparison.calculated.values[0] - 20) < 1e-12);
  assert.equal(motherComparison.calculated.label, "(Child-0.49*Father)/0.51");
  assert.equal(fatherComparison.calculated.label, "(Child-0.51*Mother)/0.49");
});

test("male weighting gives maternal grandparents 25.5% and paternal grandparents 24.5%", () => {
  const ancestors = [person("MG1", 10), person("MG2", 20), person("PG1", 30), person("PG2", 40)];
  const child = person("Child", 24.8);
  assert.deepEqual(ancestorWeights(4, false), [0.25, 0.25, 0.25, 0.25]);
  assert.deepEqual(ancestorWeights(4, true), [0.255, 0.255, 0.245, 0.245]);
  assert.deepEqual(ancestorWeights(8, true), Array(8).fill(0.125));
  assert.ok(Math.abs(calculate(null, ancestors, true).values[0] - 24.8) < 1e-12);
  assert.equal(calculate(null, ancestors).values[0], 25);

  for (const index of [0, 1, 2, 3]) {
    const withGap = [...ancestors];
    withGap[index] = null;
    const inferred = calculate(child, withGap, true);
    assert.ok(Math.abs(inferred.inferred[0] - ancestors[index].values[0]) < 1e-12);
    assert.ok(Math.abs(inferred.values[0] - ancestorWeights(4, true)[index] * ancestors[index].values[0]) < 1e-12);
    const comparison = calculateComparison(child, ancestors, index, true);
    assert.ok(Math.abs(comparison.calculated.values[0] - ancestors[index].values[0]) < 1e-12);
    assert.equal(comparison.calculated.label,
      `(${resultLabel(child, withGap, true)})/${ancestorWeights(4, true)[index]}`);
    assert.equal(missingAncestorLabel(child, withGap, true), comparison.calculated.label);
  }

  const twoMissing = calculate(child, [ancestors[0], null, null, ancestors[3]], true);
  assert.equal(twoMissing.inferred, null);
  assert.ok(Math.abs(twoMissing.values[0] - (0.255 * 20 + 0.245 * 30)) < 1e-12);
  assert.ok(Math.abs(twoMissing.combined[0] - (0.255 * 20 + 0.245 * 30) / 0.5) < 1e-12);
  assert.equal(resultLabel(child, [ancestors[0], null, null, ancestors[3]], true),
    "(Child-0.255*MG1-0.245*PG2)/0.5");
  const threeMissing = calculate(child, [ancestors[0], null, null, null], true);
  assert.ok(Math.abs(threeMissing.combined[0] - (24.8 - 0.255 * 10) / 0.745) < 1e-12);
  assert.equal(resultLabel(child, [ancestors[0], null, null, null], true),
    "(Child-0.255*MG1)/0.745");
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

test("selected ancestor comparison works with 8 slots", () => {
  const ancestors = Array.from({ length: 8 }, (_, index) => person(`A${index + 1}`, index + 1));
  const comparison = calculateComparison(person("Child", 4.5), ancestors, 7);
  assert.equal(comparison.calculated.label.startsWith("8*Child-A1-A2"), true);
  assert.deepEqual(comparison.calculated.values, Array(25).fill(8));
  assert.equal(comparison.distance, 0);
});

test("cached 16 ancestor pages remain compatible during the transition", () => {
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

test("one input ranks references by Euclidean distance without a cutoff", () => {
  const target = person("Sample", 0);
  const references = [
    { category: "modern", label: "Far", values: Array(25).fill(0.03) },
    ["ancient", "Exact", ...Array(25).fill(0)],
    { category: "modern", label: "Near", values: Array(25).fill(0.001) },
  ];
  const matches = nearestMatches(target, references, 2);
  assert.deepEqual(matches.map((row) => row.label), ["Exact", "Near"]);
  assert.equal(matches[0].distance, 0);
  assert.ok(Math.abs(matches[1].distance - 0.5) < 1e-12);
  assert.deepEqual(nearestMatches(target, references).map((row) => row.label), ["Exact", "Near", "Far"]);
});

test("closest lists omit entered population references but keep the other target once", () => {
  const actual = { ...person("Turkish_Adana_(n=28)", 0), category: "modern" };
  const calculated = { ...person("Turkish_Hatay_(n=13)", 0.001728), category: "modern" };
  const references = [
    { ...person(actual.label, 0), category: "modern" },
    { ...person(calculated.label, 0.001728), category: "modern" },
    { ...person("Alias of Adana", 0), category: "modern" },
    { ...person(actual.label, 0.2), category: "ancient" },
    ...Array.from({ length: 8 }, (_, index) =>
      ({ ...person(`Neighbor ${index + 1}`, (index + 1) * 0.0002), category: "modern" })),
  ];
  assert.deepEqual(excludeTargetReferences(references, [actual]).map((row) => row.label).slice(0, 2),
    [calculated.label, actual.label]);
  const lists = rankMatches(prepareMatches(actual, calculated, references), 10, 10, 10, true);
  for (const [key, other] of [["actual", calculated.label], ["calculated", actual.label]]) {
    assert.equal(lists[key].length, 10);
    assert.equal(lists[key].filter((row) => row.category === "target" && row.label === other).length, 1);
    assert.equal(lists[key].some((row) => row.category === "modern" &&
      [actual.label, calculated.label, "Alias of Adana"].includes(row.label)), false);
  }
  assert.equal(lists.actual.find((row) => row.label === calculated.label).ac.toFixed(3), "0.864");
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

test("closest lists can show 100 while difference, ratio, and D3 stay at 10", () => {
  const actual = person("Actual", 0);
  const calculated = person("Calculated", 0.02);
  const references = Array.from({ length: 120 }, (_, index) => ({
    category: "modern",
    label: `R${index}`,
    values: Array(25).fill(index * 0.0001),
  }));
  assert.equal(nearestMatches(actual, references, 100).length, 100);
  const prepared = prepareMatches(actual, calculated, references);
  const ranked = rankMatches(prepared, 10, 100, 100);
  assert.equal(ranked.actual.length, 100);
  assert.equal(ranked.calculated.length, 100);
  for (const key of ["smallestDifference", "largestDifference", "smallestRatio", "largestRatio", "smallestD3", "largestD3"]) {
    assert.equal(ranked[key].length, 10);
  }
  const filtered = rankMatches(prepared, 10, 0, 100);
  assert.equal(filtered.actual.length, 100);
  assert.equal(filtered.calculated.length, 100);
  assert.deepEqual(filtered.smallestDifference, []);
});
