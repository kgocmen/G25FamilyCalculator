function G25ModernPcaModule(root) {
  "use strict";

  function selectModernPca(target, modernReferences, pcas, nearestMatches, selectedId = "auto",
    referencesForPca = (pca) => pca.references, rankedPcas = null) {
    const closest = nearestMatches(target, modernReferences, 1)[0] || null;
    const automatic = (rankedPcas || rankModernPcas(target, pcas, nearestMatches, referencesForPca))
      .find((entry) => Number.isFinite(entry.distance))?.pca || null;
    const pca = selectedId === "auto" ? automatic : pcas.find((entry) => entry.id === selectedId) || automatic;
    return { closest, pca };
  }

  function rankModernPcas(target, pcas, nearestMatches, referencesForPca = (pca) => pca.references) {
    const ranked = pcas.map((pca, index) => {
      const references = referencesForPca(pca);
      const distances = nearestMatches(target, references, references.length).map((match) => match.distance);
      return { pca, number: index + 1, distances, distance: distances[0] ?? Infinity };
    });
    ranked.sort((first, second) => {
      for (let index = 0; index < Math.max(first.distances.length, second.distances.length); index += 1) {
        const difference = (first.distances[index] ?? Infinity) - (second.distances[index] ?? Infinity);
        if (!Number.isNaN(difference) && difference !== 0) return difference;
      }
      return first.number - second.number;
    });
    return ranked.map(({ pca, number, distance }) => ({ pca, number, distance }));
  }

  const api = { selectModernPca, rankModernPcas };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.G25ModernPca = api;
}
G25ModernPcaModule(typeof window !== "undefined" ? window : globalThis);
