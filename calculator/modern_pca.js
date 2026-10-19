function G25ModernPcaModule(root) {
  "use strict";

  const FIT_TOLERANCE = 1e-6;

  function isIstanbulReference(row) {
    return row[1].split(":", 1)[0] === "Türk_İstanbul";
  }

  function selectModernPca(target, modernReferences, pcas, nearestMatches, selectedId = "auto",
    referencesForPca = (pca) => pca.references, rankedPcas = null) {
    const eligibleReferences = modernReferences.filter((row) => !isIstanbulReference(row));
    const nearest = nearestMatches(target, eligibleReferences, 1)[0] || null;
    const closest = nearest ? { ...nearest, id: modernReferences.indexOf(eligibleReferences[nearest.id]) } : null;
    const automatic = (rankedPcas || rankModernPcas(target, pcas, nearestMatches, referencesForPca))
      .find((entry) => Number.isFinite(entry.distance))?.pca || null;
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

  function mixedFitIsBetter(mixedFit, pcaFits, groupLimit = 2) {
    const bestDistance = Math.min(...pcaFits.map(({ fit }) => fit.distance).filter(Number.isFinite));
    const maxRatio = groupLimit === 3 ? 0.6666 : 0.75;
    // Avoid declaring a mixture from improvements in numerical noise near an exact fit.
    return Number.isFinite(mixedFit?.distance) && Number.isFinite(bestDistance) &&
      bestDistance - mixedFit.distance > FIT_TOLERANCE &&
      mixedFit.distance < bestDistance * maxRatio;
  }

  function findMixedPca(target, pcaFits, groupLimit, fitAdmixture, baselineFits = pcaFits) {
    if (groupLimit < 2 || !mixedFitIsBetter({ distance: 0 }, baselineFits, groupLimit)) return null;
    const candidate = buildMixedPca(pcaFits);
    if (!candidate) return null;
    const fit = fitAdmixture(target, candidate.references, groupLimit, "modern");
    return mixedFitIsBetter(fit, baselineFits, groupLimit) ? { ...candidate, fit } : null;
  }

  const api = { selectModernPca, rankModernPcas, buildMixedPca, findMixedPca, mixedFitIsBetter,
    isIstanbulReference };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.G25ModernPca = api;
    root.G25ModernPcaModule = G25ModernPcaModule;
  }
}
G25ModernPcaModule(typeof window !== "undefined" ? window : globalThis);
