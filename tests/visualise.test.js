const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { fitAncestry, closestContributorReferences } = require("../calculator/visualise.js");
const { nearestMatches } = require("../calculator/core.js");
const { projectPca } = require("../calculator/pca.js");

const reference = (index) => ["modern", `Shared_Group:Population_${index}`,
  ...Array.from({ length: 25 }, (_, coordinate) => coordinate === index ? 1 : 0)];
const references = Array.from({ length: 6 }, (_, index) => reference(index));
const target = { values: Array.from({ length: 25 }, (_, index) => index < 6 ? 1 / 6 : 0) };

test("Unlimited fits more than five populations, including more than four from one prefix", () => {
  const fit = fitAncestry(target, references, null);
  assert.equal(fit.components.length, 6);
  assert.ok(fit.distance < 1e-6);
  assert.ok(fit.components.every((part) => Math.abs(part.weight - 1 / 6) < 1e-6));
  assert.ok(fit.components.every((part) => part.label === part.ethnicity));
  assert.deepEqual(closestContributorReferences(fit, references, nearestMatches), []);
});

test("plots ten nearby non-contributors for each of at most five fitted populations", () => {
  const row = (label, coordinate) => ["modern", label, coordinate, ...Array(24).fill(0)];
  const pool = [row("Source_A", 0), row("Source_B", 10),
    ...Array.from({ length: 12 }, (_, index) => row(`Near_A_${index}`, (index + 1) / 100)),
    ...Array.from({ length: 12 }, (_, index) => row(`Near_B_${index}`, 10 - (index + 1) / 100))];
  const fit = { components: [
    { label: "Source_A", referenceIndex: 0 },
    { label: "Source_B", referenceIndex: 1 },
  ] };
  const neighbors = closestContributorReferences(fit, pool, nearestMatches);
  assert.equal(neighbors.length, 20);
  assert.deepEqual(neighbors.slice(0, 10).map(({ row }) => row[1]),
    Array.from({ length: 10 }, (_, index) => `Near_A_${index}`));
  assert.deepEqual(neighbors.slice(10).map(({ row }) => row[1]),
    Array.from({ length: 10 }, (_, index) => `Near_B_${index}`));
  assert.ok(neighbors.slice(0, 10).every(({ contributorLabel }) => contributorLabel === "Source_A"));
  assert.ok(neighbors.slice(10).every(({ contributorLabel }) => contributorLabel === "Source_B"));
});

test("closest reference count can range from five to one hundred per contributor", () => {
  const row = (label, coordinate) => ["modern", label, coordinate, ...Array(24).fill(0)];
  const pool = [row("Source_A", 0), row("Source_B", 10),
    ...Array.from({ length: 100 }, (_, index) => row(`Near_A_${index}`, (index + 1) / 1000)),
    ...Array.from({ length: 100 }, (_, index) => row(`Near_B_${index}`, 10 - (index + 1) / 1000))];
  const fit = { components: [
    { label: "Source_A", referenceIndex: 0 },
    { label: "Source_B", referenceIndex: 1 },
  ] };
  const five = closestContributorReferences(fit, pool, nearestMatches, 5);
  const hundred = closestContributorReferences(fit, pool, nearestMatches, 100);
  assert.equal(five.length, 10);
  assert.equal(hundred.length, 200);
  assert.ok(five.every(({ row }) => !row[1].startsWith("Source_")));
  assert.ok(hundred.slice(0, 100).every(({ contributorLabel }) => contributorLabel === "Source_A"));
  assert.ok(hundred.slice(100).every(({ contributorLabel }) => contributorLabel === "Source_B"));
});

