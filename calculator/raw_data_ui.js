(function () {
  "use strict";
  window.G25RawDataUI = { init };

  function init(onAnalyse, getReportReferences = () => ({ rows: window.G25_REFERENCES || [], label: "Global references" })) {
    const $ = (id) => document.getElementById(id);
    let worker = null, results = {}, g25 = null, healthResult = null;
    let reportWorker = null, reportReject = null, reportRequest = 0;
    const modelIds = ["k12b", "k36"], settledModels = new Set(), copyTimers = new WeakMap();
    const tabIds = [...modelIds, "health"];
    let selectedModel = "k12b";
    const cleanName = () => ($("raw-sample-name").value.trim() || "Sample").replace(/[\r\n,\t]/g, "_").slice(0, 120);
    const line = () => `${cleanName()}_simulated_scaled,${g25.map((v) => v.toFixed(6)).join(",")}`;
    const message = (text) => { $("raw-status").textContent = text; $("raw-status").hidden = !text; };

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
      results = {}; g25 = null; healthResult = null;
      settledModels.clear();
      $("raw-model-results").hidden = false;
      for (const id of ["raw-g25", "raw-summary"]) $(id).hidden = true;
      selectModel("k12b");
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
      $(prefix + "-status").textContent = `${data.stats.matched.toLocaleString()} / ${data.stats.total.toLocaleString()} SNPs used (${(data.stats.coverage * 100).toFixed(1)}%). ` +
        (data.fit.converged ? `Fit converged in ${data.fit.iterations} iterations.` : "Fit did not converge; proportions are provisional and G25 is unavailable.") +
        (low ? " Low SNP coverage: results may be unstable." : "") +
        ` ${data.stats.flipped.toLocaleString()} strand complements; ${data.stats.incompatible.toLocaleString()} incompatible calls excluded.`;
      if (data.id === "k12b") {
        window.G25K12BUI?.setProfile(data.fit.proportions);
      }
      else {
        window.G25AdmixtureCharts.render({
          chart: $("raw-k36-chart"), table: $("raw-k36-table"),
          components: data.components, values: data.fit.proportions,
        });
      }
      for (const format of ["row", "table"]) {
        const button = $(prefix + "-copy-" + format);
        button.disabled = false;
        if (data.id === "k12b") button.hidden = false;
      }
      if (data.g25) {
        g25 = data.g25;
        $("raw-g25").hidden = false;
        $("raw-g25-line").value = line();
      } else if (data.id === "k36" && data.regressionError) {
        $(prefix + "-status").textContent += ` G25 regression unavailable: ${data.regressionError}`;
      }
    }
    $("raw-file").addEventListener("change", () => {
      clearResults();
      const file = $("raw-file").files[0];
      if (file && !$("raw-sample-name").value) $("raw-sample-name").value = file.name.replace(/\.[^.]+$/, "").slice(0, 120);
      busy(false);
      message(file ? `${file.name} selected. Ready to calculate.` : "");
    });
    $("raw-sample-name").addEventListener("input", () => { if (g25) $("raw-g25-line").value = line(); });
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
        worker = new Worker(new URL("raw_dna_worker.js?v=20261111-10", document.baseURI));
        const current = worker;
        busy(true); message("Starting local DNA analysis…");
        for (const id of modelIds) $("raw-" + id + "-status").textContent = `Calculating ${id === "k36" ? "K36" : "K12b"}…`;
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
          if (data.type === "health") {
            healthResult = { matches: data.matches, bloodType: data.bloodType };
            window.G25HealthUI?.setMatches(data.matches, data.bloodType);
          }
          if (data.type === "model-error") {
            settledModels.add(data.id);
            showModels();
            $("raw-" + data.id + "-status").textContent = data.message;
          }
          if (data.type === "error") { cancel(); stopPendingModels("Calculation stopped."); message(data.message); }
          if (data.type === "done") {
            cancel();
            $("raw-export").disabled = !results.k12b && !results.k36 && !healthResult;
            const complete = results.k36?.fit.converged && results.k12b?.fit.converged && g25;
            message(complete ? "Analysis complete. Your DNA stayed in this browser." : "Processing finished. Review the result notes below.");
          }
        };
        worker.onerror = () => { cancel(); stopPendingModels("Calculation stopped."); message("The DNA worker could not finish. Reload the page and try again."); };
        worker.postMessage({ file });
      } catch (error) { cancel(); message(error.message); }
    });
    $("raw-cancel").addEventListener("click", () => { cancel(); stopPendingModels("Calculation cancelled."); message("Calculation cancelled. Completed results remain below."); });
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
    $("raw-g25-copy").addEventListener("click", (event) => copy(line(), event.currentTarget));
    $("raw-analyse").addEventListener("click", () => onAnalyse({ label: `${cleanName()}_simulated_scaled`, values: g25.slice(), source: "raw-regression" }));
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
        const target = g25 ? { label: `${sample}_simulated_scaled`, values: g25.slice() } : null;
        message("Preparing PDF report…");
        const analysisFits = target ? await calculateReportFits(target, references) : null;
        if (request !== reportRequest) return;
        const report = window.G25ReportPdf.buildReport({ sample, results, g25,
          health: healthResult, references, analysisFits, referenceLabel: source.label });
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
