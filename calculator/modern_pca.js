function G25ModernPcaModule(root) {
  "use strict";

  function isIstanbulReference(row) {
    return row[1].split(":", 1)[0] === "Türk_İstanbul";
  }

  function selectFitReferences(target, references, nearestMatches, perGroup = null) {
    const groups = new Map();
    for (const row of references) {
      const name = row[1].split(":", 1)[0];
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(row);
    }
    const limit = perGroup ?? (groups.size > 8 ? 6 : 12);
    const selected = new Set();
    for (const rows of groups.values()) {
      for (const match of nearestMatches(target, rows, limit)) selected.add(rows[match.id]);
    }
    return references.filter((row) => selected.has(row));
  }

  function selectDeepReferences(mainFit, deepReferences) {
    const activeGroups = new Set((mainFit?.groups || [])
      .filter((group) => group.weight > 0).map((group) => group.ethnicity));
    return deepReferences.filter((row) => activeGroups.has(row[1].split(":", 1)[0].trim()));
  }

  function selectMixedDeepReferences(mainFit, deepPcas) {
    const active = new Set((mainFit?.components || []).filter((part) => part.weight > 0)
      .map((part) => part.label));
    const selected = deepPcas.flatMap((pca) => {
      const prefix = `${pca.title.replaceAll(" ", "_")}:`;
      return pca.references.filter((row) => active.has(`${prefix}${row[1].split(":", 1)[0].trim()}`))
        .map((row) => [row[0], `${prefix}${row[1].slice(row[1].indexOf(":") + 1).trim()}`,
          ...row.slice(2)]);
    });
    const seen = new Set();
    return selected.filter((row) => {
      if (seen.has(row[1])) return false;
      seen.add(row[1]);
      return true;
    });
  }

  function selectMixedMainReferences(mainFit, pcas) {
    const fitted = new Map();
    for (const part of mainFit?.components || []) {
      if (part.weight <= 0) continue;
      const colon = part.label.indexOf(":");
      if (colon < 0) continue;
      const map = part.label.slice(0, colon);
      const group = part.label.slice(colon + 1);
      if (!fitted.has(map)) fitted.set(map, new Set());
      fitted.get(map).add(group);
    }
    return pcas.flatMap((pca) => {
      const title = pca.title.replaceAll(" ", "_");
      const groups = fitted.get(title);
      if (!groups) return [];
      return pca.references.filter((row) => groups.has(row[1].split(":", 1)[0].trim()))
        .map((row) => [row[0], `${title}:${row[1]}`, ...row.slice(2)]);
    });
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
    autoFits = null, closestPopulationDistance = 0) {
    const ranked = pcas.map((pca, index) => {
      const references = referencesForPca(pca).filter((row) => !isIstanbulReference(row));
      const distance = nearestMatches(target, references, 1)[0]?.distance ?? Infinity;
      return { pca, number: index + 1, distance };
    });
    ranked.sort((first, second) => {
      if (Number.isFinite(closestPopulationDistance) && closestPopulationDistance > 2) {
        const firstFit = autoFits?.get(first.pca.id)?.distance ?? Infinity;
        const secondFit = autoFits?.get(second.pca.id)?.distance ?? Infinity;
        if (firstFit !== secondFit) return firstFit - secondFit;
      }
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
      if (selected.fit.distance < 1) break;
      if (candidate.fit.distance < selected.fit.distance * ratio) selected = candidate;
      else break;
    }
    return selected;
  }

  function shouldAutoSelectBestRegular(closestFitDistance, bestFitDistance, ratio = 0.75) {
    return Number.isFinite(closestFitDistance) && Number.isFinite(bestFitDistance) &&
      bestFitDistance < closestFitDistance * ratio;
  }

  function shouldAutoSelectMixed(closestPopulationDistance, bestRegularFitDistance, mixedFitDistance) {
    if (!Number.isFinite(bestRegularFitDistance) || !Number.isFinite(mixedFitDistance)) return false;
    const useFitRanking = Number.isFinite(closestPopulationDistance) && closestPopulationDistance > 2;
    return (useFitRanking || bestRegularFitDistance > 2) &&
      mixedFitDistance < bestRegularFitDistance * 0.75;
  }

  const api = { selectModernPca, rankModernPcas, selectFitReferences, selectDeepReferences,
    selectMixedDeepReferences, selectMixedMainReferences, defaultGroupFit,
    shouldAutoSelectBestRegular, shouldAutoSelectMixed, isIstanbulReference };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.G25ModernPca = api;
    root.G25ModernPcaModule = G25ModernPcaModule;
  }
}
G25ModernPcaModule(typeof window !== "undefined" ? window : globalThis);