test("overlapping nearby references belong to one closest contributor until its quota fills", () => {
  const row = (label, coordinate) => ["modern", label, coordinate, ...Array(24).fill(0)];
  const pool = [row("Source_A", 0), row("Source_Z", 0.0041),
    ...Array.from({ length: 10 }, (_, index) => row(`Shared_${index + 1}`, (index + 1) / 1000))];
  const fit = { components: [
    { label: "Source_A", referenceIndex: 0 },
    { label: "Source_Z", referenceIndex: 1 },
  ] };
  const neighbors = closestContributorReferences(fit, pool, nearestMatches, 5);
  assert.equal(neighbors.length, 10);
  assert.equal(new Set(neighbors.map(({ row }) => row[1])).size, 10);
  assert.equal(neighbors.filter(({ contributorLabel }) => contributorLabel === "Source_A").length, 5);
  assert.equal(neighbors.filter(({ contributorLabel }) => contributorLabel === "Source_Z").length, 5);
  assert.equal(neighbors.find(({ row }) => row[1] === "Shared_4").contributorLabel, "Source_Z");
  assert.equal(neighbors.find(({ row }) => row[1] === "Shared_1").contributorLabel, "Source_A");
});

test("the next closest points change colour only after a contributor reaches its limit", () => {
  const row = (label, coordinate) => ["modern", label, coordinate, ...Array(24).fill(0)];
  const pool = [row("Source_A", 0), row("Source_B", 1),
    ...Array.from({ length: 10 }, (_, index) => row(`Near_${index + 1}`, (index + 1) / 100))];
  const fit = { components: [
    { label: "Source_A", referenceIndex: 0 },
    { label: "Source_B", referenceIndex: 1 },
  ] };
  const neighbors = closestContributorReferences(fit, pool, nearestMatches, 5);
  assert.deepEqual(neighbors.slice(0, 5).map(({ row }) => row[1]),
    ["Near_1", "Near_2", "Near_3", "Near_4", "Near_5"]);
  assert.deepEqual(neighbors.slice(5).map(({ row }) => row[1]),
    ["Near_10", "Near_9", "Near_8", "Near_7", "Near_6"]);
  assert.ok(neighbors.slice(0, 5).every(({ contributorLabel }) => contributorLabel === "Source_A"));
  assert.ok(neighbors.slice(5).every(({ contributorLabel }) => contributorLabel === "Source_B"));
  assert.equal(neighbors[0].contributorDistance, 1);
  assert.equal(neighbors[5].contributorDistance, 90);
});

test("2/3/4/5 source limits refit and normalize the complete reported mixture", () => {
  for (const limit of [2, 3, 4, 5]) {
    const fit = fitAncestry(target, references, limit);
    assert.equal(fit.components.length, limit);
    assert.ok(Math.abs(fit.components.reduce((sum, part) => sum + part.weight, 0) - 1) < 1e-12);
    assert.ok(Math.abs(fit.distance - Math.sqrt(1 / limit - 1 / 6) * 100) < 1e-5);
    const residual = target.values.map((value, coordinate) => value - fit.components.reduce((sum, part) =>
      sum + part.weight * references[part.referenceIndex][coordinate + 2], 0));
    assert.ok(Math.abs(fit.distance - Math.hypot(...residual) * 100) < 1e-9);
    assert.equal(fit.values.length, 25);
    assert.ok(fit.values.every((value, coordinate) => Math.abs(value - (target.values[coordinate] - residual[coordinate])) < 1e-12));
  }
});

test("locked populations stay in unrestricted and capped fits with reoptimized weights", () => {
  const input = { values: Array.from({ length: 25 }, (_, index) => index < 5 ? 0.2 : 0) };
  for (const [limit, locked] of [[null, [5]], [2, [5]], [2, [4, 5]],
    [3, [5]], [4, [4, 5]], [5, [2, 3, 4, 5]]]) {
    const fit = fitAncestry(input, references, limit, locked);
    assert.ok(limit === null || fit.components.length <= limit);
    assert.ok(locked.every((index) => fit.components.some((part) =>
      part.referenceIndex === index && part.weight >= 0.001 - 1e-12)));
    assert.ok(Math.abs(fit.components.reduce((sum, part) => sum + part.weight, 0) - 1) < 1e-12);
    const residual = input.values.map((value, coordinate) => value - fit.components.reduce((sum, part) =>
      sum + part.weight * references[part.referenceIndex][coordinate + 2], 0));
    assert.ok(Math.abs(fit.distance - Math.hypot(...residual) * 100) < 1e-9);
  }
  assert.throws(() => fitAncestry(input, references, 3, [0, 1, 2, 3]), /Unlock 1 population/);
  assert.throws(() => fitAncestry(input, references, 2, [0, 1, 2]), /Unlock 1 population/);
  assert.throws(() => fitAncestry(input, references, 3, [99]), /locked population is unavailable/);
});

