(function G25CoreModule(root) {
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

  function visibleRemainingAdmixture(fits, references, targets) {
    const between = distance(targets[0].values, targets[1].values);
    return fits.filter((fit) => {
      if (!fit.best) return true;
      if (fit.best.distance > between) return false;
      const row = references[fit.best.id];
      const values = Array.isArray(row) ? row.slice(2) : row.values;
      return !targets.some((target) => fit.best.label === target.label ||
        values.every((value, index) => value === target.values[index]));
    });
  }

  function remainingAdmixture(target, source, references, step = 5) {
    if (![1, 5, 10].includes(step)) throw new Error("Choose a percentage step of 1, 5 or 10.");
    if (!target || !source || !validateVector(target.values) || !validateVector(source.values)) {
      throw new Error("Both targets need valid G25 coordinates.");
    }
    const candidates = references.map((row, id) => ({
      id,
      category: Array.isArray(row) ? row[0] : row.category,
      label: Array.isArray(row) ? row[1] : row.label,
      values: Array.isArray(row) ? row.slice(2) : row.values,
    }));
    if (candidates.some((row) => !validateVector(row.values))) throw new Error("Invalid G25 coordinates.");
    return Array.from({ length: 100 / step - 1 }, (_, index) => {
      const percent = (index + 1) * step;
      const weight = percent / 100;
      let best = null;
      for (const candidate of candidates) {
        const mixture = source.values.map((value, dimension) =>
          weight * value + (1 - weight) * candidate.values[dimension]);
        const fitDistance = distance(target.values, mixture);
        if (!best || fitDistance < best.distance) {
          best = { id: candidate.id, category: candidate.category, label: candidate.label, distance: fitDistance };
        }
      }
      return { percent, remainingPercent: 100 - percent, best };
    });
  }

  function summarizeRemainingAdmixture(fits, target, source, references) {
    const result = [];
    for (let start = 0; start < fits.length;) {
      let end = start;
      while (end + 1 < fits.length && fits[end + 1].best?.id === fits[start].best?.id) end += 1;
      const first = fits[start];
      const last = fits[end];
      let minimum = first;
      if (first.best) {
        const reference = references[first.best.id];
        const values = Array.isArray(reference) ? reference.slice(2) : reference.values;
        for (let percent = first.percent + 1; percent <= last.percent; percent += 1) {
          const weight = percent / 100;
          const mixture = source.values.map((value, dimension) =>
            weight * value + (1 - weight) * values[dimension]);
          const fitDistance = distance(target.values, mixture);
          if (fitDistance < minimum.best.distance) {
            minimum = { percent, remainingPercent: 100 - percent,
              best: { ...first.best, distance: fitDistance } };
          }
        }
      }
      const selected = new Map([first, minimum, last].map((fit) => [fit.percent, fit]));
      result.push(...[...selected.values()].sort((a, b) => a.percent - b.percent)
        .map((fit) => ({ ...fit, isGroupBest: Boolean(fit.best) && fit.percent === minimum.percent })));
      start = end + 1;
    }
    return result;
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

  function bestFamilyCombination(residual, candidates, weights) {
    const n = candidates.length;
    const vectors = candidates.map((row) => row.values);
    const count = weights.length;
    const pairWeight = weights[count - 1];
    const score = (ids) => residual.reduce((sum, value, k) => {
      const delta = value - ids.reduce((total, id, slot) => total + weights[slot] * vectors[id][k], 0);
      return sum + delta * delta;
    }, 0);
    // Establish a valid upper bound before the exhaustive spatial search.
    let bestIds = Array(count).fill(0);
    let bestScore = score(bestIds);
    for (let pass = 0; pass < 3; pass += 1) {
      for (let slot = 0; slot < count; slot += 1) {
        for (let id = 0; id < n; id += 1) {
          const trial = [...bestIds];
          trial[slot] = id;
          const value = score(trial);
          if (value < bestScore) { bestScore = value; bestIds = trial; }
        }
      }
    }
    if (bestScore === 0) return bestIds;
    const pairIds = new Uint32Array(n * (n + 1) / 2);
    let next = 0;
    for (let i = 0; i < n; i += 1) {
      for (let j = i; j < n; j += 1) pairIds[next++] = i * n + j;
    }
    const coordinate = (id, k) => pairWeight * (vectors[Math.floor(id / n)][k] + vectors[id % n][k]);
    function build(lo, hi, depth) {
      if (hi - lo > 64) {
        for (let attempt = 0; attempt < DIMENSIONS; attempt += 1) {
          const axis = (depth + attempt) % DIMENSIONS;
          let min = Infinity;
          let max = -Infinity;
          for (let at = lo; at < hi; at += 1) {
            const value = coordinate(pairIds[at], axis);
            min = Math.min(min, value); max = Math.max(max, value);
          }
          if (min === max) continue;
          const middle = (min + max) / 2;
          let left = lo;
          let right = hi - 1;
          while (left <= right) {
            while (left <= right && coordinate(pairIds[left], axis) < middle) left += 1;
            while (left <= right && coordinate(pairIds[right], axis) >= middle) right -= 1;
            if (left < right) {
              [pairIds[left], pairIds[right]] = [pairIds[right], pairIds[left]];
              left += 1; right -= 1;
            }
          }
          if (left === lo || left === hi) continue;
          const a = build(lo, left, depth + 1);
          const b = build(left, hi, depth + 1);
          return { a, b, min: a.min.map((value, k) => Math.min(value, b.min[k])),
            max: a.max.map((value, k) => Math.max(value, b.max[k])) };
        }
      }
      const min = new Float64Array(DIMENSIONS).fill(Infinity);
      const max = new Float64Array(DIMENSIONS).fill(-Infinity);
      for (let at = lo; at < hi; at += 1) {
        for (let k = 0; k < DIMENSIONS; k += 1) {
          const value = coordinate(pairIds[at], k);
          min[k] = Math.min(min[k], value); max[k] = Math.max(max[k], value);
        }
      }
      return { lo, hi, min, max };
    }
    const tree = build(0, pairIds.length, 0);
    const query = new Float64Array(DIMENSIONS);
    const bound = (node) => {
      let sum = 0;
      for (let k = 0; k < DIMENSIONS; k += 1) {
        const delta = Math.max(node.min[k] - query[k], 0, query[k] - node.max[k]);
        sum += delta * delta;
      }
      return sum;
    };
    function search(node, prefix) {
      // A small tolerance keeps roundoff at box boundaries from pruning a better fit.
      if (bound(node) > bestScore + 1e-18) return;
      if (node.a) {
        const aFirst = bound(node.a) <= bound(node.b);
        search(aFirst ? node.a : node.b, prefix);
        search(aFirst ? node.b : node.a, prefix);
        return;
      }
      for (let at = node.lo; at < node.hi; at += 1) {
        const id = pairIds[at];
        const ids = [...prefix, Math.floor(id / n), id % n];
        const value = score(ids);
        if (value < bestScore) { bestScore = value; bestIds = ids; }
      }
    }
    for (let i = 0; i < n; i += 1) {
      for (let j = count === 4 ? i : 0; j < (count === 4 ? n : 1); j += 1) {
        for (let k = 0; k < DIMENSIONS; k += 1) {
          query[k] = residual[k] - weights[0] * vectors[i][k] - (count === 4 ? weights[1] * vectors[j][k] : 0);
        }
        search(tree, count === 4 ? [i, j] : [i]);
        if (bestScore === 0) return bestIds;
      }
    }
    return bestIds;
  }

  function optimiseFamily(offspring, ancestors, locks, references, male = false) {
    if (!offspring || !validateVector(offspring.values) || ancestors.some((row) => row && !validateVector(row.values))) {
      throw new Error("Fill the child and use valid contributor coordinates before optimising.");
    }
    const weights = ancestorWeights(ancestors.length, male);
    const unlocked = ancestors.map((row, index) => row && (row.source !== "reference" || locks[index]) ? -1 : index)
      .filter((index) => index >= 0);
    const minimumLocks = { 2: 0, 4: 1, 8: 4 }[ancestors.length];
    if (minimumLocks === undefined || ancestors.length - unlocked.length < minimumLocks) {
      throw new Error(`Lock at least ${minimumLocks ?? ancestors.length} contributors before optimising.`);
    }
    // Put an equal-weight pair last so its unordered sums can share one index.
    if (unlocked.length === 3 && weights[unlocked[1]] !== weights[unlocked[2]]) {
      [unlocked[0], unlocked[2]] = [unlocked[2], unlocked[0]];
    }
    if (!unlocked.length) return { ancestors: [...ancestors], distance: calculate(offspring, ancestors, male).distance };
    const candidates = references.filter((row) => (Array.isArray(row) ? row[0] : row.category) === "modern")
      .map((row) => ({ category: "modern", label: Array.isArray(row) ? row[1] : row.label,
        values: Array.isArray(row) ? row.slice(2) : row.values, source: "reference" }));
    if (!candidates.length) throw new Error("No modern reference populations are available.");
    if (candidates.some((row) => !validateVector(row.values))) throw new Error("Invalid reference coordinates.");
    const residual = offspring.values.map((value, k) => value - ancestors.reduce((sum, row, index) =>
      sum + (unlocked.includes(index) ? 0 : weights[index] * row.values[k]), 0));
    if (unlocked.length > 2) {
      const ids = bestFamilyCombination(residual, candidates, unlocked.map((index) => weights[index]));
      const result = [...ancestors];
      unlocked.forEach((index, position) => { result[index] = candidates[ids[position]]; });
      return { ancestors: result, distance: calculate(offspring, result, male).distance };
    }
    let bestScore = Infinity;
    let bestPair = null;
    const firstWeight = weights[unlocked[0]];
    const secondWeight = unlocked.length === 2 ? weights[unlocked[1]] : 0;
    for (let i = 0; i < candidates.length; i += 1) {
      const rest = residual.map((value, k) => value - firstWeight * candidates[i].values[k]);
      const start = secondWeight === firstWeight ? i : 0;
      for (let j = start; j < (secondWeight ? candidates.length : 1); j += 1) {
        let score = 0;
        for (let k = 0; k < DIMENSIONS; k += 1) {
          const delta = rest[k] - (secondWeight ? secondWeight * candidates[j].values[k] : 0);
          score += delta * delta;
          if (score >= bestScore) break;
        }
        if (score < bestScore) {
          bestScore = score;
          bestPair = [i, j];
        }
      }
    }
    const result = [...ancestors];
    unlocked.forEach((index, position) => { result[index] = candidates[bestPair[position]]; });
    return { ancestors: result, distance: calculate(offspring, result, male).distance };
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

  const api = { optimiseFamily, ancestorWeights, calculate, calculateComparison, closestMatches, distance, estimateChildFromKnown, visibleRemainingAdmixture, formatLine, missingAncestorLabel, nearestMatches, parseLine, prepareMatches, rankMatches, remainingAdmixture, summarizeRemainingAdmixture, resultLabel };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.G25Core = api;
    root.G25CoreModule = G25CoreModule;
  }
})(typeof window !== "undefined" ? window : globalThis);
