function G25ClustersModule(root) {
  "use strict";

  const DIMENSIONS = 25;
  const squaredDistance = (first, second) => {
    let sum = 0;
    for (let dimension = 0; dimension < DIMENSIONS; dimension += 1) {
      const difference = first[dimension] - second[dimension];
      sum += difference * difference;
    }
    return sum;
  };

  function fitClusters(references, k) {
    const values = references.map((row) => Array.isArray(row) ? row.slice(2) : row.values);
    if (!values.length || values.some((point) => !Array.isArray(point) ||
      point.length !== DIMENSIONS || point.some((value) => !Number.isFinite(value)))) {
      throw new Error("Clustering needs valid G25 references.");
    }
    if (!Number.isInteger(k) || k < 1 || k > Math.min(10, values.length)) {
      throw new Error("Choose between 1 and 10 clusters, with at least one population per cluster.");
    }

    // Farthest-first seeds are repeatable and spread initial centres across the references.
    const seeds = [0];
    while (seeds.length < k) {
      let best = -1;
      let bestDistance = -1;
      for (let index = 0; index < values.length; index += 1) {
        if (seeds.includes(index)) continue;
        const nearest = Math.min(...seeds.map((seed) => squaredDistance(values[index], values[seed])));
        if (nearest > bestDistance) {
          bestDistance = nearest;
          best = index;
        }
      }
      seeds.push(best);
    }
    let centroids = seeds.map((index) => [...values[index]]);
    let assignments = Array(values.length).fill(-1);
    for (let iteration = 0; iteration < 60; iteration += 1) {
      const next = values.map((point, index) => {
        let best = assignments[index] >= 0 ? assignments[index] : 0;
        let bestDistance = squaredDistance(point, centroids[best]);
        for (let cluster = 0; cluster < k; cluster += 1) {
          const distance = squaredDistance(point, centroids[cluster]);
          if (distance < bestDistance - 1e-15) {
            best = cluster;
            bestDistance = distance;
          }
        }
        return best;
      });
      const counts = Array(k).fill(0);
      for (const cluster of next) counts[cluster] += 1;
      for (let empty = 0; empty < k; empty += 1) {
        if (counts[empty]) continue;
        let donor = -1;
        let furthest = -1;
        for (let index = 0; index < values.length; index += 1) {
          if (counts[next[index]] <= 1) continue;
          const distance = squaredDistance(values[index], centroids[next[index]]);
          if (distance > furthest) {
            furthest = distance;
            donor = index;
          }
        }
        counts[next[donor]] -= 1;
        next[donor] = empty;
        counts[empty] += 1;
      }
      const sums = Array.from({ length: k }, () => Array(DIMENSIONS).fill(0));
      for (let index = 0; index < values.length; index += 1) {
        for (let dimension = 0; dimension < DIMENSIONS; dimension += 1) {
          sums[next[index]][dimension] += values[index][dimension];
        }
      }
      const newCentroids = sums.map((sum, cluster) => sum.map((value) => value / counts[cluster]));
      const stable = next.every((cluster, index) => cluster === assignments[index]);
      assignments = next;
      centroids = newCentroids;
      if (stable) break;
    }
    const clusters = centroids.map((centroid, cluster) => {
      const members = assignments.flatMap((assignment, index) => assignment === cluster ? [index] : []);
      let representativeIndex = members[0];
      for (const index of members) {
        if (squaredDistance(values[index], centroid) <
          squaredDistance(values[representativeIndex], centroid) - 1e-15) representativeIndex = index;
      }
      return { centroid, size: members.length, representativeIndex,
        representativeDistance: Math.sqrt(squaredDistance(values[representativeIndex], centroid)) * 100 };
    });
    const inertia = values.reduce((sum, point, index) =>
      sum + squaredDistance(point, centroids[assignments[index]]), 0);
    return { k, assignments, clusters, inertia };
  }

  function chooseElbow(fits) {
    if (!fits.length) return null;
    if (fits.length === 1) return fits[0].k;
    const start = fits[0].inertia;
    const end = fits[fits.length - 1].inertia;
    if (start - end <= Math.max(1e-15, start * 1e-10)) return fits[0].k;
    if (fits.length === 2) return fits[1].k;
    let best = fits[0].k;
    let bend = 0;
    for (let index = 1; index < fits.length - 1; index += 1) {
      const linear = 1 - index / (fits.length - 1);
      const remaining = (fits[index].inertia - end) / (start - end);
      const score = linear - remaining;
      if (score > bend + 1e-12) {
        bend = score;
        best = fits[index].k;
      }
    }
    return best;
  }

  function clusterSeries(references) {
    const fits = Array.from({ length: Math.min(10, references.length) }, (_, index) =>
      fitClusters(references, index + 1));
    return { fits, defaultK: chooseElbow(fits) };
  }

  const api = { fitClusters, chooseElbow, clusterSeries };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.G25Clusters = api;
    root.G25ClustersModule = G25ClustersModule;
  }
}
G25ClustersModule(typeof window !== "undefined" ? window : globalThis);
