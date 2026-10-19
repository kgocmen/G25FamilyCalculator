function G25ModernPcaModule(root) {
  "use strict";

  function selectModernPca(target, modernReferences, pcas, nearestMatches, selectedId = "auto") {
    const closest = nearestMatches(target, modernReferences, 1)[0] || null;
    const candidates = closest ? pcas.filter((entry) => entry.anchorLabels.includes(closest.label)) : [];
    let automatic = candidates[0] || null;
    if (candidates.length > 1) {
      const ranked = nearestMatches(target, modernReferences, modernReferences.length);
      const score = (entry) => {
        const unique = new Set(entry.anchorLabels.filter((label) =>
          !candidates.some((other) => other !== entry && other.anchorLabels.includes(label))));
        return ranked.find((match) => unique.has(match.label))?.distance ?? Infinity;
      };
      automatic = candidates.reduce((best, entry) => score(entry) < score(best) ? entry : best);
    }
    const pca = selectedId === "auto" ? automatic : pcas.find((entry) => entry.id === selectedId) || automatic;
    return { closest, pca };
  }

  const api = { selectModernPca };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.G25ModernPca = api;
}
G25ModernPcaModule(typeof window !== "undefined" ? window : globalThis);
