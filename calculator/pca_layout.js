function G25PcaLayoutModule(root) {
  "use strict";

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

  function neighborEdges(points) {
    const edges = [];
    for (let first = 0; first < points.length; first += 1) {
      for (let second = first + 1; second < points.length; second += 1) {
        const midpointX = (points[first].x + points[second].x) / 2;
        const midpointY = (points[first].y + points[second].y) / 2;
        const halfDistanceSquared = ((points[first].x - points[second].x) ** 2 +
          (points[first].y - points[second].y) ** 2) / 4;
        let blocked = false;
        for (let other = 0; other < points.length; other += 1) {
          if (other === first || other === second) continue;
          const distanceSquared = (points[other].x - midpointX) ** 2 +
            (points[other].y - midpointY) ** 2;
          if (distanceSquared < halfDistanceSquared * (1 - 1e-12)) {
            blocked = true;
            break;
          }
        }
        if (!blocked) edges.push([first, second]);
      }
    }
    return edges;
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

  const api = { convexHull, neighborEdges, inputLabelLayout };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.G25PcaLayout = api;
}
G25PcaLayoutModule(typeof window !== "undefined" ? window : globalThis);
