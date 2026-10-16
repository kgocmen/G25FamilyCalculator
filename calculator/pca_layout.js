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

  function pointLabel(label) {
    const name = label.includes(":") ? label.slice(label.indexOf(":") + 1) : label;
    const readable = name.replace(/_\(([^)]+)_Profili\)/g, " · $1")
      .replace(/_n=(\d+)$/, " · n=$1").replaceAll("_", " ");
    return readable.length > 45 ? `${readable.slice(0, 31).trimEnd()}…${readable.slice(-12)}` : readable;
  }

  function overlap(a, b) {
    return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
      Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  }

  function layoutLabels(points, bounds, reserved = []) {
    const boxes = [...reserved];
    const positions = Array(points.length);
    const density = (point) => points.reduce((count, other) =>
      count + (Math.hypot(point.x - other.x, point.y - other.y) < 75 ? 1 : 0), 0);
    const order = points.map((point, index) => ({ point, index, neighbors: density(point) }))
      .sort((a, b) => b.neighbors - a.neighbors || a.point.y - b.point.y);
    const offsets = [0];
    for (let step = 1; step <= 18; step += 1) offsets.push(-step * 15, step * 15);
    for (const { point, index } of order) {
      const label = pointLabel(point.label);
      const width = Math.min(bounds.right - bounds.left - 8, label.length * 6.1 + 4);
      const height = 13;
      let best = null;
      for (const shift of [0, 50, 100, 160, 220]) {
        for (const side of [1, -1]) {
          const x = side === 1 ? point.x + 11 + shift : point.x - 11 - shift - width;
          if (x < bounds.left + 3 || x + width > bounds.right - 3) continue;
          for (const offset of offsets) {
            const y = point.y - 7 + offset;
            if (y < bounds.top + 3 || y + height > bounds.bottom - 3) continue;
            const box = { x, y, width, height };
            const collision = boxes.reduce((sum, other) => sum + overlap(box, other), 0);
            const distance = Math.hypot(x + (side === 1 ? 0 : width) - point.x, y + height / 2 - point.y);
            const score = collision * 1000 + distance + shift * 0.1;
            if (!best || score < best.score) best = { box, label, score, side };
            if (score < 12) break;
          }
        }
      }
      if (!best) continue;
      boxes.push(best.box);
      positions[index] = { label: best.label, x: best.box.x, y: best.box.y + 10,
        leaderX: best.side === 1 ? best.box.x - 2 : best.box.x + best.box.width + 2,
        leaderY: best.box.y + best.box.height / 2, box: best.box };
    }
    return positions;
  }

  const api = { convexHull, pointLabel, layoutLabels };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.G25PcaLayout = api;
}
G25PcaLayoutModule(typeof window !== "undefined" ? window : globalThis);
