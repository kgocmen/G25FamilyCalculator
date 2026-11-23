(function () {
  "use strict";
  window.G25RawDataUI = { init };

  function init(onAnalyse, getReportReferences = () => ({ rows: window.G25_REFERENCES || [], label: "Global references" })) {
    const $ = (id) => document.getElementById(id);
    let worker = null, results = {}, g25 = null, regressionG25 = null, blendG25 = null, healthResult = null;
    let preferredG25Source = "regression";
    let reportWorker = null, reportReject = null, reportRequest = 0;
    const modelIds = ["k12b", "k36"], settledModels = new Set(), copyTimers = new WeakMap();
    const tabIds = ["g25", ...modelIds, "health"];
    let selectedModel = "g25";
    const cleanName = () => ($("raw-sample-name").value.trim() || "Sample").replace(/[\r\n,\t]/g, "_").slice(0, 120);
    const line = (values, suffix = "simulated_scaled") => `${cleanName()}_${suffix},${values.map((v) => v.toFixed(6)).join(",")}`;
    const message = (text) => { $("raw-status").textContent = text; $("raw-status").hidden = !text; };
    const g25Suffix = () => g25 === blendG25 ? "kgocmen_scaled" : "simulated_scaled";

    function updateG25Selection() {
      const useBoth = preferredG25Source === "both" && Boolean(regressionG25 && blendG25);
      const useBlend = preferredG25Source === "blend" ? Boolean(blendG25) : !regressionG25 && Boolean(blendG25);
      const useNone = preferredG25Source === "none";
      g25 = useNone ? null : useBlend ? blendG25 : regressionG25 || blendG25;
      $("raw-g25-source").value = useNone ? "none" : useBoth ? "both" : useBlend ? "blend" : "regression";
      $("raw-g25-source").disabled = !regressionG25 && !blendG25;
      $("raw-g25-source-regression").disabled = !regressionG25;
      $("raw-g25-source-blend").disabled = !blendG25;
      $("raw-g25-source-both").disabled = !regressionG25 || !blendG25;
      $("raw-analyse").disabled = !g25;
      $("raw-analyse").textContent = useBoth ? "Compare both" : "Use in Analyse";
    }

    function selectModel(id) {
      selectedModel = id;
      for (const model of tabIds) {
        const active = model === id, tab = $("raw-" + model + "-tab");
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
        $("raw-" + model).hidden = !active;
      }
    }
    function showModels() {
      $("raw-model-results").hidden = false;
      selectModel(selectedModel);
    }
    function stopPendingModels(text) {
      for (const id of modelIds) if (!settledModels.has(id)) $("raw-" + id + "-status").textContent = text;
    }

    function busy(value) {
      $("raw-run").disabled = value || !$("raw-file").files.length;
      $("raw-file").disabled = value;
      $("raw-cancel").hidden = !value;
      $("raw-progress").hidden = !value;
      $("raw-workspace").setAttribute("aria-busy", String(value));
    }
    function clearResults() {
      cancelReport();
      results = {}; g25 = null; regressionG25 = null; blendG25 = null; healthResult = null;
      preferredG25Source = "regression";
      settledModels.clear();
      $("raw-model-results").hidden = false;
      $("raw-summary").hidden = true;
      selectModel("g25");
      for (const id of ["k36", "k12b"]) {
        $("raw-" + id + "-status").textContent = "";
        if (id === "k36") {
          $("raw-k36-chart").replaceChildren();
          $("raw-k36-table").replaceChildren();
        }
        for (const format of ["row", "table"]) {
          const button = $("raw-" + id + "-copy-" + format);
          button.disabled = true;
          if (id === "k12b") button.hidden = true;
        }
      }
      window.G25K12BUI?.reset();
      window.G25HealthUI?.reset();
      $("raw-g25-line").value = "";
      $("raw-g25-line").hidden = true;
      $("raw-g25-copy").disabled = true;
      $("raw-g25-regression-status").textContent = "Calculate raw DNA to see coordinates.";
      $("raw-g25-blend-line").value = "";
      $("raw-g25-blend-line").hidden = true;
      $("raw-g25-blend-copy").disabled = true;
      $("raw-g25-blend-status").textContent = "Temporarily disabled.";
      updateG25Selection();
      $("raw-export").disabled = true;
    }
    function cancel() {
      if (worker) worker.terminate();
      worker = null;
      busy(false);
    }
    function cancelReport() {
      reportRequest += 1;
      if (reportWorker) reportWorker.terminate();
      reportWorker = null;
      if (reportReject) {
        const reject = reportReject;
        reportReject = null;
        reject(new Error("PDF export cancelled."));
      }
    }
    function reset() {
      cancel(); clearResults();
      $("raw-file").value = "";
      $("raw-sample-name").value = "";
      busy(false);
      message("");
    }
    function profile(id, format) {
      const result = results[id];
      if (format === "row") {
        return `${cleanName()}_${id === "k36" ? "K36" : "K12b"},${result.fit.proportions.map((v) => (v * 100).toFixed(4)).join(",")}`;
      }
      return result.components.map((name, i) => {
        const percentage = (result.fit.proportions[i] * 100).toFixed(2);
        return `${name}\t${Number(percentage) === 0 ? "-" : percentage + "%"}`;
      }).join("\n");
    }
    async function copy(text, button) {
      try {
        if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
        else {
          const field = document.createElement("textarea");
          field.value = text; document.body.append(field); field.select();
          const copied = document.execCommand("copy"); field.remove();
          if (!copied) throw new Error("Clipboard access was blocked.");
        }
        const label = button.dataset.copyLabel || button.textContent;
        button.dataset.copyLabel = label;
        clearTimeout(copyTimers.get(button));
        button.textContent = "Copied";
        copyTimers.set(button, setTimeout(() => { button.textContent = label; }, 1800));
      } catch (_) { message("Clipboard access was blocked. Select the G25 row to copy it, or download the results."); }
    }
    function showResult(data) {
      results[data.id] = data;
      settledModels.add(data.id);
      const prefix = "raw-" + data.id;
      showModels();
      const low = data.stats.matched < 40000;
      const compatibleK12b = data.id === "k12b" && data.fit.method?.startsWith("turkish-genomics-k12b-");
      $(prefix + "-status").textContent = `${data.stats.matched.toLocaleString()} / ${data.stats.total.toLocaleString()} SNPs used (${(data.stats.coverage * 100).toFixed(1)}%). ` +
        (data.fit.converged ? (compatibleK12b ? `Completed in ${data.fit.iterations} iterations.` :
          `Fit converged in ${data.fit.iterations} iterations.`) : "Fit did not converge; proportions are provisional and G25 is unavailable.") +
        (low ? " Low SNP coverage: results may be unstable." : "") +
        (compatibleK12b ? ` ${data.stats.partial.toLocaleString()} SNPs used one reported allele; ${data.stats.incompatible.toLocaleString()} calls had no matching alleles.` :
          ` ${data.stats.flipped.toLocaleString()} strand complements; ${data.stats.incompatible.toLocaleString()} incompatible calls excluded.`);
      if (data.id === "k12b") {
        window.G25K12BUI?.setProfile(data.fit.proportions);
      }
      else {
        window.G25AdmixtureCharts.render({
          chart: $("raw-k36-chart"), table: $("raw-k36-table"),
          components: data.components, values: data.fit.proportions, descending: true,
        });
      }
      for (const format of ["row", "table"]) {
        const button = $(prefix + "-copy-" + format);
        button.disabled = false;
        if (data.id === "k12b") button.hidden = false;
      }
      if (data.g25) {
        regressionG25 = data.g25;
        $("raw-g25-line").value = line(regressionG25);
        $("raw-g25-line").hidden = false;
        $("raw-g25-copy").disabled = false;
        $("raw-g25-regression-status").textContent = "Estimated from K36 proportions.";
        updateG25Selection();
      } else if (data.id === "k36" && data.regressionError) {
        $(prefix + "-status").textContent += ` G25 regression unavailable: ${data.regressionError}`;
        $("raw-g25-regression-status").textContent = `G25 regression unavailable: ${data.regressionError}`;
      } else if (data.id === "k36") {
        $("raw-g25-regression-status").textContent = "K36 did not converge; regression G25 is unavailable.";
      }
    }
    $("raw-file").addEventListener("change", () => {
      cancel();
      clearResults();
      const file = $("raw-file").files[0];
      $("raw-sample-name").value = file ? file.name.replace(/\.[^.]+$/, "").slice(0, 120) : "";
      busy(false);
      message(file ? `${file.name} selected. Ready to calculate.` : "");
    });
    $("raw-sample-name").addEventListener("input", () => {
      if (regressionG25) $("raw-g25-line").value = line(regressionG25);
      if (blendG25) $("raw-g25-blend-line").value = line(blendG25, "kgocmen_scaled");
    });
    $("raw-run").addEventListener("click", () => {
      cancel(); clearResults();
      const file = $("raw-file").files[0];
      if (!file) return;
      if (!/\.(csv|txt|tsv|zip)$/i.test(file.name)) { message("Choose a MyHeritage or AncestryDNA ZIP, CSV, or TXT file."); return; }
      if (!file.size || file.size > 100 * 1024 * 1024) { message("Choose a nonempty DNA file smaller than 100 MB."); return; }
      if (typeof Worker === "undefined" || location.protocol === "file:") {
        message("Open this calculator through its hosted site or a local web server to process raw DNA."); return;
      }
      try {
        worker = new Worker(new URL("raw_dna_worker.js?v=20261123-6", document.baseURI));
        const current = worker;
        busy(true); message("Starting local DNA analysis…");
        for (const id of modelIds) $("raw-" + id + "-status").textContent = `Calculating ${id === "k36" ? "K36" : "K12b"}…`;
        $("raw-g25-regression-status").textContent = "Calculating K36 regression…";
        $("raw-g25-blend-status").textContent = "Temporarily disabled.";
        worker.onmessage = ({ data }) => {
          if (current !== worker) return;
          if (data.type === "status") message(data.message);
          if (data.type === "parsed") {
            $("raw-summary").hidden = false;
            $("raw-summary").textContent = `${data.stats.usable.toLocaleString()} unique autosomal calls · build ${data.stats.build} · ` +
              `${data.stats.noCalls.toLocaleString()} no-calls/indels · ${data.stats.nonAutosomal.toLocaleString()} non-autosomal rows skipped · ` +
              `${data.stats.invalid.toLocaleString()} invalid rows · ${data.stats.duplicates.toLocaleString()} duplicates (${data.stats.conflicts.toLocaleString()} conflicting SNPs excluded).`;
          }
          if (data.type === "result") showResult(data);
          if (data.type === "g25-blend") {
            blendG25 = data.g25;
            showModels();
            $("raw-g25-blend-line").value = line(blendG25, "kgocmen_scaled");
            $("raw-g25-blend-line").hidden = false;
            $("raw-g25-blend-copy").disabled = false;
            $("raw-g25-blend-status").textContent = `${data.matched.toLocaleString()} / ${data.total.toLocaleString()} SNPs used.`;
            updateG25Selection();
          }
          if (data.type === "g25-blend-error") $("raw-g25-blend-status").textContent = data.message;
          if (data.type === "health") {
            healthResult = { matches: data.matches, bloodType: data.bloodType };
            window.G25HealthUI?.setMatches(data.matches, data.bloodType);
          }
          if (data.type === "model-error") {
            settledModels.add(data.id);
            showModels();
            $("raw-" + data.id + "-status").textContent = data.message;
            if (data.id === "k36") $("raw-g25-regression-status").textContent = `G25 regression unavailable: ${data.message}`;
          }
          if (data.type === "error") {
            cancel(); stopPendingModels("Calculation stopped.");
            if (!regressionG25) $("raw-g25-regression-status").textContent = "Calculation stopped.";
            if (!blendG25) $("raw-g25-blend-status").textContent = "Temporarily disabled.";
            message(data.message);
          }
          if (data.type === "done") {
            cancel();
            $("raw-export").disabled = !results.k12b && !results.k36 && !healthResult;
            const complete = results.k36?.fit.converged && results.k12b?.fit.converged && (regressionG25 || blendG25);
            message(complete ? "Analysis complete. Your DNA stayed in this browser." : "Processing finished. Review the result notes below.");
          }
        };
        worker.onerror = () => { cancel(); stopPendingModels("Calculation stopped."); message("The DNA worker could not finish. Reload the page and try again."); };
        worker.postMessage({ file });
      } catch (error) { cancel(); message(error.message); }
    });
    $("raw-cancel").addEventListener("click", () => {
      cancel(); stopPendingModels("Calculation cancelled.");
      if (!regressionG25) $("raw-g25-regression-status").textContent = "Calculation cancelled.";
      if (!blendG25) $("raw-g25-blend-status").textContent = "Temporarily disabled.";
      message("Calculation cancelled. Completed results remain below.");
    });
    $("raw-reset").addEventListener("click", reset);
    for (const id of tabIds) $("raw-" + id + "-tab").addEventListener("click", () => selectModel(id));
    for (const id of modelIds) {
      for (const format of ["row", "table"]) $("raw-" + id + "-copy-" + format).addEventListener("click", (event) => copy(profile(id, format), event.currentTarget));
    }
    $("raw-model-tabs").addEventListener("keydown", (event) => {
      let index = tabIds.indexOf(selectedModel);
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") index = (index + (event.key === "ArrowRight" ? 1 : tabIds.length - 1)) % tabIds.length;
      else if (event.key === "Home") index = 0;
      else if (event.key === "End") index = tabIds.length - 1;
      else return;
      event.preventDefault();
      selectModel(tabIds[index]);
      $("raw-" + selectedModel + "-tab").focus();
    });
    $("raw-g25-copy").addEventListener("click", (event) => { if (regressionG25) copy(line(regressionG25), event.currentTarget); });
    $("raw-g25-blend-copy").addEventListener("click", (event) => { if (blendG25) copy(line(blendG25, "kgocmen_scaled"), event.currentTarget); });
    $("raw-g25-source").addEventListener("change", (event) => {
      preferredG25Source = event.currentTarget.value;
      updateG25Selection();
    });
    $("raw-analyse").addEventListener("click", () => {
      if (!g25) return;
      if ($("raw-g25-source").value === "both") {
        onAnalyse([
          { label: `${cleanName()}_simulated_scaled`, values: regressionG25.slice(), source: "raw-regression" },
          { label: `${cleanName()}_kgocmen_scaled`, values: blendG25.slice(), source: "raw-blend" },
        ]);
        return;
      }
      onAnalyse({ label: `${cleanName()}_${g25Suffix()}`, values: g25.slice(), source: g25 === blendG25 ? "raw-blend" : "raw-regression" });
    });
    function calculateReportFits(target, references) {
      return new Promise((resolve, reject) => {
        try {
          const worker = new Worker(new URL("report_analysis_worker.js?v=20261111-1", document.baseURI));
          reportWorker = worker;
          reportReject = reject;
          worker.onmessage = ({ data }) => {
            if (worker !== reportWorker) return;
            if (data.type === "progress") message(data.message);
            if (data.type === "result" || data.type === "error") {
              worker.terminate();
              reportWorker = null;
              reportReject = null;
              if (data.type === "error") reject(new Error(data.message));
              else resolve(data.fits);
            }
          };
          worker.onerror = () => {
            if (worker !== reportWorker) return;
            worker.terminate();
            reportWorker = null;
            reportReject = null;
            reject(new Error("Background PDF analysis could not finish."));
          };
          worker.postMessage({ target, references });
        } catch (error) { reportWorker = null; reportReject = null; reject(error); }
      });
    }
    $("raw-export").addEventListener("click", async () => {
      if ($("raw-export").disabled) return;
      const request = ++reportRequest;
      $("raw-export").disabled = true;
      try {
        const sample = cleanName();
        const source = getReportReferences();
        const references = source.rows || [];
        const sourceChoice = $("raw-g25-source").value;
        const includeG25 = sourceChoice !== "none";
        const targets = sourceChoice === "both" ? [
          { label: `${sample}_simulated_scaled`, values: regressionG25.slice(), method: "K36 regression" },
          { label: `${sample}_kgocmen_scaled`, values: blendG25.slice(), method: "G25 kgocmen algorithm" },
        ] : g25 ? [{ label: `${sample}_${g25Suffix()}`, values: g25.slice() }] : [];
        message("Preparing PDF report…");
        const profiles = [];
        for (const target of targets) {
          const fits = await calculateReportFits(target, references);
          if (request !== reportRequest) return;
          profiles.push({ ...target, analysisFits: fits });
        }
        if (request !== reportRequest) return;
        const report = window.G25ReportPdf.buildReport({ sample, results,
          g25: profiles[0]?.values, g25Label: profiles[0]?.label,
          g25Profiles: profiles.length > 1 ? profiles : null,
          includeG25, health: healthResult, references,
          analysisFits: profiles[0]?.analysisFits, referenceLabel: source.label });
        const pdf = window.G25ReportPdf.createPdf(report);
        const url = URL.createObjectURL(pdf);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${sample.replace(/[^a-zA-Z0-9_-]/g, "_")}_ancestry.pdf`;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        message("PDF report downloaded. Your DNA stayed in this browser.");
      } catch (error) {
        if (request === reportRequest) message(`PDF export failed: ${error.message}`);
      } finally {
        if (request === reportRequest) $("raw-export").disabled = false;
      }
    });
    reset();
    return { reset };
  }
})();
