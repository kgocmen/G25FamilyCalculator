function G25MedievalModule(root) {
  "use strict";

  const DIMENSIONS = 25;

  function projectSimplex(values) {
    const sorted = [...values].sort((a, b) => b - a);
    let sum = 0;
    let threshold = 0;
    for (let i = 0; i < sorted.length; i += 1) {
      sum += sorted[i];
      const candidate = (sum - 1) / (i + 1);
      if (sorted[i] > candidate) threshold = candidate;
    }
    return values.map((value) => Math.max(0, value - threshold));
  }

  function multiply(matrix, vector) {
    return matrix.map((row) => {
      let sum = 0;
      for (let i = 0; i < vector.length; i += 1) sum += row[i] * vector[i];
      return sum;
    });
  }

  function score(matrix, weights) {
    const product = multiply(matrix, weights);
    return weights.reduce((sum, weight, index) => sum + weight * product[index], 0);
  }

  function fitUnrestricted(target, references) {
    if (!target || !Array.isArray(target.values) || target.values.length !== DIMENSIONS ||
        !target.values.every(Number.isFinite)) {
      throw new Error("The input needs 25 finite G25 coordinates.");
    }
    if (!Array.isArray(references) || !references.length) {
      throw new Error("Medieval references are unavailable.");
    }
    const centered = references.map((reference) => {
      const values = Array.isArray(reference) ? reference.slice(2) : reference.values;
      if (!Array.isArray(values) || values.length !== DIMENSIONS || !values.every(Number.isFinite)) {
        throw new Error("A medieval reference has invalid G25 coordinates.");
      }
      return values.map((value, index) => value - target.values[index]);
    });
    const n = centered.length;
    const matrix = Array.from({ length: n }, () => Array(n).fill(0));
    let nearest = 0;
    let nearestScore = Infinity;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j <= i; j += 1) {
        let dot = 0;
        for (let k = 0; k < DIMENSIONS; k += 1) dot += centered[i][k] * centered[j][k];
        matrix[i][j] = dot;
        matrix[j][i] = dot;
      }
      if (matrix[i][i] < nearestScore) {
        nearest = i;
        nearestScore = matrix[i][i];
      }
    }

    let weights = Array(n).fill(0);
    weights[nearest] = 1;
    if (nearestScore > 1e-20) {
      // A row-sum bound remains valid even when the uniform direction is in
      // the Gram matrix's null space (for example an exact balanced mixture).
      const lipschitz = Math.max(...matrix.map((row) => row.reduce((sum, value) => sum + Math.abs(value), 0)));
      const step = 1 / Math.max(lipschitz * 1.01, 1e-20);
      let momentum = 1;
      let extrapolated = [...weights];
      let previousScore = nearestScore;
      for (let iteration = 0; iteration < 6000; iteration += 1) {
        const gradient = multiply(matrix, extrapolated);
        let next = projectSimplex(extrapolated.map((value, index) => value - step * gradient[index]));
        let nextScore = score(matrix, next);
        if (nextScore > previousScore + 1e-14) {
          const restartedGradient = multiply(matrix, weights);
          next = projectSimplex(weights.map((value, index) => value - step * restartedGradient[index]));
          nextScore = score(matrix, next);
          momentum = 1;
        }
        const change = Math.max(...next.map((value, index) => Math.abs(value - weights[index])));
        const nextMomentum = (1 + Math.sqrt(1 + 4 * momentum * momentum)) / 2;
        extrapolated = next.map((value, index) => value +
          ((momentum - 1) / nextMomentum) * (value - weights[index]));
        weights = next;
        momentum = nextMomentum;
        previousScore = nextScore;
        if (iteration > 100 && change < 1e-10) break;
      }
    }

    // Remove negligible fitted components before normalizing the reported mixture.
    const retained = weights.map((weight, index) => ({ weight, index }))
      .filter(({ weight }) => weight >= 0.00005);
    if (!retained.length) retained.push({ weight: 1, index: nearest });
    const total = retained.reduce((sum, part) => sum + part.weight, 0);
    const components = retained.map(({ index, weight }) => {
      const reference = references[index];
      const label = Array.isArray(reference) ? reference[1] : reference.label;
      const colon = label.indexOf(":");
      return {
        label,
        ethnicity: colon < 0 ? label : label.slice(0, colon),
        sample: colon < 0 ? label : label.slice(colon + 1),
        weight: weight / total,
      };
    }).sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));
    const residual = Array(DIMENSIONS).fill(0);
    for (const { index, weight } of retained) {
      for (let k = 0; k < DIMENSIONS; k += 1) residual[k] += weight / total * centered[index][k];
    }
    const distance = Math.hypot(...residual) * 100;
    const byEthnicity = new Map();
    for (const component of components) {
      if (!byEthnicity.has(component.ethnicity)) {
        byEthnicity.set(component.ethnicity, { ethnicity: component.ethnicity, weight: 0, samples: [] });
      }
      const group = byEthnicity.get(component.ethnicity);
      group.weight += component.weight;
      group.samples.push(component);
    }
    const groups = [...byEthnicity.values()]
      .sort((a, b) => b.weight - a.weight || a.ethnicity.localeCompare(b.ethnicity));
    return { distance, components, groups };
  }

  function fitAdmixture(target, references, groupLimit = 5) {
    if (![3, 4, 5].includes(groupLimit)) throw new Error("Choose a limit of 3, 4 or 5 groups.");
    const unrestricted = fitUnrestricted(target, references);
    if (unrestricted.groups.length <= groupLimit) return unrestricted;
    const groupName = (row) => (Array.isArray(row) ? row[1] : row.label).split(":")[0];
    const names = [...new Set(references.map(groupName))].sort();
    let best = null;
    // Evaluate every allowed group subset, refitting all samples within it.
    // The cap applies to ancestry groups, not individual reference samples.
    function search(start, selected) {
      if (selected.length === groupLimit) {
        const subset = references.filter((row) => selected.includes(groupName(row)));
        const fit = fitUnrestricted(target, subset);
        if (!best || fit.distance < best.distance) best = fit;
        return;
      }
      for (let i = start; i <= names.length - (groupLimit - selected.length); i += 1) {
        search(i + 1, [...selected, names[i]]);
      }
    }
    search(0, []);
    return best;
  }

  const api = { fitAdmixture };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.G25Medieval = api;
    root.G25MedievalModule = G25MedievalModule;
  }
}
G25MedievalModule(typeof window !== "undefined" ? window : globalThis);
