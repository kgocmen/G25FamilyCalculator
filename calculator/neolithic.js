function G25NeolithicModule(root) {
  "use strict";

  const data = root.G25_NEOLITHIC_REFERENCES ||
    (typeof module !== "undefined" && module.exports ? require("./neolithic_references.js") : null);
  const medieval = root.G25Medieval ||
    (typeof module !== "undefined" && module.exports ? require("./medieval.js") : null);
  if (!data || !medieval) throw new Error("Neolithic reference data or fitting module was not loaded.");

  function calculate(target, scope) {
    if (scope !== "turkish" && scope !== "global") throw new Error("Unknown Neolithic reference set.");
    const entries = data[scope];
    if (!Array.isArray(entries) || !entries.length) throw new Error("Neolithic references are unavailable.");
    const rows = [];
    const groupByIndex = [];
    entries.forEach(({ name, samples }, groupIndex) => {
      for (const { source, values } of samples) {
        rows.push(["ancient", `${name}:${source}`, ...values]);
        groupByIndex.push(groupIndex);
      }
    });
    const fit = medieval.fitUnrestricted(target, rows);
    const weights = Array(entries.length).fill(0);
    for (const { referenceIndex, weight } of fit.components) {
      weights[groupByIndex[referenceIndex]] += weight;
    }
    const components = entries.map(({ name, sources }, index) =>
      ({ name, sources, weight: weights[index] }))
      .sort((first, second) => second.weight - first.weight || first.name.localeCompare(second.name));
    return { distance: fit.distance, components };
  }

  const api = { calculate, references: data };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.G25Neolithic = api;
}
G25NeolithicModule(typeof window !== "undefined" ? window : globalThis);
