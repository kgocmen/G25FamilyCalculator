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

  function buildMixedPca(pcaFits) {
    const candidates = [...pcaFits].sort((first, second) => first.fit.distance - second.fit.distance);
    const istanbulCount = candidates.filter(({ fit }) =>
      fit.groups.some((group) => group.ethnicity === "Türk_İstanbul" && group.weight > 0)).length;
    if (istanbulCount < 2) return null;
    const references = [];
    const seen = new Set();
    for (const { pca, fit } of candidates) {
      const activeLabels = new Set(fit.components.filter((component) =>
        component.ethnicity !== "Türk_İstanbul").map((component) => component.label));
      for (const row of pca.references) {
        if (!activeLabels.has(row[1])) continue;
        const key = JSON.stringify(row.slice(2));
        if (seen.has(key)) continue;
        seen.add(key);
        references.push(row);
      }
    }
    return references.length >= 3 ? { references, sourceIds: candidates.map(({ pca }) => pca.id) } : null;
  }

  function mixedFitIsBetter(mixedFit, pcaFits) {
    const bestDistance = Math.min(...pcaFits.map(({ fit }) => fit.distance).filter(Number.isFinite));
    return Number.isFinite(mixedFit?.distance) && Number.isFinite(bestDistance) &&
      mixedFit.distance < bestDistance * 0.75;
  }

  const api = { selectModernPca, rankModernPcas, buildMixedPca, mixedFitIsBetter };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.G25ModernPca = api;
    root.G25ModernPcaModule = G25ModernPcaModule;
  }
}
G25ModernPcaModule(typeof window !== "undefined" ? window : globalThis);
