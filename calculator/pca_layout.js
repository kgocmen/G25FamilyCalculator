function G25PcaLayoutModule(root) {
  "use strict";

  const coordinates = (point) => Array.isArray(point) ? point.slice(2)
    : point.values || [point.x, point.y];
  const category = (point) => {
    const kind = Array.isArray(point) ? point[0] : point.category;
    return kind === "modern" ? "modern" : "ancient";
  };

  function convexHull(points) {
    const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const lower = [];
    for (const point of sorted) {
      while (lower.length > 1 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
      lower.push(point);
    }
    const upper = [];
    for (const point of sorted.reverse()) {
      while (upper.length > 1 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
      upper.push(point);
    }
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
  }

  function neighborEdges(points, blockers = [], categories = null) {
    const pointVectors = points.map(coordinates);
    const blockerVectors = blockers.map(coordinates);
    const dimensions = pointVectors[0]?.length || 0;
    if (pointVectors.some((vector) => vector.length !== dimensions) ||
        blockerVectors.some((vector) => vector.length !== dimensions)) {
      throw new Error("Neighbour references must use the same coordinate dimensions.");
    }
    const edges = [];
    for (let first = 0; first < points.length; first += 1) {
      for (let second = first + 1; second < points.length; second += 1) {
        const midpoint = pointVectors[first].map((value, index) =>
          (value + pointVectors[second][index]) / 2);
        const halfDistanceSquared = pointVectors[first].reduce((sum, value, index) =>
          sum + (value - pointVectors[second][index]) ** 2, 0) / 4;
        const threshold = halfDistanceSquared * (1 - 1e-12);
        const closer = (vector) => {
          let distanceSquared = 0;
          for (let index = 0; index < dimensions; index += 1) {
            distanceSquared += (vector[index] - midpoint[index]) ** 2;
            if (distanceSquared >= threshold) return false;
          }
          return distanceSquared < threshold;
        };
        let blocked = false;
        for (let other = 0; other < points.length; other += 1) {
          if (other === first || other === second) continue;
          if (closer(pointVectors[other])) {
            blocked = true;
            break;
          }
        }
        if (!blocked) for (let index = 0; index < blockers.length; index += 1) {
          const kind = Array.isArray(blockers[index]) ? blockers[index][0] : blockers[index].category;
          if (categories && kind !== categories[first] && kind !== categories[second]) continue;
          if (closer(blockerVectors[index])) {
            blocked = true;
            break;
          }
        }
        if (!blocked) edges.push([first, second]);
      }
    }
    return edges;
  }

  function nearestConnections(points, candidates = points, count = 1, matchCategory = false) {
    if (!Number.isInteger(count) || count < 1 || count > 10) {
      throw new Error("Choose between 1 and 10 nearest populations.");
    }
    const pointVectors = points.map(coordinates);
    const dimensions = pointVectors[0]?.length || 0;
    const seen = new Set();
    const available = [];
    candidates.forEach((row, index) => {
      const values = coordinates(row);
      if (values.length !== dimensions) throw new Error("Neighbour references must use the same coordinate dimensions.");
      const kind = category(row);
      const key = JSON.stringify([matchCategory ? kind : null, values]);
      if (seen.has(key)) return;
      seen.add(key);
      available.push({ index, values, kind });
    });
    const connections = [];
    pointVectors.forEach((source, from) => {
      const top = [];
      const sourceKind = matchCategory ? category(points[from]) : null;
      for (const candidate of available) {
        if (matchCategory && candidate.kind !== sourceKind) continue;
        let distanceSquared = 0;
        for (let dimension = 0; dimension < dimensions; dimension += 1) {
          distanceSquared += (source[dimension] - candidate.values[dimension]) ** 2;
          if (top.length === count && distanceSquared > top[top.length - 1].distanceSquared) break;
        }
        if (distanceSquared === 0) continue;
        const position = top.findIndex((entry) => distanceSquared < entry.distanceSquared ||
          (distanceSquared === entry.distanceSquared && candidate.index < entry.to));
        if (position < 0) {
          if (top.length < count) top.push({ to: candidate.index, distanceSquared });
        } else {
          top.splice(position, 0, { to: candidate.index, distanceSquared });
          if (top.length > count) top.pop();
        }
      }
      for (const { to } of top) connections.push({ from, to });
    });
    return connections;
  }

  function rankNeighborDegrees(rows, edges, count = 10) {
    const limit = Math.max(5, Math.min(100, Math.round(count) || 10));
    const degrees = Array(rows.length).fill(0);
    const seen = new Set();
    for (const [first, second] of edges) {
      if (first === second || first < 0 || second < 0 ||
          first >= rows.length || second >= rows.length) continue;
      const key = `${Math.min(first, second)}:${Math.max(first, second)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      degrees[first] += 1;
      degrees[second] += 1;
    }
    const entries = degrees.map((degree, index) => ({ index, degree }));
    const byName = (first, second) => rows[first.index][1].localeCompare(rows[second.index][1]) ||
      first.index - second.index;
    return {
      most: [...entries].sort((first, second) => second.degree - first.degree || byName(first, second))
        .slice(0, limit),
      least: [...entries].sort((first, second) => first.degree - second.degree || byName(first, second))
        .slice(0, limit),
    };
  }

  function inputLabelLayout(target, offset, size, bounds, radius = 11) {
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    const left = clamp(target.x + offset.x, bounds.left + 4, bounds.right - size.width - 4);
    const top = clamp(target.y + offset.y, bounds.top + 4, bounds.bottom - size.height - 4);
    const right = left + size.width, bottom = top + size.height;
    const end = { x: clamp(target.x, left, right), y: clamp(target.y, top, bottom) };
    const distance = Math.hypot(end.x - target.x, end.y - target.y);
    return { left, top, right, bottom, line: distance <= radius ? null : {
      x1: target.x + (end.x - target.x) * radius / distance,
      y1: target.y + (end.y - target.y) * radius / distance,
      x2: end.x, y2: end.y,
    } };
  }

  const api = { convexHull, neighborEdges, nearestConnections, rankNeighborDegrees,
    inputLabelLayout };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.G25PcaLayout = api;
}
G25PcaLayoutModule(typeof window !== "undefined" ? window : globalThis);
