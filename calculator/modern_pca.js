function G25ModernPcaModule(root) {
  "use strict";

  function isIstanbulReference(row) {
    return row[1].split(":", 1)[0] === "Türk_İstanbul";
  }

  function selectModernPca(target, modernReferences, pcas, nearestMatches, selectedId = "auto",
    referencesForPca = (pca) => pca.references, rankedPcas = null) {
    const eligibleReferences = modernReferences.filter((row) => !isIstanbulReference(row));
    const nearest = nearestMatches(target, eligibleReferences, 1)[0] || null;
    const closest = nearest ? { ...nearest, id: modernReferences.indexOf(eligibleReferences[nearest.id]) } : null;
    const automatic = (rankedPcas || rankModernPcas(target, pcas, nearestMatches, referencesForPca))
      .find((entry) => entry.pca.id !== "mixed" && Number.isFinite(entry.distance))?.pca || null;
    const pca = selectedId === "auto" ? automatic : pcas.find((entry) => entry.id === selectedId) || automatic;
    return { closest, pca };
  }

  function rankModernPcas(target, pcas, nearestMatches, referencesForPca = (pca) => pca.references) {
    const ranked = pcas.map((pca, index) => {
      const references = referencesForPca(pca).filter((row) => !isIstanbulReference(row));
      const distance = nearestMatches(target, references, 1)[0]?.distance ?? Infinity;
      return { pca, number: index + 1, distance };
    });
    ranked.sort((first, second) => {
      if (first.distance !== second.distance) return first.distance - second.distance;
      return first.number - second.number;
    });
    return ranked.map(({ pca, number, distance }) => ({ pca, number, distance }));
  }

  function buildMixedPca(pcas) {
    const references = [];
    const sources = pcas.filter((pca) => pca.id !== "istanbul");
    for (const pca of sources) {
      const groups = new Map();
      for (const row of pca.references) {
        const name = row[1].includes(":") ? row[1].split(":", 1)[0]
          : row[1].split("_", 1)[0];
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(row);
      }
      for (const [name, rows] of groups) {
        const centroid = Array.from({ length: 25 }, (_, index) =>
          rows.reduce((sum, row) => sum + row[index + 2], 0) / rows.length);
        references.push(["modern", `${pca.title || pca.id}:${name} centroid`, ...centroid]);
      }
    }
    return references.length >= 3 ? { id: "mixed", title: "Mixed PCA", references,
      referenceAnchors: [],
      sourceIds: sources.map((pca) => pca.id) } : null;
  }

  function fitMixedPca(target, references, groupLimit, fitAdmixture) {
    if (groupLimit !== 2 && groupLimit !== 3) {
      throw new Error("Mixed PCA requires 2 or 3 groups.");
    }
    return fitAdmixture(target, references, groupLimit, "modern");
  }

  const api = { selectModernPca, rankModernPcas, buildMixedPca, fitMixedPca, isIstanbulReference };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.G25ModernPca = api;
    root.G25ModernPcaModule = G25ModernPcaModule;
  }
}
G25ModernPcaModule(typeof window !== "undefined" ? window : globalThis);
