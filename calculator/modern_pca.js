function G25ModernPcaModule(root) {
  "use strict";

  const MIN_EXCLUSIVE_WEIGHT = 0.1;
  const WEIGHT_TOLERANCE = 1e-4;
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

  function buildMixedPca(first, second) {
    const references = [];
    const referenceSources = [];
    const seen = new Map();
    for (const [source, pca] of [first, second].entries()) {
      for (const row of pca.references) {
        if (isIstanbulReference(row)) continue;
        const key = JSON.stringify(row.slice(2));
        if (!seen.has(key)) {
          seen.set(key, references.length);
          references.push(row);
          referenceSources.push([]);
        }
        const sources = referenceSources[seen.get(key)];
        if (!sources.includes(source)) sources.push(source);
      }
    }
    return { references, referenceSources, sourceIds: [first.id, second.id],
      sourceTitles: [first.title || first.id, second.title || second.id] };
  }

  function mixedFitIsBetter(mixedFit, pcaFits, groupLimit = 2) {
    const bestDistance = Math.min(...pcaFits.map(({ fit }) => fit.distance).filter(Number.isFinite));
    const maxRatio = groupLimit === 3 ? 0.6666 : 0.75;
    // Avoid declaring a mixture from improvements in numerical noise near an exact fit.
    return Number.isFinite(mixedFit?.distance) && Number.isFinite(bestDistance) &&
      bestDistance - mixedFit.distance > FIT_TOLERANCE &&
      mixedFit.distance < bestDistance * maxRatio;
  }

  function findMixedPca(target, pcaFits, groupLimit, fitAdmixture) {
    if (groupLimit < 2 || !mixedFitIsBetter({ distance: 0 }, pcaFits, groupLimit)) return null;
    let best = null;
    for (let first = 0; first < pcaFits.length; first += 1) {
      for (let second = first + 1; second < pcaFits.length; second += 1) {
        const candidate = buildMixedPca(pcaFits[first].pca, pcaFits[second].pca);
        // Shared references provide no evidence for either source independently.
        if (![0, 1].every((source) => candidate.referenceSources.some((sources) =>
          sources.length === 1 && sources[0] === source))) continue;
        const fit = fitAdmixture(target, candidate.references, groupLimit, "modern");
        if (!mixedFitIsBetter(fit, pcaFits, groupLimit) || (best && fit.distance >= best.fit.distance)) continue;
        const exclusiveWeights = [0, 0];
        for (const component of fit.components) {
          const sources = candidate.referenceSources[component.referenceIndex];
          if (sources.length === 1) exclusiveWeights[sources[0]] += component.weight;
        }
        // Allow 90/10 mixtures, with tolerance for fitted weights near the boundary.
        if (exclusiveWeights.some((weight) => weight < MIN_EXCLUSIVE_WEIGHT - WEIGHT_TOLERANCE)) continue;
        best = { ...candidate, fit, exclusiveWeights };
      }
    }
    return best;
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
