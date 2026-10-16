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

  const api = { convexHull };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.G25PcaLayout = api;
}
G25PcaLayoutModule(typeof window !== "undefined" ? window : globalThis);
