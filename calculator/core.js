(function (root) {
  "use strict";

  const DIMENSIONS = 25;

  function splitCsv(line) {
    const fields = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === "," && !quoted) {
        fields.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    if (quoted) throw new Error("The pasted row has an unclosed quote.");
    fields.push(current.trim());
    return fields;
  }

  function parseLine(text) {
    const line = String(text).trim().split(/\r?\n/).find((part) => part.trim());
    if (!line) throw new Error("Paste one G25 coordinate row.");
    const cells = splitCsv(line);
    if (cells.length !== DIMENSIONS && cells.length !== DIMENSIONS + 1) {
      throw new Error("A G25 row needs a label followed by 25 numbers (or just 25 numbers).");
    }
    const hasLabel = cells.length === DIMENSIONS + 1;
    const label = hasLabel ? cells.shift() : "Pasted_sample";
    if (!label) throw new Error("The G25 label is empty.");
    const values = cells.map((cell) => Number(cell));
    if (cells.some((cell) => !cell) || values.some((value) => !Number.isFinite(value))) {
      throw new Error("Every G25 coordinate must be a finite number.");
    }
    return { label, values };
  }

  function validateVector(values) {
    return Array.isArray(values) && values.length === DIMENSIONS &&
      values.every((value) => typeof value === "number" && Number.isFinite(value));
  }

  function distance(first, second) {
    if (!validateVector(first) || !validateVector(second)) throw new Error("Invalid G25 coordinates.");
    return Math.hypot(...first.map((value, index) => value - second[index])) * 100;
  }

  function nearestMatches(target, references, limit = 10) {
    if (!target || !validateVector(target.values)) throw new Error("The target needs valid G25 coordinates.");
    return references.map((row, index) => ({
      id: index,
      category: Array.isArray(row) ? row[0] : row.category,
      label: Array.isArray(row) ? row[1] : row.label,
      distance: distance(target.values, Array.isArray(row) ? row.slice(2) : row.values),
    })).sort((a, b) => a.distance - b.distance || a.id - b.id).slice(0, limit);
  }

  function prepareMatches(actual, calculated, references) {
    if (!validateVector(actual.values) || !validateVector(calculated.values)) {
      throw new Error("Both targets need valid G25 coordinates.");
    }
    const candidates = references.map((row, index) => {
      const values = Array.isArray(row) ? row.slice(2) : row.values;
      return {
        id: index,
        category: Array.isArray(row) ? row[0] : row.category,
        label: Array.isArray(row) ? row[1] : row.label,
        ac: distance(actual.values, values),
        bc: distance(calculated.values, values),
      };
    });
    for (const candidate of candidates) {
      candidate.difference = candidate.ac - candidate.bc;
      candidate.ratio = candidate.bc === 0 ? null : candidate.ac / candidate.bc;
      candidate.d3 = candidate.ac + candidate.bc === 0
        ? null : candidate.difference / (candidate.ac + candidate.bc);
    }
    const between = distance(actual.values, calculated.values);
    const furthestDistance = candidates.reduce((furthest, row) => Math.max(furthest, row.ac, row.bc), 0);
    return { actual, calculated, candidates, between, furthestDistance };
  }

  function rankMatches(prepared, limit = 10, metricLimit = 10, closestLimit = limit) {
    if (!Number.isFinite(metricLimit) || metricLimit < 0) throw new Error("Choose a valid distance limit.");
    const { actual, calculated, candidates, between } = prepared;
    const metricCandidates = candidates.filter((row) => row.ac <= metricLimit && row.bc <= metricLimit);
    // The opposing target competes with every reference for a place in each closest list.
    const rank = (key, other) => [...candidates, other]
      .sort((a, b) => a[key] - b[key] || (a.category === "target" ? -1 : b.category === "target" ? 1 : a.id - b.id))
      .slice(0, closestLimit);
    const extremes = (key, ascending) => metricCandidates
      .filter((row) => Number.isFinite(row[key]))
      .sort((a, b) => (ascending ? a[key] - b[key] : b[key] - a[key]) || a.id - b.id)
      .slice(0, limit);
    return {
      actual: rank("ac", { id: -1, category: "target", label: calculated.label, ac: between, bc: 0 }),
      calculated: rank("bc", { id: -2, category: "target", label: actual.label, ac: 0, bc: between }),
      smallestDifference: extremes("difference", true),
      largestDifference: extremes("difference", false),
      smallestRatio: extremes("ratio", true),
      largestRatio: extremes("ratio", false),
      smallestD3: extremes("d3", true),
      largestD3: extremes("d3", false),
    };
  }

  function closestMatches(actual, calculated, references, limit = 10, metricLimit = 10) {
    return rankMatches(prepareMatches(actual, calculated, references), limit, metricLimit);
  }

  function ancestorWeights(count, male = false) {
    if (![2, 4, 8, 16].includes(count)) throw new Error("Choose 2, 4, 8, or 16 ancestors.");
    if (count === 2 && male) return [0.51, 0.49];
    if (count === 4 && male) return [0.255, 0.255, 0.245, 0.245];
    return Array(count).fill(1 / count);
  }

  function estimateChildFromKnown(ancestors, male = false) {
    const weights = ancestorWeights(ancestors.length, male);
    let knownWeight = 0;
    let knownCount = 0;
    for (let index = 0; index < ancestors.length; index += 1) {
      if (!ancestors[index]) continue;
      if (!validateVector(ancestors[index].values)) throw new Error("Invalid ancestor coordinates.");
      knownWeight += weights[index];
      knownCount += 1;
    }
    if (!knownCount) return null;
    const values = Array.from({ length: DIMENSIONS }, (_, pc) =>
      ancestors.reduce((sum, ancestor, index) =>
        sum + (ancestor ? weights[index] * ancestor.values[pc] : 0), 0) / knownWeight);
    return { values, knownCount, knownWeight };
  }

  function calculate(offspring, ancestors, male = false) {
    if (![2, 4, 8, 16].includes(ancestors.length)) throw new Error("Choose 2, 4, 8, or 16 ancestors.");
    if (offspring && !validateVector(offspring.values)) throw new Error("Invalid child coordinates.");
    for (const ancestor of ancestors) {
      if (ancestor && !validateVector(ancestor.values)) throw new Error("Invalid ancestor coordinates.");
    }

    const missing = ancestors.map((ancestor, index) => ancestor ? -1 : index).filter((index) => index >= 0);
    const count = ancestors.length;
    const weights = ancestorWeights(count, male);
    if (missing.length === 0) {
      const values = Array.from({ length: DIMENSIONS }, (_, pc) =>
        ancestors.reduce((sum, ancestor, index) => sum + weights[index] * ancestor.values[pc], 0));
      const separation = offspring ? distance(values, offspring.values) : null;
      return { kind: "offspring", values, distance: separation };
    }
    if (offspring) {
      const values = Array.from({ length: DIMENSIONS }, (_, pc) =>
        offspring.values[pc] - ancestors.reduce((sum, ancestor, index) =>
          sum + (ancestor ? weights[index] * ancestor.values[pc] : 0), 0));
      const missingWeight = missing.reduce((sum, index) => sum + weights[index], 0);
      return {
        kind: "residual",
        missing,
        values,
        inferred: missing.length === 1 ? values.map((value) => value / weights[missing[0]]) : null,
        combined: values.map((value) => value / missingWeight),
        distance: null,
      };
    }
    return { kind: "incomplete", missing: missing.length, values: null, distance: null };
  }

  function resultLabel(offspring, ancestors, male = false) {
    if (ancestors.every(Boolean)) return ancestors.map((ancestor) => ancestor.label).join("+");
    if (!offspring) throw new Error("A child is needed when ancestors are missing.");
    const weights = ancestorWeights(ancestors.length, male);
    const residual = offspring.label + ancestors.map((ancestor, index) => ancestor
      ? `-${weights[index]}*${ancestor.label}` : "").join("");
    const missing = ancestors.map((ancestor, index) => ancestor ? -1 : index).filter((index) => index >= 0);
    if (missing.length <= 1 || missing.length === ancestors.length) return residual;
    const missingWeight = missing.reduce((sum, index) => sum + weights[index], 0);
    return `(${residual})/${missingWeight}`;
  }

  function missingAncestorLabel(offspring, ancestors, male = false) {
    const missing = ancestors.map((ancestor, index) => ancestor ? -1 : index).filter((index) => index >= 0);
    if (!offspring || missing.length !== 1) throw new Error("Fill the child and leave exactly one ancestor blank.");
    const weights = ancestorWeights(ancestors.length, male);
    if (weights.every((weight) => weight === weights[0])) {
      return `${ancestors.length}*${offspring.label}${ancestors.filter(Boolean)
        .map((ancestor) => `-${ancestor.label}`).join("")}`;
    }
    return `(${resultLabel(offspring, ancestors, male)})/${weights[missing[0]]}`;
  }

  function calculateComparison(offspring, ancestors, selectedIndex = null, male = false) {
    if (!offspring || ancestors.some((ancestor) => !ancestor)) {
      throw new Error("Fill the child and every ancestor before comparing a selected person.");
    }
    const offspringResult = calculate(offspring, ancestors, male);
    if (selectedIndex === null) {
      const calculated = { label: resultLabel(offspring, ancestors, male), values: offspringResult.values };
      return { actual: offspring, calculated, distance: offspringResult.distance };
    }
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= ancestors.length) {
      throw new Error("Choose a valid ancestor.");
    }
    const others = [...ancestors];
    others[selectedIndex] = null;
    const inferred = calculate(offspring, others, male).inferred;
    const label = missingAncestorLabel(offspring, others, male);
    const calculated = { label, values: inferred };
    return { actual: ancestors[selectedIndex], calculated, distance: distance(ancestors[selectedIndex].values, inferred) };
  }

  function formatNumber(value) {
    const rounded = value.toFixed(12).replace(/\.?0+$/, "");
    return rounded === "-0" || rounded === "" ? "0" : rounded;
  }

  function formatLine(label, values) {
    if (!validateVector(values)) throw new Error("Invalid G25 coordinates.");
    const safeLabel = String(label).replaceAll('"', '""');
    const csvLabel = /[",\r\n]/.test(safeLabel) ? `"${safeLabel}"` : safeLabel;
    return [csvLabel, ...values.map(formatNumber)].join(",");
  }

  const api = { ancestorWeights, calculate, calculateComparison, closestMatches, distance, estimateChildFromKnown, formatLine, missingAncestorLabel, nearestMatches, parseLine, prepareMatches, rankMatches, resultLabel };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.G25Core = api;
})(typeof window !== "undefined" ? window : globalThis);
