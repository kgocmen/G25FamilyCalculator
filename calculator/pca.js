function G25PcaModule(root) {
  "use strict";

  const DIMENSIONS = 25;

  function dot(first, second) {
    let sum = 0;
    for (let i = 0; i < DIMENSIONS; i += 1) sum += first[i] * second[i];
    return sum;
  }

  function multiply(matrix, vector) {
    return matrix.map((row) => dot(row, vector));
  }

  function axis(matrix, previous, seed) {
    let vector = Array.from({ length: DIMENSIONS }, (_, i) =>
      Math.sin((i + 1) * (seed + 1.31)) + Math.cos((i + 1) * (seed + 0.73)));
    const orthogonalize = (values) => {
      const result = [...values];
      for (const earlier of previous) {
        const projection = dot(result, earlier);
        for (let i = 0; i < DIMENSIONS; i += 1) result[i] -= projection * earlier[i];
      }
      return result;
    };
    vector = orthogonalize(vector);
    let length = Math.hypot(...vector);
    if (length < 1e-15) throw new Error("PCA axes are unavailable.");
    vector = vector.map((value) => value / length);
    for (let iteration = 0; iteration < 500; iteration += 1) {
      const product = orthogonalize(multiply(matrix, vector));
      length = Math.hypot(...product);
      if (length < 1e-15) break;
      const next = product.map((value) => value / length);
      const change = Math.min(Math.hypot(...next.map((value, i) => value - vector[i])),
        Math.hypot(...next.map((value, i) => value + vector[i])));
      vector = next;
      if (change < 1e-12) break;
    }
    const anchor = vector.reduce((best, value, i) =>
      Math.abs(value) > Math.abs(vector[best]) ? i : best, 0);
    if (vector[anchor] < 0) vector = vector.map((value) => -value);
    const variance = Math.max(0, dot(vector, multiply(matrix, vector)));
    return { vector, variance };
  }

  function projectPca(target, references, overlays = [], groupStyle = "colon") {
    if (!target || !Array.isArray(target.values) || target.values.length !== DIMENSIONS ||
        !target.values.every(Number.isFinite)) {
      throw new Error("The input needs 25 finite G25 coordinates.");
    }
    if (!Array.isArray(references) || references.length < 3) {
      throw new Error("At least three references are needed for PCA.");
    }
    const readRow = (reference, description) => {
      const values = Array.isArray(reference) ? reference.slice(2) : reference.values;
      const label = Array.isArray(reference) ? reference[1] : reference.label;
      if (!Array.isArray(values) || values.length !== DIMENSIONS || !values.every(Number.isFinite)) {
        throw new Error(`${description} has invalid G25 coordinates.`);
      }
      return { label, values };
    };
    const rows = references.map((reference) => readRow(reference, "A reference"));
    const overlayRows = overlays.map((overlay) => readRow(overlay, "A PCA overlay"));
    const allRows = [...rows, target, ...overlayRows];
    const mean = Array(DIMENSIONS).fill(0);
    for (const row of allRows) {
      for (let i = 0; i < DIMENSIONS; i += 1) mean[i] += row.values[i] / allRows.length;
    }
    const centered = allRows.map((row) => row.values.map((value, i) => value - mean[i]));
    const covariance = Array.from({ length: DIMENSIONS }, () => Array(DIMENSIONS).fill(0));
    for (const values of centered) {
      for (let i = 0; i < DIMENSIONS; i += 1) {
        for (let j = 0; j <= i; j += 1) covariance[i][j] += values[i] * values[j] / (allRows.length - 1);
      }
    }
    for (let i = 0; i < DIMENSIONS; i += 1) {
      for (let j = 0; j < i; j += 1) covariance[j][i] = covariance[i][j];
    }
    const trace = covariance.reduce((sum, row, i) => sum + row[i], 0);
    const first = axis(covariance, [], 0);
    const second = axis(covariance, [first.vector], 1);
    const position = (values) => {
      const centeredValues = values.map((value, i) => value - mean[i]);
      return { x: dot(centeredValues, first.vector), y: dot(centeredValues, second.vector) };
    };
    return {
      points: rows.map((row) => ({ label: row.label,
        ethnicity: groupStyle === "modern"
          ? (row.label.includes(":") ? row.label.split(":", 1)[0] : row.label.split("_", 1)[0])
          : row.label.split(":", 1)[0], ...position(row.values) })),
      target: { label: target.label || "Input", ...position(target.values) },
      overlays: overlayRows.map((row) => ({ label: row.label, ...position(row.values) })),
      explained: trace > 0 ? [first.variance / trace, second.variance / trace] : [0, 0],
    };
  }

  const api = { projectPca };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.G25Pca = api;
}
G25PcaModule(typeof window !== "undefined" ? window : globalThis);
