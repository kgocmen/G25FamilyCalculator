(function () {
  "use strict";
  window.G25RawDataUI = { init };

  function init(onAnalyse) {
    const $ = (id) => document.getElementById(id);
    let worker = null, results = {}, inputStats = null, g25 = null;
    const cleanName = () => ($("raw-sample-name").value.trim() || "Sample").replace(/[\r\n,\t]/g, "_").slice(0, 120);
    const line = () => `${cleanName()}_simulated_scaled,${g25.map((v) => v.toFixed(6)).join(",")}`;
    const message = (text) => { $("raw-status").textContent = text; };

    function busy(value) {
      $("raw-run").disabled = value || !$("raw-file").files.length;
      $("raw-file").disabled = value;
      $("raw-cancel").hidden = !value;
      $("raw-progress").hidden = !value;
      $("raw-workspace").setAttribute("aria-busy", String(value));
    }
    function clearResults() {
      results = {}; inputStats = null; g25 = null;
      for (const id of ["raw-k36", "raw-k12b", "raw-g25", "raw-summary"]) $(id).hidden = true;
      for (const id of ["k36", "k12b"]) {
        $("raw-" + id + "-status").textContent = "";
        $("raw-" + id + "-components").replaceChildren();
        $("raw-" + id + "-copy").disabled = true;
      }
      $("raw-g25-line").value = "";
      $("raw-export").disabled = true;
    }
    function cancel() {
      if (worker) worker.terminate();
      worker = null;
      busy(false);
    }
    function reset() {
      cancel(); clearResults();
      $("raw-file").value = "";
      $("raw-sample-name").value = "";
      busy(false);
      message("Choose your extracted MyHeritage CSV or TXT file to begin.");
    }
    function profile(id) {
      const result = results[id];
      return result.components.map((name, i) => `${name}\t${(result.fit.proportions[i] * 100).toFixed(4)}`).join("\n");
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
        button.textContent = "Copied";
        setTimeout(() => { button.textContent = "Copy"; }, 1800);
      } catch (_) { message("Clipboard access was blocked. Select the G25 row to copy it, or download the results."); }
    }
    function showResult(data) {
      results[data.id] = data;
      const prefix = "raw-" + data.id;
      $(prefix).hidden = false;
      const low = data.stats.matched < 40000;
      $(prefix + "-status").textContent = `${data.stats.matched.toLocaleString()} / ${data.stats.total.toLocaleString()} SNPs used (${(data.stats.coverage * 100).toFixed(1)}%). ` +
        (data.fit.converged ? `Fit converged in ${data.fit.iterations} iterations.` : "Fit did not converge; proportions are provisional and G25 is unavailable.") +
        (low ? " Low SNP coverage: results may be unstable." : "") +
        ` ${data.stats.flipped.toLocaleString()} strand complements; ${data.stats.incompatible.toLocaleString()} incompatible calls excluded.`;
      const fragment = document.createDocumentFragment();
      data.components.forEach((component, i) => {
        const row = document.createElement("div"); row.className = "raw-component";
        const label = document.createElement("span"); label.textContent = component.replaceAll("_", " ");
        const value = document.createElement("strong"); value.textContent = (data.fit.proportions[i] * 100).toFixed(2) + "%";
        const bar = document.createElement("span"); bar.className = "raw-component-bar"; bar.setAttribute("aria-hidden", "true");
        bar.style.width = (data.fit.proportions[i] * 100).toFixed(3) + "%";
        row.append(label, value, bar); fragment.append(row);
      });
      $(prefix + "-components").replaceChildren(fragment);
      $(prefix + "-copy").disabled = false;
      $("raw-export").disabled = false;
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
      message(file ? `${file.name} selected. Ready to calculate.` : "Choose your extracted MyHeritage CSV or TXT file to begin.");
    });
    $("raw-sample-name").addEventListener("input", () => { if (g25) $("raw-g25-line").value = line(); });
    $("raw-run").addEventListener("click", () => {
      cancel(); clearResults();
      const file = $("raw-file").files[0];
      if (!file) return;
      if (!/\.(csv|txt|tsv)$/i.test(file.name)) { message("Extract the MyHeritage ZIP first, then choose its CSV or TXT file."); return; }
      if (!file.size || file.size > 100 * 1024 * 1024) { message("Choose a nonempty CSV or TXT file smaller than 100 MB."); return; }
      if (typeof Worker === "undefined" || location.protocol === "file:") {
        message("Open this calculator through its hosted site or a local web server to process raw DNA."); return;
      }
      try {
        worker = new Worker(new URL("raw_dna_worker.js?v=20261024-1", document.baseURI));
        const current = worker;
        busy(true); message("Starting local DNA analysis…");
        worker.onmessage = ({ data }) => {
          if (current !== worker) return;
          if (data.type === "status") message(data.message);
          if (data.type === "parsed") {
            inputStats = data.stats;
            $("raw-summary").hidden = false;
            $("raw-summary").textContent = `${data.stats.usable.toLocaleString()} unique autosomal calls · build ${data.stats.build} · ` +
              `${data.stats.noCalls.toLocaleString()} no-calls/indels · ${data.stats.nonAutosomal.toLocaleString()} non-autosomal rows skipped · ` +
              `${data.stats.invalid.toLocaleString()} invalid rows · ${data.stats.duplicates.toLocaleString()} duplicates (${data.stats.conflicts.toLocaleString()} conflicting SNPs excluded).`;
          }
          if (data.type === "result") showResult(data);
          if (data.type === "model-error") {
            $("raw-" + data.id).hidden = false;
            $("raw-" + data.id + "-status").textContent = data.message;
          }
          if (data.type === "error") { cancel(); message(data.message); }
          if (data.type === "done") {
            cancel();
            const complete = results.k36?.fit.converged && results.k12b?.fit.converged && g25;
            message(complete ? "Analysis complete. Your DNA stayed in this browser." : "Processing finished. Review the result notes below.");
          }
        };
        worker.onerror = () => { cancel(); message("The DNA worker could not finish. Reload the page and try again."); };
        worker.postMessage({ file });
      } catch (error) { cancel(); message(error.message); }
    });
    $("raw-cancel").addEventListener("click", () => { cancel(); message("Calculation cancelled. Completed results remain below."); });
    $("raw-reset").addEventListener("click", reset);
    for (const id of ["k36", "k12b"]) $("raw-" + id + "-copy").addEventListener("click", (event) => copy(profile(id), event.currentTarget));
    $("raw-g25-copy").addEventListener("click", (event) => copy(line(), event.currentTarget));
    $("raw-analyse").addEventListener("click", () => onAnalyse({ label: `${cleanName()}_simulated_scaled`, values: g25.slice(), source: "raw-regression" }));
    $("raw-export").addEventListener("click", () => {
      const result = { sample: cleanName(), method: "fixed-frequency maximum likelihood; K36 to scaled G25 ordinary least squares",
        simulated: true, inputStats, results, g25: g25 ? line() : null };
      const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url;
      link.download = `${cleanName().replace(/[^a-zA-Z0-9_-]/g, "_")}_ancestry.json`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    reset();
    return { reset };
  }
})();
