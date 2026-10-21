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

  function rankModernPcas(target, pcas, nearestMatches, referencesForPca = (pca) => pca.references,
    autoFits = null) {
    const ranked = pcas.map((pca, index) => {
      const references = referencesForPca(pca).filter((row) => !isIstanbulReference(row));
      const distance = nearestMatches(target, references, 1)[0]?.distance ?? Infinity;
      return { pca, number: index + 1, distance };
    });
    ranked.sort((first, second) => {
      if (first.distance !== second.distance) return first.distance - second.distance;
      const firstFit = autoFits?.get(first.pca.id)?.distance ?? Infinity;
      const secondFit = autoFits?.get(second.pca.id)?.distance ?? Infinity;
      if (firstFit !== secondFit) return firstFit - secondFit;
      return first.number - second.number;
    });
    return ranked.map(({ pca, number, distance }) => ({ pca, number, distance }));
  }

  function defaultGroupFit(fits, ratio = 0.75) {
    if (!fits.length) return null;
    let selected = fits[0];
    for (const candidate of fits.slice(1)) {
      if (candidate.fit.distance < selected.fit.distance * ratio) selected = candidate;
      else break;
    }
    return selected;
  }

  function shouldAutoSelectMixed(closestFitDistance, mixedFitDistance) {
    return Number.isFinite(closestFitDistance) && closestFitDistance > 2 &&
      Number.isFinite(mixedFitDistance) && mixedFitDistance < closestFitDistance;
  }

  const api = { selectModernPca, rankModernPcas, defaultGroupFit,
    shouldAutoSelectMixed, isIstanbulReference };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.G25ModernPca = api;
    root.G25ModernPcaModule = G25ModernPcaModule;
  }
}
G25ModernPcaModule(typeof window !== "undefined" ? window : globalThis);