test("a locked population can receive more than its reserved minimum share", () => {
  const input = { values: [0.7, 0.3, ...Array(23).fill(0)] };
  const fit = fitAncestry(input, references, 3, [0]);
  assert.ok(fit.distance < 1e-8);
  assert.ok(Math.abs(fit.components.find((part) => part.referenceIndex === 0).weight - 0.7) < 1e-8);
  assert.ok(Math.abs(fit.components.find((part) => part.referenceIndex === 1).weight - 0.3) < 1e-8);
});

test("large-pool capped search retains locks", () => {
  const pool = Array.from({ length: 260 }, (_, index) => ["modern", `R${index}`,
    index / 260, Math.sin(index) * 0.01, ...Array(23).fill(0)]);
  const input = { values: [0.37, 0.004, ...Array(23).fill(0)] };
  const fit = fitAncestry(input, pool, 3, [259]);
  assert.ok(fit.components.length <= 3);
  assert.ok(fit.components.some((part) => part.referenceIndex === 259 && part.weight >= 0.001));
  assert.ok(fit.distance < 1e-8);
});

test("searches the complete dataset and returns original reference indices", () => {
  const pool = Array.from({ length: 5000 }, (_, index) => ["ancient", `Sample_${index}`, index / 5000, ...Array(24).fill(0)]);
  const fit = fitAncestry({ values: pool[4999].slice(2) }, pool, null);
  assert.equal(fit.distance, 0);
  assert.equal(fit.components.length, 1);
  assert.equal(fit.components[0].referenceIndex, 4999);
});

test("invalid inputs fail with useful messages", () => {
  assert.throws(() => fitAncestry(target, [], null), /unavailable/);
  assert.throws(() => fitAncestry({ values: [1] }, references, null), /25 finite/);
  assert.throws(() => fitAncestry(target, references, 1), /Unlimited, 2, 3, 4 or 5/);
  assert.throws(() => fitAncestry(target, [references[0], ["modern", "Invalid", NaN]], null), /invalid G25/);
});

test("worker serializes the solver and produces unrestricted and capped fits", () => {
  const app = fs.readFileSync(path.join(__dirname, "../calculator/app.js"), "utf8");
  const start = app.indexOf("  function visualiseWorkerMain() {");
  const end = app.indexOf("  function toggleVisualiseLock(row) {", start);
  const modules = ["visualise.js"].map((file) =>
    fs.readFileSync(path.join(__dirname, "../calculator", file), "utf8")).join("\n");
  let result;
  const self = { postMessage(message) { result = message; } };
  vm.runInNewContext(`${modules}\n(${app.slice(start, end).trim()})()`, { self, globalThis: self });
  for (const limit of [null, 2, 3, 4, 5]) {
    self.onmessage({ data: { target, references, limit, requestId: 7 } });
    assert.equal(result.error, undefined);
    assert.equal(result.requestId, 7);
    assert.equal(result.fit.components.length, limit || 6);
    assert.equal(result.fit.values.length, 25);
  }
  self.onmessage({ data: { target, references, limit: 3, lockedIndices: [5], requestId: 8 } });
  assert.equal(result.error, undefined);
  assert.equal(result.requestId, 8);
  assert.ok(result.fit.components.some((part) => part.referenceIndex === 5));
});

test("population PCA supports a single fitted source and preserves complete labels", () => {
  const projection = projectPca({ ...target, label: "Input" }, [references[0]], [references[1]], "population", true);
  assert.equal(projection.points.length, 1);
  assert.equal(projection.points[0].ethnicity, references[0][1]);
  assert.equal(projection.overlays.length, 1);
  assert.equal(projection.target.label, "Input");
  const exact = projectPca({ values: references[0].slice(2) }, [references[0]], [], "population", true);
  assert.ok(Number.isFinite(exact.target.x) && Number.isFinite(exact.target.y));
});

