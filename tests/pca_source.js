const fs = require("node:fs");

function readPcaSource(filename) {
  const main = [], extra = [], mixed = [];
  let section = main;
  const headers = [];
  for (const [index, raw] of fs.readFileSync(filename, "utf8").split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    if (line === "Main:" || line === "Deep:" || line === "Deep Mixed:") {
      if ((line === "Main:" && (headers.length || main.length)) ||
          (line === "Deep:" && (headers.length !== 1 || headers[0] !== "Main:")) ||
          (line === "Deep Mixed:" && (headers.length !== 2 || headers[1] !== "Deep:"))) {
        throw new Error(`${filename}:${index + 1}: expected Main:, Deep:, then Deep Mixed:`);
      }
      headers.push(line);
      section = line === "Main:" ? main : line === "Deep:" ? extra : mixed;
      continue;
    }
    const [label, ...cells] = line.split(",");
    const values = cells.map(Number);
    if (!label || values.length !== 25 || cells.some((cell) => !cell.trim()) ||
        values.some((value) => !Number.isFinite(value))) {
      throw new Error(`${filename}:${index + 1}: invalid G25 row: ${label}`);
    }
    section.push(["modern", label, ...values]);
  }
  if (!headers.includes("Deep:")) return { references: main };
  const union = new Map();
  for (const row of [...main, ...extra]) {
    const parts = row[1].split(":").map((part) => part.trim());
    if (parts.length !== 2 || parts.some((part) => !part)) {
      throw new Error(`${filename}: expected Group: Population`);
    }
    const label = parts.join(": ");
    const previous = union.get(label);
    if (previous && previous.slice(2).some((value, index) => value !== row[index + 2])) {
      throw new Error(`${filename}: conflicting coordinates for ${label}`);
    }
    if (!previous) union.set(label, ["modern", label, ...row.slice(2)]);
  }
  return { references: main, deepReferences: [...union.values()],
    ...(headers.includes("Deep Mixed:") ? { deepMixedReferences: mixed } : {}) };
}

module.exports = { readPcaSource };
