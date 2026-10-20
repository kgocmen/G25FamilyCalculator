function G25VisualiseModule(root) {
  "use strict";

  const DIMENSIONS = 25;
  const WEIGHT_EPSILON = 1e-12;

  function fitAncestry(target, references, limit = null) {
    if (limit !== null && ![3, 4, 5].includes(limit)) throw new Error("Choose Unlimited, 3, 4 or 5 populations.");
    if (!target || !Array.isArray(target.values) || target.values.length !== DIMENSIONS ||
        !target.values.every(Number.isFinite)) throw new Error("The input needs 25 finite G25 coordinates.");
    if (!Array.isArray(references) || !references.length) throw new Error("References are unavailable.");
    const points = references.map((row) => {
      const values = Array.isArray(row) ? row.slice(2) : row.values;
      if (!Array.isArray(values) || values.length !== DIMENSIONS || !values.every(Number.isFinite)) {
        throw new Error("A reference has invalid G25 coordinates.");
      }
      return values.map((value, index) => value - target.values[index]);
    });
    const dot = (first, second) => {
      let sum = 0;
      for (let i = 0; i < DIMENSIONS; i += 1) sum += first[i] * second[i];
      return sum;
    };
    const scale = Math.sqrt(Math.max(...points.map((point) => dot(point, point)))) || 1;
    for (const point of points) for (let i = 0; i < DIMENSIONS; i += 1) point[i] /= scale;
    const norms = points.map((point) => dot(point, point));
    const all = points.map((_, index) => index);
    const tolerance = (score) => Math.max(1e-18, score * 1e-12);

    function mixture(indices, weights) {
      const retained = indices.map((index, i) => ({ index, weight: weights[i] }))
        .filter((part) => part.weight > WEIGHT_EPSILON);
      const total = retained.reduce((sum, part) => sum + part.weight, 0);
      const residual = Array(DIMENSIONS).fill(0);
      for (const part of retained) {
        part.weight /= total;
        for (let i = 0; i < DIMENSIONS; i += 1) residual[i] += part.weight * points[part.index][i];
      }
      return { indices: retained.map((part) => part.index), weights: retained.map((part) => part.weight),
        residual, score: dot(residual, residual) };
    }

    // Pivoted, twice-orthogonalized QR of the affine directions. This avoids
    // normal equations, whose condition number is squared for similar samples.
    function affine(indices) {
      const base = points[indices[0]];
      const columns = indices.slice(1).map((index) => points[index].map((value, i) => value - base[i]));
      const basis = [];
      const chosen = [];
      const remaining = columns.map((_, index) => index);
      while (remaining.length) {
        let best = null;
        for (const column of remaining) {
          const residual = [...columns[column]];
          for (let pass = 0; pass < 2; pass += 1) {
            for (const axis of basis) {
              const projection = dot(axis, residual);
              for (let i = 0; i < DIMENSIONS; i += 1) residual[i] -= projection * axis[i];
            }
          }
          const norm = dot(residual, residual);
          if (!best || norm > best.norm) best = { column, residual, norm };
        }
        if (best.norm < 1e-26) break;
        const length = Math.sqrt(best.norm);
        basis.push(best.residual.map((value) => value / length));
        chosen.push(best.column);
        remaining.splice(remaining.indexOf(best.column), 1);
      }
      const triangular = basis.map((axis) => chosen.map((column) => dot(axis, columns[column])));
      const solve = (rhs) => {
        const result = Array(basis.length).fill(0);
        for (let i = basis.length - 1; i >= 0; i -= 1) {
          let value = rhs[i];
          for (let j = i + 1; j < basis.length; j += 1) value -= triangular[i][j] * result[j];
          result[i] = value / triangular[i][i];
        }
        return result;
      };
      const coefficients = solve(basis.map((axis) => -dot(axis, base)));
      const weights = Array(indices.length).fill(0);
      chosen.forEach((column, i) => { weights[column + 1] = coefficients[i]; });
      weights[0] = 1 - coefficients.reduce((sum, value) => sum + value, 0);
      const residual = [...base];
      basis.forEach((axis) => {
        const projection = dot(axis, base);
        for (let i = 0; i < DIMENSIONS; i += 1) residual[i] -= projection * axis[i];
      });
      return { base, basis, chosen, solve, coefficients, weights, residual };
    }

    // Wolfe's minimum-norm-point method. Every major iteration checks ALL
    // references against the simplex optimality conditions; minor iterations
    // solve the active affine problem and walk to a nonnegative boundary.
    function convex(pool) {
      let nearest = pool[0];
      for (const index of pool) if (norms[index] < norms[nearest]) nearest = index;
      let fit = mixture([nearest], [1]);
      for (let iteration = 0; iteration < 2000; iteration += 1) {
        let entering = pool[0];
        let gradient = dot(points[entering], fit.residual);
        for (const index of pool) {
          const candidate = dot(points[index], fit.residual);
          if (candidate < gradient) { entering = index; gradient = candidate; }
        }
        const gap = fit.score - gradient;
        if (gap <= tolerance(fit.score) || fit.score < 1e-26) return { ...fit, gap, converged: true };
        if (fit.indices.includes(entering)) return { ...fit, gap, converged: false };
        let indices = [...fit.indices, entering];
        let weights = [...fit.weights, 0];
        for (let minor = 0; minor <= pool.length + 1; minor += 1) {
          const solution = affine(indices).weights;
          if (solution.every((weight) => weight >= -WEIGHT_EPSILON)) {
            fit = mixture(indices, solution.map((weight) => Math.max(0, weight)));
            break;
          }
          let step = 1;
          solution.forEach((weight, i) => {
            if (weight < -WEIGHT_EPSILON) step = Math.min(step, weights[i] / (weights[i] - weight));
          });
          weights = weights.map((weight, i) => weight + step * (solution[i] - weight));
          const kept = indices.map((index, i) => ({ index, weight: weights[i] }))
            .filter((part) => part.weight > WEIGHT_EPSILON);
          indices = kept.map((part) => part.index);
          weights = kept.map((part) => part.weight);
        }
      }
      return { ...fit, converged: false };
    }

    // A cheap affine lower bound lets each source exchange inspect every
    // reference. Only candidates capable of improving the fit need a QP solve.
    function exchange(fixed, incumbent) {
      if (!fixed.length) return incumbent;
      const model = affine(fixed);
      const fixedSet = new Set(fixed);
      let best = incumbent;
      const candidates = [];
      for (const index of all) {
        if (fixedSet.has(index)) continue;
        const direction = points[index].map((value, i) => value - model.base[i]);
        const projections = model.basis.map((axis) => dot(axis, direction));
        const perpendicular = [...direction];
        model.basis.forEach((axis, column) => {
          for (let i = 0; i < DIMENSIONS; i += 1) perpendicular[i] -= projections[column] * axis[i];
        });
        const length = dot(perpendicular, perpendicular);
        const weight = length > 1e-26 ? Math.max(0, Math.min(1, -dot(model.residual, perpendicular) / length)) : 0;
        const residual = model.residual.map((value, i) => value + weight * perpendicular[i]);
        const bound = dot(residual, residual);
        if (bound < best.score - tolerance(best.score)) candidates.push({ index, bound, weight, projections });
      }
      candidates.sort((first, second) => first.bound - second.bound || first.index - second.index);
      for (const candidate of candidates) {
        if (candidate.bound >= best.score - tolerance(best.score)) break;
        const correction = model.solve(candidate.projections);
        const weights = Array(fixed.length + 1).fill(0);
        model.chosen.forEach((column, i) => {
          weights[column + 1] = model.coefficients[i] - candidate.weight * correction[i];
        });
        weights[fixed.length] = candidate.weight;
        weights[0] = 1 - weights.slice(1).reduce((sum, value) => sum + value, 0);
        const indices = [...fixed, candidate.index];
        const trial = weights.every((weight) => weight >= -WEIGHT_EPSILON)
          ? mixture(indices, weights.map((weight) => Math.max(0, weight))) : convex(indices);
        if (trial.score < best.score - tolerance(best.score)) best = trial;
      }
      return best;
    }

    let fit = convex(all);
    if (limit !== null && fit.indices.length > limit) {
      // Small pools can be solved exhaustively, including solutions using fewer
      // than the limit. Large datasets use deterministic multi-start exchanges.
      let combinations = 1;
      for (let i = 0; i < limit; i += 1) combinations *= (all.length - i) / (i + 1);
      let best = null;
      if (combinations <= 30000) {
        const search = (start, selected) => {
          if (selected.length === limit) {
            const trial = convex(selected);
            if (!best || trial.score < best.score) best = trial;
            return;
          }
          for (let i = start; i <= all.length - (limit - selected.length); i += 1) search(i + 1, [...selected, i]);
        };
        search(0, []);
      } else {
        const nearest = [...all].sort((first, second) => norms[first] - norms[second] || first - second);
        const strongest = fit.indices.map((index, i) => ({ index, weight: fit.weights[i] }))
          .sort((first, second) => second.weight - first.weight).map((part) => part.index);
        const seeds = [...new Set([...nearest.slice(0, 8), ...strongest.slice(0, 8)])];
        const starts = seeds.map((index) => mixture([index], [1]));
        // Also start from the unrestricted mixture reduced by refitted removals.
        let reduced = fit;
        while (reduced.indices.length > limit) {
          let next = null;
          for (const removed of reduced.indices) {
            const trial = convex(reduced.indices.filter((index) => index !== removed));
            if (!next || trial.score < next.score) next = trial;
          }
          reduced = next;
        }
        starts.unshift(reduced);
        const visited = new Set();
        for (let current of starts) {
          for (let sweep = 0; sweep < 50; sweep += 1) {
            const key = [...current.indices].sort((a, b) => a - b).join(",");
            if (visited.has(key)) break;
            visited.add(key);
            const previous = current;
            if (current.indices.length < limit) current = exchange(current.indices, current);
            else {
              for (const removed of previous.indices) {
                const trial = exchange(previous.indices.filter((index) => index !== removed), current);
                if (trial.score < current.score) current = trial;
              }
            }
            if (current.score >= previous.score - tolerance(previous.score)) break;
          }
          if (!best || current.score < best.score) best = current;
        }
      }
      fit = best;
    }

    const components = fit.indices.map((index, i) => {
      const row = references[index];
      const label = Array.isArray(row) ? row[1] : row.label;
      return { label, sample: label, ethnicity: label, referenceIndex: index, weight: fit.weights[i] };
    }).sort((first, second) => second.weight - first.weight || first.label.localeCompare(second.label));
    const groups = components.map((part) => ({ ethnicity: part.label, weight: part.weight, samples: [part] }));
    const values = Array.from({ length: DIMENSIONS }, (_, coordinate) => components.reduce((sum, part) => {
      const row = references[part.referenceIndex];
      return sum + part.weight * (Array.isArray(row) ? row[coordinate + 2] : row.values[coordinate]);
    }, 0));
    return { distance: Math.sqrt(fit.score) * scale * 100, components, groups, values,
      converged: limit === null ? fit.converged : undefined };
  }

  function closestContributorReferences(fit, references, nearestMatches) {
    if (fit.components.length > 5) return [];
    const fitted = new Set(fit.components.map((part) => part.referenceIndex));
    const available = references.map((row, index) => ({ row, index }))
      .filter(({ index }) => !fitted.has(index));
    const pool = available.map(({ row }) => row);
    return fit.components.flatMap((part) => {
      const source = references[part.referenceIndex];
      const values = Array.isArray(source) ? source.slice(2) : source.values;
      return nearestMatches({ values }, pool, 10).map((match) => ({
        row: available[match.id].row, contributorLabel: part.label, distance: match.distance,
      }));
    });
  }

  const api = { fitAncestry, closestContributorReferences };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.G25Visualise = api;
    root.G25VisualiseModule = G25VisualiseModule;
  }
}
G25VisualiseModule(typeof window !== "undefined" ? window : globalThis);
