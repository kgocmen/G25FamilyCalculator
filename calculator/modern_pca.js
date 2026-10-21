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
    const seen = new Set();
    for (const pca of pcas) {
      for (const row of pca.references) {
        if (seen.has(row[1])) continue;
        seen.add(row[1]);
        references.push(row);
      }
    }
    return references.length >= 3 ? { id: "mixed", title: "Mixed PCA", references,
      referenceAnchors: [],
      sourceIds: pcas.map((pca) => pca.id) } : null;
  }

  function fitMixedPca(target, references, groupLimit, fitAdmixture) {
    if (groupLimit !== 2 && groupLimit !== 3) {
      throw new Error("Mixed PCA requires 2 or 3 groups.");
    }
    const groupName = (row) => row[1].includes(":") ? row[1].split(":", 1)[0]
      : row[1].split("_", 1)[0];
    const grouped = new Map();
    for (const row of references) {
      const name = groupName(row);
      if (!grouped.has(name)) grouped.set(name, []);
      grouped.get(name).push(row);
    }
    if (grouped.size <= 12) return fitAdmixture(target, references, groupLimit, "modern");

    // Screen every group and cross-group sample pair before the expensive
    // bounded-group refit. The PCA itself still contains the complete union.
    const samples = references.map((row) => ({ row, name: groupName(row), values: row.slice(2) }));
    const nearest = new Map([...grouped.keys()].map((name) => [name, Infinity]));
    for (const sample of samples) {
      const distance = Math.hypot(...sample.values.map((value, i) => value - target.values[i]));
      nearest.set(sample.name, Math.min(nearest.get(sample.name), distance));
    }
    const pairScores = new Map();
    for (let i = 0; i < samples.length; i += 1) {
      const first = samples[i];
      for (let j = i + 1; j < samples.length; j += 1) {
        const second = samples[j];
        if (first.name === second.name) continue;
        let numerator = 0;
        let denominator = 0;
        for (let k = 0; k < 25; k += 1) {
          const delta = second.values[k] - first.values[k];
          numerator += (target.values[k] - first.values[k]) * delta;
          denominator += delta * delta;
        }
        const weight = denominator ? Math.max(0, Math.min(1, numerator / denominator)) : 0;
        let distanceSquared = 0;
        for (let k = 0; k < 25; k += 1) {
          const residual = first.values[k] + weight * (second.values[k] - first.values[k]) - target.values[k];
          distanceSquared += residual * residual;
        }
        const names = [first.name, second.name].sort();
        const key = JSON.stringify(names);
        const prior = pairScores.get(key);
        if (!prior || distanceSquared < prior.distanceSquared) {
          pairScores.set(key, { names, distanceSquared });
        }
      }
    }
    const selected = new Set([...nearest].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
      .slice(0, 6).map(([name]) => name));
    for (const { names } of [...pairScores.values()].sort((a, b) =>
      a.distanceSquared - b.distanceSquared)) {
      if (selected.size === 12) break;
      if (selected.size + names.filter((name) => !selected.has(name)).length > 12) continue;
      names.forEach((name) => selected.add(name));
    }
    return fitAdmixture(target, references.filter((row) => selected.has(groupName(row))),
      groupLimit, "modern");
  }

  const api = { selectModernPca, rankModernPcas, buildMixedPca, fitMixedPca, isIstanbulReference };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.G25ModernPca = api;
    root.G25ModernPcaModule = G25ModernPcaModule;
  }
}
G25ModernPcaModule(typeof window !== "undefined" ? window : globalThis);
