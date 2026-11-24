"use strict";
importScripts("raw_dna.js?v=20261123-2", "k12b_engine.js?v=20261115-1", "g25_direct.js?v=20261124-1");
importScripts("health_data.js?v=20261111-9", "health.js?v=20261111-5");

self.onmessage = async ({ data }) => {
  const send = (type, payload = {}) => self.postMessage({ type, ...payload });
  try {
    if (!data.file || !data.file.size || data.file.size > 100 * 1024 * 1024) throw new Error("Choose a nonempty DNA file smaller than 100 MB.");
    send("status", { message: "Reading DNA SNP calls…" });
    const rawText = await G25RawDNA.readRawText(data.file);
    const { calls, reportedCalls, special, stats } = G25RawDNA.parse(rawText);
    send("parsed", { stats });
    send("health", { matches: G25Health.matchCalls(calls, special),
      bloodType: G25Health.inferBloodType(calls, special) });
    const readJson = async (file) => {
      const response = await fetch(new URL(`raw_data/${file}`, self.location.href), { cache: "no-cache" });
      if (!response.ok) throw new Error(`Could not load ${file}. Check your connection and try again.`);
      return response.json();
    };
    const manifest = await readJson("manifest.json");
    for (const id of ["k12b", "k36"]) {
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
        const engine = id === "k12b" ? G25K12bEngine : G25RawDNA;
        const matched = engine.match(id === "k12b" ? reportedCalls : calls, model);
        send("coverage", { id, stats: matched.stats });
        if (matched.stats.matched < 10000) throw new Error(`${title}: only ${matched.stats.matched.toLocaleString()} usable model SNPs matched. At least 10,000 are required; check that this is a complete MyHeritage or AncestryDNA export.`);
        send("status", { message: `Fitting ${title} to ${matched.stats.matched.toLocaleString()} SNPs…` });
        const fit = engine.fit(matched, ({ iteration }) => send("status", {
          message: `Fitting ${title} · iteration ${iteration.toLocaleString()}…`,
        }));
        let g25 = null, regression = null, regressionError = null;
        if (id === "k36" && fit.converged) {
          try {
            if (!manifest.regression?.file) throw new Error("The regression manifest is outdated. Reload the page and try again.");
            regression = await readJson(manifest.regression.file);
            if (regression.id !== manifest.regression.id) throw new Error("The regression version does not match its manifest. Reload the page.");
            g25 = G25RawDNA.regress(fit.proportions, regression, info.components);
          } catch (error) { regressionError = error.message; }
        }
        send("result", { id, components: info.components, fit, stats: matched.stats, g25,
          regression: regression ? { id: regression.id, name: regression.name, source: regression.source,
            sourceSha256: regression.sourceSha256, input: regression.input, output: regression.output,
            method: regression.method, validation: regression.validation } : null, regressionError });
      } catch (error) { send("model-error", { id, message: error.message }); }
    }
    if (manifest.directBlend?.enabled === true) {
      try {
        const info = manifest.directBlend;
        if (!info?.file) throw new Error("The G25 kgocmen algorithm model is unavailable.");
        if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot decompress the G25 kgocmen algorithm model.");
        send("status", { message: `Loading G25 kgocmen algorithm model (${(info.bytes / 1048576).toFixed(1)} MB)…` });
        const modelUrl = new URL(`raw_data/${info.file}`, self.location.href);
        if (info.sha256) modelUrl.searchParams.set("v", info.sha256.slice(0, 16));
        const response = await fetch(modelUrl);
        if (!response.ok) throw new Error("Could not load the G25 kgocmen algorithm model.");
        const compressed = await response.arrayBuffer();
        if (self.crypto?.subtle) {
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", compressed)),
            (v) => v.toString(16).padStart(2, "0")).join("");
          if (hash !== info.sha256) throw new Error("The G25 kgocmen algorithm model failed its integrity check.");
        }
        const buffer = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
        const model = G25Direct.decode(buffer);
        if (model.n !== info.snps) throw new Error("G25 kgocmen algorithm model metadata does not match.");
        send("status", { message: "Projecting G25 kgocmen algorithm coordinates…" });
        const positionCalls = G25RawDNA.matchPositionCalls(rawText, model, calls);
        const blend = G25Direct.predict(calls, model, positionCalls);
        if (blend.coverage < info.minCoverage) {
          throw new Error(`G25 kgocmen algorithm requires ${Math.round(info.minCoverage * 100)}% of its SNP markers; this file matched ${(blend.coverage * 100).toFixed(1)}%.`);
        }
        send("g25-blend", { g25: blend.values, matched: blend.matched, total: model.n });
      } catch (error) { send("g25-blend-error", { message: error.message }); }
    }
    calls.clear();
    reportedCalls.clear();
    special.clear();
    send("done");
  } catch (error) { send("error", { message: error.message || "Raw DNA processing failed." }); }
};
