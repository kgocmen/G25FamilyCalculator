(function (root) {
  "use strict";

  function init(getContext) {
    const actions = document.getElementById("analyse-export-actions");
    const button = document.getElementById("analyse-export");
    const status = document.getElementById("analyse-export-status");
    let worker = null, rejectPending = null, request = 0, busy = false, targetKey = "";
    const key = (target) => target ? JSON.stringify([target.label, target.values]) : "";

    function cancel() {
      request += 1;
      if (worker) worker.terminate();
      worker = null;
      if (rejectPending) rejectPending(new Error("PDF export cancelled."));
      rejectPending = null;
      busy = false;
      targetKey = "";
      status.textContent = "";
    }

    function update(active) {
      const target = getContext().target;
      if (busy && (!active || key(target) !== targetKey)) cancel();
      actions.hidden = !active;
      button.disabled = !active || !target || busy;
    }

    function calculateFits(target, references) {
      return new Promise((resolve, reject) => {
        try {
          const current = new Worker(new URL("report_analysis_worker.js?v=20261111-1", document.baseURI));
          worker = current;
          rejectPending = reject;
          current.onmessage = ({ data }) => {
            if (current !== worker) return;
            if (data.type === "progress") status.textContent = data.message;
            if (data.type === "result" || data.type === "error") {
              current.terminate();
              worker = null;
              rejectPending = null;
              if (data.type === "error") reject(new Error(data.message));
              else resolve(data.fits);
            }
          };
          current.onerror = () => {
            if (current !== worker) return;
            current.terminate();
            worker = null;
            rejectPending = null;
            reject(new Error("Background PDF analysis could not finish."));
          };
          current.postMessage({ target, references });
        } catch (error) {
          worker = null;
          rejectPending = null;
          reject(error);
        }
      });
    }

    button.addEventListener("click", async () => {
      if (button.disabled) return;
      const context = getContext();
      const target = { label: context.target.label, values: context.target.values.slice() };
      const references = context.references.map((row) => row.slice());
      const currentRequest = ++request;
      busy = true;
      targetKey = key(target);
      button.disabled = true;
      status.textContent = "Preparing Analyse PDF…";
      try {
        const analysisFits = await calculateFits(target, references);
        if (currentRequest !== request) return;
        const report = root.G25ReportPdf.buildAnalyseReport({ target, references, analysisFits,
          referenceLabel: context.referenceLabel });
        const pdf = root.G25ReportPdf.createPdf(report);
        const url = URL.createObjectURL(pdf);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${target.label.replace(/[^a-zA-Z0-9_-]/g, "_")}_analyse.pdf`;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        status.textContent = "Analyse PDF downloaded.";
      } catch (error) {
        if (currentRequest === request) status.textContent = `PDF export failed: ${error.message}`;
      } finally {
        if (currentRequest === request) {
          busy = false;
          targetKey = "";
          update(true);
        }
      }
    });

    update(false);
    return { update, cancel };
  }

  root.G25AnalysePdfUI = { init };
})(typeof window === "undefined" ? globalThis : window);
