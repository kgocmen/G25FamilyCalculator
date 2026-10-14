(function (root) {
  "use strict";

  const DIMENSIONS = 25;
  const GRANDPARENT_POOL = 64;
  const PAIR_POOL = 500;

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

  function sortFits(fits) {
    return fits.sort((a, b) => a.score - b.score || a.ids[0] - b.ids[0] || a.ids[1] - b.ids[1]);
  }

  function bestPairs(rows, { fixed = null, limit = 10, collectPool = false } = {}) {
    const best = [];
    const pool = [];
    for (let i = 0; i < rows.length; i += 1) {
      const a = rows[i];
      for (let j = i + 1; j < rows.length; j += 1) {
        const b = rows[j];
        const cross = dot(a.centered, b.centered);
        const denominator = Math.max(0, a.norm + b.norm - 2 * cross);
        let weight = fixed;
        if (weight === null) {
          if (denominator < 1e-20) continue;
          weight = (b.norm - cross) / denominator;
          // An endpoint is a one-reference fit, not a two-way mixture.
          if (weight <= 1e-8 || weight >= 1 - 1e-8) continue;
        }
        const score = Math.max(0, b.norm + 2 * weight * (cross - b.norm) + weight * weight * denominator);
        if (best.length < limit || score < best[0].score) {
          heapPush(best, { ids: [i, j], weights: [weight, 1 - weight], score }, limit);
        }
        if (collectPool && (pool.length < PAIR_POOL || score < pool[0].score)) {
          heapPush(pool, { ids: [i, j], score }, PAIR_POOL);
        }
      }
    }
    return { best: sortFits(best), pool: sortFits(pool) };
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

  function bestGrandparents(rows, pairs) {
    const pool = buildGrandparentPool(rows, pairs);
    if (pool.length < 4) return [];
    const dots = pool.map((id) => pool.map((other) => dot(rows[id].centered, rows[other].centered)));
    const best = [];
    for (let a = 0; a < pool.length - 3; a += 1) {
      for (let b = a + 1; b < pool.length - 2; b += 1) {
        for (let c = b + 1; c < pool.length - 1; c += 1) {
          for (let d = c + 1; d < pool.length; d += 1) {
            const score = Math.max(0, (
              dots[a][a] + dots[b][b] + dots[c][c] + dots[d][d] +
              2 * (dots[a][b] + dots[a][c] + dots[a][d] + dots[b][c] + dots[b][d] + dots[c][d])
            ) / 16);
            if (best.length < 10 || score < best[0].score) {
              heapPush(best, {
                ids: [pool[a], pool[b], pool[c], pool[d]],
                weights: [0.25, 0.25, 0.25, 0.25],
                score,
              }, 10);
            }
          }
        }
      }
    }
    return sortFits(best);
  }

  function fourWayScore(rows, ids) {
    let square = 0;
    for (let k = 0; k < DIMENSIONS; k += 1) {
      const sum = rows[ids[0]].centered[k] + rows[ids[1]].centered[k] +
        rows[ids[2]].centered[k] + rows[ids[3]].centered[k];
      square += sum * sum;
    }
    return square / 16;
  }

  function exhaustiveGrandparents(rows, shortlist) {
    const n = rows.length;
    if (n < 4) return [];
    const best = [];
    if (n <= 64) {
      for (let a = 0; a < n - 3; a += 1) {
        for (let b = a + 1; b < n - 2; b += 1) {
          for (let c = b + 1; c < n - 1; c += 1) {
            for (let d = c + 1; d < n; d += 1) {
              const ids = [a, b, c, d];
              heapPush(best, { ids, weights: [0.25, 0.25, 0.25, 0.25], score: fourWayScore(rows, ids) }, 10);
            }
          }
        }
      }
      return sortFits(best);
    }

    // A valid top 10 from the fast search gives an upper bound. Pair sums outside
    // that radius cannot improve it, so the spatial search can safely prune them.
    for (const fit of shortlist) {
      heapPush(best, { ...fit, score: fourWayScore(rows, fit.ids) }, 10);
    }
    const pairCount = n * (n - 1) / 2;
    const pairIds = new Uint32Array(pairCount);
    let next = 0;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) pairIds[next++] = i * n + j;
    }
    const vectors = rows.map((row) => row.centered);
    const pairCoordinate = (id, k) => {
      const first = Math.floor(id / n);
      return vectors[first][k] + vectors[id - first * n][k];
    };
    const leafSize = 64;

    function pairBounds(lo, hi) {
      const min = new Float64Array(DIMENSIONS).fill(Infinity);
      const max = new Float64Array(DIMENSIONS).fill(-Infinity);
      for (let at = lo; at < hi; at += 1) {
        const id = pairIds[at];
        const first = Math.floor(id / n);
        const a = vectors[first];
        const b = vectors[id - first * n];
        for (let k = 0; k < DIMENSIONS; k += 1) {
          const value = a[k] + b[k];
          if (value < min[k]) min[k] = value;
          if (value > max[k]) max[k] = value;
        }
      }
      return { min, max };
    }

    function buildIndex(lo, hi, depth) {
      if (hi - lo <= leafSize) return { lo, hi, ...pairBounds(lo, hi) };
      let axis = depth % DIMENSIONS;
      let leftEnd = lo;
      for (let attempt = 0; attempt < DIMENSIONS; attempt += 1) {
        axis = (depth + attempt) % DIMENSIONS;
        let minimum = Infinity;
        let maximum = -Infinity;
        for (let at = lo; at < hi; at += 1) {
          const value = pairCoordinate(pairIds[at], axis);
          if (value < minimum) minimum = value;
          if (value > maximum) maximum = value;
        }
        if (minimum === maximum) continue;
        const middle = (minimum + maximum) / 2;
        let low = lo;
        let high = hi - 1;
        while (low <= high) {
          while (low <= high && pairCoordinate(pairIds[low], axis) < middle) low += 1;
          while (low <= high && pairCoordinate(pairIds[high], axis) >= middle) high -= 1;
          if (low < high) {
            [pairIds[low], pairIds[high]] = [pairIds[high], pairIds[low]];
            low += 1;
            high -= 1;
          }
        }
        leftEnd = low;
        if (leftEnd > lo && leftEnd < hi) break;
      }
      if (leftEnd <= lo || leftEnd >= hi) return { lo, hi, ...pairBounds(lo, hi) };
      const left = buildIndex(lo, leftEnd, depth + 1);
      const right = buildIndex(leftEnd, hi, depth + 1);
      const min = new Float64Array(DIMENSIONS);
      const max = new Float64Array(DIMENSIONS);
      for (let k = 0; k < DIMENSIONS; k += 1) {
        min[k] = Math.min(left.min[k], right.min[k]);
        max[k] = Math.max(left.max[k], right.max[k]);
      }
      return { lo, hi, min, max, left, right };
    }

    const root = buildIndex(0, pairCount, 0);
    const query = new Float64Array(DIMENSIONS);
    const stack = [];
    function lowerBound(node, threshold) {
      let square = 0;
      for (let k = 0; k < DIMENSIONS; k += 1) {
        const value = query[k];
        const difference = value < node.min[k] ? node.min[k] - value
          : value > node.max[k] ? value - node.max[k] : 0;
        square += difference * difference;
        if (square >= threshold) break;
      }
      return square;
    }

    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const a = vectors[i];
        const b = vectors[j];
        for (let k = 0; k < DIMENSIONS; k += 1) query[k] = -a[k] - b[k];
        stack.length = 0;
        stack.push(root);
        const firstPairId = i * n + j;
        while (stack.length) {
          const node = stack.pop();
          if (lowerBound(node, 16 * best[0].score) >= 16 * best[0].score) continue;
          if (node.left) {
            stack.push(node.left, node.right);
            continue;
          }
          for (let at = node.lo; at < node.hi; at += 1) {
            const secondPairId = pairIds[at];
            if (secondPairId <= firstPairId) continue;
            const c = Math.floor(secondPairId / n);
            const d = secondPairId - c * n;
            if (i === c || i === d || j === c || j === d) continue;
            const cc = vectors[c];
            const dd = vectors[d];
            let square = 0;
            const threshold = 16 * best[0].score;
            for (let k = 0; k < DIMENSIONS; k += 1) {
              const sum = a[k] + b[k] + cc[k] + dd[k];
              square += sum * sum;
              if (square >= threshold) break;
            }
            if (square >= threshold) continue;
            const ids = [i, j, c, d].sort((x, y) => x - y);
            if (best.some((fit) => fit.ids.every((id, k) => id === ids[k]))) continue;
            const score = square / 16;
            heapPush(best, { ids, weights: [0.25, 0.25, 0.25, 0.25], score }, 10);
          }
        }
      }
    }
    return sortFits(best);
  }

  function decorate(fit, rows) {
    return {
      distance: Math.sqrt(fit.score) * 100,
      parts: fit.ids.map((id, index) => ({
        id, label: rows[id].label, category: rows[id].category, weight: fit.weights[index],
      })),
    };
  }

  function estimateStrict(target, references, onParents) {
    const rows = prepare(target, references);
    const pairFits = bestPairs(rows, { fixed: 0.5, collectPool: true });
    const parents = pairFits.best.map((fit) => decorate(fit, rows));
    if (onParents) onParents(parents);
    const shortlist = bestGrandparents(rows, pairFits.pool);
    const grandparents = exhaustiveGrandparents(rows, shortlist).map((fit) => decorate(fit, rows));
    return { parents, grandparents };
  }

  function estimateRelaxed(target, references, limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Choose 1 to 100 fits.");
    const rows = prepare(target, references);
    return bestPairs(rows, { limit }).best.map((fit) => decorate(fit, rows));
  }

  function estimateRelaxedByCategory(target, references, limit = 100) {
    const categoryOf = (row) => Array.isArray(row) ? row[0] : row.category;
    return {
      modern: estimateRelaxed(target, references.filter((row) => categoryOf(row) === "modern"), limit),
      ancient: estimateRelaxed(target, references.filter((row) => categoryOf(row) === "ancient"), limit),
    };
  }

  const api = { estimateStrict, estimateRelaxed, estimateRelaxedByCategory };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.G25Mixtures = api;
})(typeof window !== "undefined" ? window : globalThis);
