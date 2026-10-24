"use strict";
importScripts("raw_dna.js?v=20261024-1");

self.onmessage = async ({ data }) => {
  const send = (type, payload = {}) => self.postMessage({ type, ...payload });
  try {
    if (!data.file || data.file.size > 100 * 1024 * 1024) throw new Error("Choose an extracted CSV or TXT file smaller than 100 MB.");
    send("status", { message: "Reading MyHeritage SNP calls…" });
    const { calls, stats } = G25RawDNA.parse(await data.file.text());
    send("parsed", { stats });
    const readJson = async (file) => {
      const response = await fetch(new URL(`raw_data/${file}`, self.location.href));
      if (!response.ok) throw new Error(`Could not load ${file}. Check your connection and try again.`);
      return response.json();
    };
    const manifest = await readJson("manifest.json");
    for (const id of ["k36", "k12b"]) {
      const title = id === "k36" ? "K36" : "K12b";
      try {
        const info = manifest.models[id];
        send("status", { message: `Loading ${title} reference model (${(info.bytes / 1048576).toFixed(1)} MB)…` });
        if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot decompress reference models. Use a current browser.");
        // All requests load public assets from this site. Personal DNA stays in this worker.
        const response = await fetch(new URL(`raw_data/${id}.bin.gz`, self.location.href));
        if (!response.ok) throw new Error(`Could not load the ${title} reference model. Check your connection and try again.`);
        const compressed = await response.arrayBuffer();
        if (self.crypto?.subtle) {
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", compressed)),
            (v) => v.toString(16).padStart(2, "0")).join("");
          if (hash !== info.sha256) throw new Error(`The ${title} model failed its integrity check. Reload the page and retry.`);
        }
        const buffer = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
        const model = G25RawDNA.decodeModel(buffer);
        if (model.n !== info.snps || model.k !== info.components.length) throw new Error(`${title} model metadata does not match.`);
        const matched = G25RawDNA.match(calls, model);
        send("coverage", { id, stats: matched.stats });
        if (matched.stats.matched < 10000) throw new Error(`${title}: only ${matched.stats.matched.toLocaleString()} usable model SNPs matched. At least 10,000 are required; check that this is a complete MyHeritage export.`);
        send("status", { message: `Fitting ${title} to ${matched.stats.matched.toLocaleString()} SNPs…` });
        const fit = G25RawDNA.fit(matched, ({ iteration }) => send("status", {
          message: `Fitting ${title} · iteration ${iteration.toLocaleString()}…`,
        }));
        let g25 = null, regression = null, regressionError = null;
        if (id === "k36" && fit.converged) {
          try {
            regression = await readJson("k36_g25.json");
            g25 = G25RawDNA.regress(fit.proportions, regression, info.components);
          } catch (error) { regressionError = error.message; }
        }
        send("result", { id, components: info.components, fit, stats: matched.stats, g25,
          regression: regression ? { id: regression.id, validation: regression.validation } : null, regressionError });
      } catch (error) { send("model-error", { id, message: error.message }); }
    }
    calls.clear();
    send("done");
  } catch (error) { send("error", { message: error.message || "Raw DNA processing failed." }); }
};