function seededPool(seed, count, dimensions = 25) {
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 4294967296 - 0.5) * 0.04;
  };
  const references = Array.from({ length: count }, (_, index) => ["modern", `P${index}`,
    ...Array.from({ length: 25 }, (_, coordinate) => coordinate < dimensions ? random() : 0)]);
  return { references, random };
}

test("matches independent SciPy optima for unrestricted and exhaustive capped searches", () => {
  const { references, random } = seededPool(20261020, 12);
  const input = { values: Array.from({ length: 25 }, random) };
  // SciPy SLSQP; capped distances enumerate every allowed reference subset.
  const expected = [[null, 4.816138905238165], [3, 4.862256834987363],
    [4, 4.8167059535382695], [5, 4.816138905236781]];
  for (const [limit, distance] of expected) {
    const fit = fitAncestry(input, references, limit);
    assert.ok(Math.abs(fit.distance - distance) < 1e-7);
    if (limit === null) assert.equal(fit.converged, true);
  }
});

test("escapes the original capped search's local minimum", () => {
  const { references } = seededPool(8, 16, 6);
  const input = { values: Array.from({ length: 25 }, (_, coordinate) =>
    [0, 3, 7, 12, 15].reduce((sum, index) => sum + references[index][coordinate + 2] / 5, 0)) };
  // Independently exhaustively checked with SciPy; the old 3-source fit was 0.784437.
  for (const [limit, distance] of [[3, 0.1689720584908396], [4, 0.047839218969295695], [5, 0]]) {
    const fit = fitAncestry(input, references, limit);
    assert.ok(Math.abs(fit.distance - distance) < 1e-7);
    assert.ok(fit.components.length <= limit);
  }
});

test("handles duplicate and dependent references and satisfies whole-pool optimality", () => {
  const references = [0, 0, 0.25, 0.5, 0.75, 1, 1].map((value, index) =>
    ["ancient", `Line${index}`, value, ...Array(24).fill(0)]);
  const input = { values: [0.3, 0.4, ...Array(23).fill(0)] };
  const fit = fitAncestry(input, references);
  assert.equal(fit.converged, true);
  assert.ok(Math.abs(fit.distance - 40) < 1e-8);
  const residual = input.values.map((value, coordinate) => fit.components.reduce((sum, part) =>
    sum + part.weight * references[part.referenceIndex][coordinate + 2], 0) - value);
  const score = residual.reduce((sum, value) => sum + value * value, 0);
  const minGradient = Math.min(...references.map((row) => residual.reduce((sum, value, coordinate) =>
    sum + value * (row[coordinate + 2] - input.values[coordinate]), 0)));
  assert.ok(score - minGradient < 1e-12);
});

test("global modern data converges and capped multi-start fits beat the old greedy results", () => {
  const bundle = fs.readFileSync(path.join(__dirname, "../calculator/references.js"), "utf8");
  const references = JSON.parse(bundle.slice(bundle.indexOf("=") + 1).trim().replace(/;$/, ""))
    .filter((row) => row[0] === "modern");
  const input = { values: Array.from({ length: 25 }, (_, coordinate) =>
    [3, 25, 88, 125, 255, 511].reduce((sum, index) => sum + references[index][coordinate + 2] / 6, 0)) };
  // Original distances: Unlimited 0.026646; capped 2.960574 / 2.021077 / 1.471328.
  for (const [limit, upperBound] of [[null, 1e-8], [3, 0.8], [4, 0.4], [5, 0.15]]) {
    const fit = fitAncestry(input, references, limit);
    assert.ok(fit.distance < upperBound, `${limit}: ${fit.distance}`);
    assert.ok(limit === null || fit.components.length <= limit);
    assert.ok(fit.components.every((part) => part.weight > 0 && references[part.referenceIndex][1] === part.label));
    if (limit === null) assert.equal(fit.converged, true);
  }
});
