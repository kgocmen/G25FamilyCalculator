(function (root) {
  "use strict";

  const DIMENSIONS = 25;
  const PARENT_PAIR_POOL = 500;
  const GRANDPARENT_POOL = 64;
  const GRANDPARENT_SCREEN = 3000;
  const PARENT_MIN = 0.45;
  const PARENT_MAX = 0.55;
  const GRANDPARENT_MIN = 0.225;
  const GRANDPARENT_MAX = 0.275;
  const FOUR_CORNERS = [
    [0.225, 0.225, 0.275, 0.275], [0.225, 0.275, 0.225, 0.275], [0.225, 0.275, 0.275, 0.225],
    [0.275, 0.225, 0.225, 0.275], [0.275, 0.225, 0.275, 0.225], [0.275, 0.275, 0.225, 0.225],
  ];

  function heapPush(heap, item, limit) {
    if (heap.length < limit) {
      heap.push(item);
      let index = heap.length - 1;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (heap[parent].score >= item.score) break;
        heap[index] = heap[parent];
        index = parent;
      }
      heap[index] = item;
    } else if (item.score < heap[0].score) {
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].score > heap[child].score) child += 1;
        if (heap[child].score <= item.score) break;
        heap[index] = heap[child];
        index = child;
      }
      heap[index] = item;
    }
  }

  function dot(first, second) {
    let total = 0;
    for (let k = 0; k < DIMENSIONS; k += 1) total += first[k] * second[k];
    return total;
  }

  function prepare(target, references) {
    if (!target || !Array.isArray(target.values) || target.values.length !== DIMENSIONS ||
      !target.values.every(Number.isFinite)) throw new Error("The input needs 25 finite G25 coordinates.");
    return references.map((row, id) => {
      const values = Array.isArray(row) ? row.slice(2) : row.values;
      if (!Array.isArray(values) || values.length !== DIMENSIONS || !values.every(Number.isFinite)) {
        throw new Error("A reference has invalid G25 coordinates.");
      }
      const centered = Float64Array.from(values, (value, k) => value - target.values[k]);
      return {
        id,
        category: Array.isArray(row) ? row[0] : row.category,
        label: Array.isArray(row) ? row[1] : row.label,
        centered,
        norm: dot(centered, centered),
      };
    });
  }

  function bestPairs(rows) {
    const best = [];
    const pool = [];
    for (let i = 0; i < rows.length; i += 1) {
      const a = rows[i];
      for (let j = i + 1; j < rows.length; j += 1) {
        const b = rows[j];
        const cross = dot(a.centered, b.centered);
        const denominator = Math.max(0, a.norm + b.norm - 2 * cross);
        const weight = denominator < 1e-20 ? 0.5
          : Math.max(PARENT_MIN, Math.min(PARENT_MAX, (b.norm - cross) / denominator));
        const score = Math.max(0, b.norm + 2 * weight * (cross - b.norm) + weight * weight * denominator);
        if (best.length < 10 || score < best[0].score) heapPush(best, { ids: [i, j], weights: [weight, 1 - weight], score }, 10);
        if (pool.length < PARENT_PAIR_POOL || score < pool[0].score) {
          heapPush(pool, { ids: [i, j], score }, PARENT_PAIR_POOL);
        }
      }
    }
    return {
      best: best.sort((a, b) => a.score - b.score || a.ids[0] - b.ids[0] || a.ids[1] - b.ids[1]),
      pool: pool.sort((a, b) => a.score - b.score || a.ids[0] - b.ids[0] || a.ids[1] - b.ids[1]),
    };
  }

  function buildGrandparentPool(rows, pairs) {
    const selected = new Set(rows.map((row) => row.id)
      .sort((a, b) => rows[a].norm - rows[b].norm || a - b).slice(0, Math.min(24, rows.length)));
    for (const pair of pairs) {
      for (const id of pair.ids) {
        if (selected.size < GRANDPARENT_POOL) selected.add(id);
      }
      if (selected.size === GRANDPARENT_POOL) break;
    }
    return [...selected].sort((a, b) => a - b);
  }

  function scoreWeights(gram, weights) {
    let score = 0;
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 4; j += 1) score += weights[i] * weights[j] * gram[i][j];
    }
    return Math.max(0, score);
  }

  function projectWeights(values) {
    let low = Math.min(...values) - GRANDPARENT_MAX;
    let high = Math.max(...values) - GRANDPARENT_MIN;
    for (let iteration = 0; iteration < 32; iteration += 1) {
      const middle = (low + high) / 2;
      let sum = 0;
      for (const value of values) sum += Math.max(GRANDPARENT_MIN, Math.min(GRANDPARENT_MAX, value - middle));
      if (sum > 1) low = middle;
      else high = middle;
    }
    const offset = (low + high) / 2;
    return values.map((value) => Math.max(GRANDPARENT_MIN, Math.min(GRANDPARENT_MAX, value - offset)));
  }

  function fitFour(gram) {
    let weights = [0.25, 0.25, 0.25, 0.25];
    const maxRow = Math.max(...gram.map((row) => row.reduce((sum, value) => sum + Math.abs(value), 0)));
    if (maxRow < 1e-20) return { weights, score: 0 };
    let previous = scoreWeights(gram, weights);
    for (let iteration = 0; iteration < 120; iteration += 1) {
      const gradient = gram.map((row) => row.reduce((sum, value, index) => sum + value * weights[index], 0));
      const next = projectWeights(weights.map((weight, index) => weight - gradient[index] / maxRow));
      const score = scoreWeights(gram, next);
      weights = next;
      if (Math.abs(previous - score) < 1e-17) break;
      previous = score;
    }
    return { weights, score: scoreWeights(gram, weights) };
  }

  function bestGrandparents(rows, pairPool) {
    const pool = buildGrandparentPool(rows, pairPool);
    if (pool.length < 4) return [];
    const dots = pool.map((id) => pool.map((other) => dot(rows[id].centered, rows[other].centered)));
    const screened = [];
    const n = pool.length;
    for (let a = 0; a < n - 3; a += 1) {
      for (let b = a + 1; b < n - 2; b += 1) {
        for (let c = b + 1; c < n - 1; c += 1) {
          for (let d = c + 1; d < n; d += 1) {
            const indices = [a, b, c, d];
            const gram = indices.map((i) => indices.map((j) => dots[i][j]));
            let score = scoreWeights(gram, [0.25, 0.25, 0.25, 0.25]);
            for (const corner of FOUR_CORNERS) score = Math.min(score, scoreWeights(gram, corner));
            if (screened.length < GRANDPARENT_SCREEN || score < screened[0].score) {
              heapPush(screened, { indices, score }, GRANDPARENT_SCREEN);
            }
          }
        }
      }
    }
    const best = [];
    for (const candidate of screened) {
      const gram = candidate.indices.map((i) => candidate.indices.map((j) => dots[i][j]));
      const fit = fitFour(gram);
      if (best.length < 10 || fit.score < best[0].score) {
        heapPush(best, { ids: candidate.indices.map((i) => pool[i]), ...fit }, 10);
      }
    }
    return best.sort((a, b) => a.score - b.score || a.ids.join(",").localeCompare(b.ids.join(",")));
  }

  function decorate(fit, rows) {
    return {
      distance: Math.sqrt(fit.score) * 100,
      parts: fit.ids.map((id, index) => ({
        id, label: rows[id].label, category: rows[id].category, weight: fit.weights[index],
      })),
    };
  }

  function estimate(target, references, onParents) {
    const rows = prepare(target, references);
    const pairFits = bestPairs(rows);
    const parents = pairFits.best.map((fit) => decorate(fit, rows));
    if (onParents) onParents(parents);
    const grandparents = bestGrandparents(rows, pairFits.pool).map((fit) => decorate(fit, rows));
    return { parents, grandparents };
  }

  const api = { estimate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.G25Mixtures = api;
})(typeof window !== "undefined" ? window : globalThis);
