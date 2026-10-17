(function () {
  "use strict";

  const globalReferences = window.G25_REFERENCES || [];
  const turkishReferences = window.G25_TURKISH_REFERENCES || [];
  const medievalReferences = window.G25_MEDIEVAL_REFERENCES || { early: [], late: [] };
  let references = globalReferences;
  const core = window.G25Core;
  const names = {
    2: ["Mother", "Father"],
    4: ["Maternal grandparent 1", "Maternal grandparent 2", "Paternal grandparent 1", "Paternal grandparent 2"],
    8: [
      "Maternal grandparent 1 · parent 1", "Maternal grandparent 1 · parent 2",
      "Maternal grandparent 2 · parent 1", "Maternal grandparent 2 · parent 2",
      "Paternal grandparent 1 · parent 1", "Paternal grandparent 1 · parent 2",
      "Paternal grandparent 2 · parent 1", "Paternal grandparent 2 · parent 2",
    ],
  };
  const generation = { 2: "PARENTS", 4: "GRANDPARENTS", 8: "GREAT-GRANDPARENTS" };
  const singular = { 2: "parent", 4: "grandparent", 8: "great_grandparent" };
  const state = {
    mode: 2,
    turkish: false,
    analysisView: "results",
    single: null,
    compare: [null, null],
    offspring: null,
    slots: { 2: Array(2).fill(null), 4: Array(4).fill(null), 8: Array(8).fill(null) },
    selectedIndexByMode: { 2: null, 4: null, 8: null },
    pickerTarget: null,
    output: "",
    metricLimit: 10,
    closestCount: 10,
    relaxedCount: 10,
    strictParentCount: 10,
    strictGrandparentCount: 10,
    male: false,
  };

  const $ = (selector) => document.querySelector(selector);
  const picker = $("#picker");
  let preparedMatches = null;
  let preparedContext = null;
  let mixtureWorker = null;
  let mixtureWorkerUrl = null;
  let mixtureRequest = 0;
  let medievalWorker = null;
  let medievalWorkerUrl = null;
  let medievalRequest = 0;
  let pcaTooltip = null;
  let relaxedFits = { modern: [], ancient: [] };
  let relaxedReady = { modern: false, ancient: false };
  let strictFits = { parents: [], grandparents: [] };
  let strictReady = { parents: false, grandparents: false };
  let suggestionTarget = null;

  function cancelMixtures() {
    mixtureRequest += 1;
    if (mixtureWorker) mixtureWorker.terminate();
    if (mixtureWorkerUrl) URL.revokeObjectURL(mixtureWorkerUrl);
    mixtureWorker = null;
    mixtureWorkerUrl = null;
  }

  function cancelMedieval() {
    medievalRequest += 1;
    if (medievalWorker) medievalWorker.terminate();
    if (medievalWorkerUrl) URL.revokeObjectURL(medievalWorkerUrl);
    if (pcaTooltip) pcaTooltip.remove();
    medievalWorker = null;
    medievalWorkerUrl = null;
    pcaTooltip = null;
  }

  function medievalWorkerMain() {
    self.onmessage = ({ data }) => {
      try {
        const fit = self.G25Medieval.fitAdmixture(data.target, data.references);
        self.postMessage({ requestId: data.requestId, fit });
      } catch (error) {
        self.postMessage({ requestId: data.requestId, error: error.message });
      }
    };
  }

  function mixtureWorkerMain() {
    self.onmessage = ({ data }) => {
      const { requestId, target, modernReferences, references: allReferences } = data;
      const send = (kind, extras = {}) => self.postMessage({ requestId, kind, ...extras });
      try {
        send("relaxedModern", { fits: self.G25Mixtures.estimateRelaxed(target, modernReferences, 100) });
        const ancientReferences = allReferences.filter((row) => row[0] === "ancient");
        send("relaxedAncient", { fits: self.G25Mixtures.estimateRelaxed(target, ancientReferences, 100) });
        let lastProgress = -1;
        const strict = self.G25Mixtures.estimateStrict(target, modernReferences,
          (fits) => send("strictParents", { fits }),
          (value) => {
            if (value !== lastProgress) {
              send("strictProgress", { value });
              lastProgress = value;
            }
          }, 100, (fits) => send("strictGrandparentsUpdate", { fits }));
        send("strictGrandparents", { fits: strict.grandparents });
      } catch (error) {
        send("error", { message: error.message });
      }
    };
  }

  function normalizeSearch(value) {
    return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[_-]+/g, " ").toLocaleLowerCase().trim();
  }

  function makeButton(label, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function setTarget(item) {
    if (state.pickerTarget.type === "single") state.single = item;
    else if (state.pickerTarget.type === "compare") state.compare[state.pickerTarget.index] = item;
    else if (state.pickerTarget.type === "offspring") state.offspring = item;
    else state.slots[state.mode][state.pickerTarget.index] = item;
    picker.close();
    render();
  }

  function updateSelectedReferences(nextReferences) {
    const byName = new Map(nextReferences.map((row) => [`${row[0]}\u0000${row[1]}`, row]));
    const update = (item) => {
      if (!item || item.source !== "reference") return item;
      const row = byName.get(`${item.category}\u0000${item.label}`);
      return row ? { category: row[0], label: row[1], values: row.slice(2), source: "reference" } : null;
    };
    state.single = update(state.single);
    state.compare = state.compare.map(update);
    state.offspring = update(state.offspring);
    for (const mode of [2, 4, 8]) state.slots[mode] = state.slots[mode].map(update);
  }

  function openPicker(target, pasteFirst) {
    state.pickerTarget = target;
    $("#picker-title").textContent = target.type === "single" ? "Add sample coordinates"
      : target.type === "compare" ? `Add ${target.index === 0 ? "A" : "B"} coordinates`
      : target.type === "offspring" ? "Add child coordinates"
        : `Add ${names[state.mode][target.index].toLowerCase()}`;
    $("#reference-search").value = "";
    $("#reference-category").value = "all";
    $("#pasted-line").value = "";
    $("#paste-error").textContent = "";
    renderReferences();
    picker.showModal();
    (pasteFirst ? $("#pasted-line") : $("#reference-search")).focus();
  }

  function createRow(title, target, item, derived, { onCompare = null, selected = false } = {}) {
    const row = document.createElement("div");
    row.className = `person-row${derived && !item ? " derived" : ""}${onCompare ? " selectable" : ""}${selected ? " selected" : ""}`;
    if (onCompare) {
      row.addEventListener("click", (event) => {
        if (!event.target.closest("button")) onCompare();
      });
    }

    const name = document.createElement("div");
    name.className = "person-name";
    name.textContent = title;
    row.append(name);

    const value = document.createElement("div");
    value.className = `person-value${item || derived ? " filled" : ""}`;
    if (derived && !item) {
      const badge = document.createElement("span");
      badge.className = "badge derived-badge";
      badge.textContent = "Calculated";
      value.append(badge, document.createTextNode("G25 coordinates ready"));
    } else if (item) {
      if (item.category) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = item.category;
        value.append(badge);
      }
      value.append(document.createTextNode(item.label));
      value.title = item.label;
    } else {
      value.textContent = "No coordinates selected";
    }
    row.append(value);

    const actions = document.createElement("div");
    actions.className = "row-actions";
    if (onCompare) {
      const compareButton = makeButton("Compare", onCompare);
      compareButton.setAttribute("aria-pressed", String(selected));
      actions.append(compareButton);
    }
    actions.append(
      makeButton("Choose", () => openPicker(target, false)),
      makeButton("Paste", () => openPicker(target, true)),
    );
    if (item || derived) {
      actions.append(makeButton("Copy", (event) => {
        const record = item || derived;
        copyText(core.formatLine(record.label, record.values), event.currentTarget);
      }));
    }
    if (item) {
      actions.append(makeButton("Clear", () => {
        if (target.type === "single") state.single = null;
        else if (target.type === "compare") state.compare[target.index] = null;
        else if (target.type === "offspring") state.offspring = null;
        else state.slots[state.mode][target.index] = null;
        render();
      }));
    }
    row.append(actions);
    return row;
  }

  function render() {
    const mode = state.mode;
    if (mode !== 1) cancelMedieval();
    references = state.turkish ? turkishReferences : globalReferences;
    $("#turkish-toggle").checked = state.turkish;
    $("#analysis-tabs").hidden = mode !== 1 || !state.turkish || !state.single;
    $("#medieval-breakdown-panel").hidden = true;
    $("#closest-count").value = String(state.closestCount);
    $("#closest-count-value").textContent = String(state.closestCount);
    $("#suggestion-count").value = String(state.closestCount);
    $("#suggestion-count-value").textContent = String(state.closestCount);
    document.querySelectorAll(".mode-button").forEach((button) => {
      const active = Number(button.dataset.mode) === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    $("#single-input").hidden = mode !== 1;
    const compareInputs = $("#compare-inputs");
    if (compareInputs) compareInputs.hidden = mode !== 0;
    $("#family-inputs").hidden = mode === 0 || mode === 1;
    $("#result-panel").hidden = mode === 0 || mode === 1;
    $("#single-ancient-matches-group").hidden = true;
    $("#calculated-matches-group").hidden = mode === 1;
    $("#match-filter").hidden = mode === 1;
    $("#analyse-match-filter").hidden = mode !== 1;
    $("#inputs-title").textContent = mode === 1 ? "Analyse" : mode === 0 ? "Compare" : "Family inputs";
    if (mode === 1) {
      $("#suggestions-panel").hidden = true;
      suggestionTarget = null;
      renderSingle();
      return;
    }
    if (mode === 0) {
      renderCompare();
      return;
    }
    cancelMixtures();
    $("#relaxed-estimates-panel").hidden = true;
    $("#parent-estimates-panel").hidden = true;
    $("#grandparent-estimates-panel").hidden = true;
    const ancestors = state.slots[mode];
    const male = (mode === 2 || mode === 4) && state.male;
    const weights = core.ancestorWeights(mode, male);
    const result = core.calculate(state.offspring, ancestors, male);
    const complete = Boolean(state.offspring) && ancestors.every(Boolean);
    const selectedIndex = state.selectedIndexByMode[mode];
    const selectedName = selectedIndex === null ? "child" : names[mode][selectedIndex].toLowerCase();
    const targetComparison = complete
      ? core.calculateComparison(state.offspring, ancestors, selectedIndex, male) : null;
    const select = (index) => {
      state.selectedIndexByMode[mode] = index;
      render();
    };
    const offspringDerived = result.kind === "offspring"
      ? { label: core.resultLabel(state.offspring, ancestors, male), values: result.values } : null;

    $("#offspring-row").replaceChildren(
      createRow("Child", { type: "offspring" }, state.offspring, offspringDerived,
        { onCompare: complete ? () => select(null) : null, selected: complete && selectedIndex === null }),
    );
    $("#generation-label").textContent = generation[mode];
    $("#ancestor-rows").replaceChildren(...ancestors.map((item, index) => {
      const derived = result.kind === "residual" && result.missing.length === 1 && result.missing[0] === index
        ? { label: mode === 2 ? `Estimated_${names[mode][index]}` : `Estimated_${singular[mode]}_${index + 1}`, values: result.inferred } : null;
      return createRow(names[mode][index], { type: "slot", index }, item, derived,
        { onCompare: complete ? () => select(index) : null, selected: complete && selectedIndex === index });
    }));

    $("#male-option").hidden = mode !== 2 && mode !== 4;
    $("#male-toggle").checked = state.male;
    $("#male-weight-note").textContent = mode === 4
      ? male ? "Maternal 25.5% each · Paternal 24.5% each" : "Each grandparent 25%"
      : male ? "Mother 51% · Father 49%" : "Mother 50% · Father 50%";

    let message;
    let output = "";
    if (targetComparison) {
      message = `Comparing entered and calculated ${selectedName}.`;
      output = core.formatLine(targetComparison.calculated.label, targetComparison.calculated.values);
    } else if (result.kind === "offspring") {
      message = "Child calculated.";
      output = core.formatLine(core.resultLabel(state.offspring, ancestors, male), result.values);
    } else if (result.kind === "residual") {
      const count = result.missing.length;
      if (count === 1) {
        const missingIndex = result.missing[0];
        message = `Missing ${names[mode][missingIndex].toLowerCase()} calculated.`;
        output = core.formatLine(core.missingAncestorLabel(state.offspring, ancestors, male), result.inferred);
      } else {
        message = `Combined average of ${count} missing ancestors.`;
        output = core.formatLine(core.resultLabel(state.offspring, ancestors, male), result.combined);
      }
    } else if (state.offspring) {
      message = "Add an ancestor.";
    } else {
      message = "Add the child or ancestors.";
    }
    if (!references.length) message = "Reference data is unavailable. Reload the page.";
    $("#result-title").textContent = result.kind === "residual" && result.missing.length === 1
      ? `Calculated missing ${singular[mode].replaceAll("_", " ")}`
      : result.kind === "residual" ? "Combined missing ancestors" : "Calculated G25 row";
    $("#result-status").textContent = message;
    $("#result-line").value = output;
    $("#copy-result").disabled = !output;
    state.output = output;

    const comparisonText = $("#comparison");
    comparisonText.hidden = !targetComparison;
    if (targetComparison) {
      comparisonText.textContent = `Entered vs calculated ${selectedName}: ${targetComparison.distance.toFixed(3)}.`;
    }

    let methodNote;
    if (result.kind === "residual" && result.missing.length === 1) {
      const missingIndex = result.missing[0];
      methodNote = male
        ? `Calculated ${names[mode][missingIndex].toLowerCase()} = (child − each known ancestor's weighted contribution) / ${weights[missingIndex]}.`
        : `Calculated ${names[mode][missingIndex].toLowerCase()} = ${mode} × child − the other ${mode - 1} ancestors.`;
    } else if (male && targetComparison && selectedIndex !== null) {
      const otherContributions = names[mode]
        .map((name, index) => index === selectedIndex ? null : `${weights[index]} × ${name.toLowerCase()}`)
        .filter(Boolean).join(" − ");
      methodNote = `Calculated ${selectedName} = (child − ${otherContributions}) / ${weights[selectedIndex]}.`;
    } else if (result.kind === "residual") {
      const missingWeight = result.missing.reduce((sum, index) => sum + weights[index], 0);
      methodNote = `Combined missing coordinates = (child − each known ancestor's weighted contribution) / ${missingWeight}.`;
    } else if (male) {
      methodNote = mode === 2
        ? "The calculated child is 51% mother + 49% father."
        : "The calculated child is 25.5% from each maternal grandparent + 24.5% from each paternal grandparent.";
    } else if (targetComparison && selectedIndex !== null) {
      methodNote = `Calculated ${selectedName} = ${mode} × child − the other ${mode - 1} ancestors.`;
    } else {
      methodNote = "The calculated child is the arithmetic average of all entered G25 ancestor rows.";
    }
    $("#method-note").textContent = methodNote;
    renderSuggestions(result, ancestors, male);
    renderMatches(targetComparison, selectedName);
  }

  function renderCompare() {
    cancelMixtures();
    $("#suggestions-panel").hidden = true;
    suggestionTarget = null;
    for (const selector of ["#relaxed-estimates-panel", "#parent-estimates-panel", "#grandparent-estimates-panel"]) {
      $(selector).hidden = true;
    }
    $("#compare-rows").replaceChildren(...state.compare.map((item, index) =>
      createRow(index === 0 ? "A" : "B", { type: "compare", index }, item, null)));
    const ready = state.compare.every(Boolean);
    $("#compare-status").hidden = ready;
    $("#compare-distance").hidden = !ready;
    if (ready) {
      $("#compare-distance").textContent = `A–B distance: ${core.distance(state.compare[0].values, state.compare[1].values).toFixed(3)}.`;
    }
    renderMatches(ready ? { actual: state.compare[0], calculated: state.compare[1] } : null, "", true);
  }

  function renderSuggestions(result, ancestors, male) {
    suggestionTarget = null;
    let description = "";
    if (state.offspring && result.kind === "residual") {
      const missing = result.missing;
      const person = missing.length === 1 ? names[state.mode][missing[0]].toLowerCase() : `${missing.length} missing ancestors`;
      suggestionTarget = {
        label: missing.length === 1 ? `missing ${person}` : `combined average of ${person}`,
        values: missing.length === 1 ? result.inferred : result.combined,
      };
      description = missing.length === 1 ? ""
        : "Combined average; individual missing ancestors cannot be inferred.";
    } else if (!state.offspring) {
      const estimate = core.estimateChildFromKnown(ancestors, male);
      if (estimate) {
        suggestionTarget = { label: "child", values: estimate.values };
        description = estimate.knownCount === ancestors.length ? ""
          : `Provisional child estimate from ${estimate.knownCount} of ${ancestors.length} ancestors.`;
      }
    }
    $("#suggestions-panel").hidden = !suggestionTarget || !references.length;
    if (!suggestionTarget || !references.length) return;
    $("#suggestions-intro").textContent = description;
    $("#suggestions-intro").hidden = !description;
    renderSuggestionTable();
  }

  function renderSuggestionTable() {
    if (!suggestionTarget) return;
    const category = $("#suggestion-category").value;
    const candidates = category === "all" ? references : references.filter((row) => row[0] === category);
    $("#suggestion-count-value").textContent = String(state.closestCount);
    $("#suggestions-list-title").textContent = `Up to ${state.closestCount} closest ${category === "all" ? "" : `${category} `}populations to ${suggestionTarget.label}`;
    renderMatchTable($("#suggestions-list"), core.nearestMatches(suggestionTarget, candidates, state.closestCount),
      { distanceKey: "distance", omitCategory: category !== "all" });
  }

  function renderSingle() {
    cancelMixtures();
    cancelMedieval();
    relaxedFits = { modern: [], ancient: [] };
    relaxedReady = { modern: false, ancient: false };
    strictFits = { parents: [], grandparents: [] };
    strictReady = { parents: false, grandparents: false };
    $("#relaxed-count").value = String(state.relaxedCount);
    $("#relaxed-count-value").textContent = String(state.relaxedCount);
    $("#strict-parent-count").value = String(state.strictParentCount);
    $("#strict-parent-count-value").textContent = String(state.strictParentCount);
    $("#strict-grandparent-count").value = String(state.strictGrandparentCount);
    $("#strict-grandparent-count-value").textContent = String(state.strictGrandparentCount);
    preparedMatches = null;
    preparedContext = null;
    $("#single-row").replaceChildren(createRow("Sample", { type: "single" }, state.single, null));
    for (const selector of ["#remaining-admixture-panel", "#metric-controls", "#difference-panel", "#ratio-panel", "#d3-panel"]) {
      $(selector).hidden = true;
    }
    updateAnalysisView();
    if (!state.single || !references.length) return;
    if (state.turkish && isMedievalView()) {
      renderMedievalBreakdown();
      return;
    }
    const modernReferences = references.filter((row) => row[0] === "modern");
    const ancientReferences = references.filter((row) => row[0] === "ancient");
    renderSingleClosestTables();
    renderMixtureStatus("#relaxed-modern", "Calculating unsupervised modern fits…");
    renderMixtureStatus("#relaxed-ancient", "Waiting for modern fits…");
    renderMixtureStatus("#parent-estimates", "Waiting for unsupervised fits…");
    renderMixtureStatus("#grandparent-estimates", "Waiting for earlier analyses…");
    updateStrictProgress(0, "Waiting for earlier analyses…");
    startMixtures(state.single, modernReferences, references, mixtureRequest);
  }

  function isMedievalView() {
    return state.analysisView === "early" || state.analysisView === "late";
  }

  function updateAnalysisView() {
    const medieval = state.mode === 1 && state.turkish && isMedievalView();
    const available = state.mode === 1 && Boolean(state.single) && references.length > 0;
    for (const [selector, active] of [
      ["#analysis-results-tab", !medieval],
      ["#early-medieval-tab", medieval && state.analysisView === "early"],
      ["#late-medieval-tab", medieval && state.analysisView === "late"],
    ]) {
      const button = $(selector);
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }
    for (const selector of ["#matches-panel", "#relaxed-estimates-panel", "#parent-estimates-panel", "#grandparent-estimates-panel"]) {
      $(selector).hidden = !available || medieval;
    }
    $("#medieval-breakdown-panel").hidden = !available || !medieval;
  }

  function renderMedievalBreakdown() {
    const status = $("#medieval-breakdown-status");
    const distance = $("#medieval-breakdown-distance");
    const list = $("#medieval-breakdown-list");
    list.replaceChildren();
    distance.hidden = true;
    const period = state.analysisView === "early" ? "Early Medieval" : "Late Medieval";
    const periodReferences = medievalReferences[state.analysisView] || [];
    $("#medieval-breakdown-title").textContent = period;
    status.textContent = `Calculating ${period} fit…`;
    renderMedievalPca(periodReferences, period);
    const requestId = medievalRequest;
    try {
      const source = `(${window.G25MedievalModule.toString()})(self);\n(${medievalWorkerMain.toString()})();`;
      const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      medievalWorkerUrl = url;
      const worker = new Worker(url);
      medievalWorker = worker;
      const finish = () => {
        worker.terminate();
        if (medievalWorker === worker) {
          URL.revokeObjectURL(medievalWorkerUrl);
          medievalWorker = null;
          medievalWorkerUrl = null;
        }
      };
      worker.onmessage = ({ data }) => {
        if (data.requestId !== medievalRequest || state.mode !== 1 || !state.turkish ||
            !isMedievalView()) return;
        finish();
        if (data.error) {
          status.textContent = data.error;
          return;
        }
        renderMedievalFit(data.fit);
      };
      worker.onerror = () => {
        if (medievalWorker !== worker) return;
        finish();
        status.textContent = "Medieval analysis could not start in this browser.";
      };
      worker.postMessage({ requestId, target: state.single, references: periodReferences });
    } catch (error) {
      cancelMedieval();
      status.textContent = `Medieval analysis could not start: ${error.message}`;
    }
  }

  function renderMedievalPca(periodReferences, period) {
    const container = $("#medieval-pca-plot");
    const legend = $("#medieval-pca-legend");
    container.replaceChildren();
    legend.replaceChildren();
    let projection;
    const modernReferences = references.filter((row) => row[0] === "modern");
    const closestModern = core.nearestMatches(state.single, modernReferences, 3);
    try {
      projection = window.G25Pca.projectPca(state.single, periodReferences,
        closestModern.map((match) => modernReferences[match.id]));
    } catch (error) {
      container.textContent = error.message;
      return;
    }

    const width = 1000;
    const height = 600;
    const bounds = { left: 62, right: width - 34, top: 28, bottom: height - 60 };
    const all = [...projection.points, projection.target, ...projection.overlays];
    const extent = (key) => {
      const values = all.map((point) => point[key]);
      const low = Math.min(...values);
      const high = Math.max(...values);
      const padding = Math.max((high - low) * 0.07, 0.002);
      return [low - padding, high + padding];
    };
    const [xMin, xMax] = extent("x");
    const [yMin, yMax] = extent("y");
    const plotX = (value) => bounds.left + (value - xMin) / (xMax - xMin) * (bounds.right - bounds.left);
    const plotY = (value) => bounds.bottom - (value - yMin) / (yMax - yMin) * (bounds.bottom - bounds.top);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", `${period} PCA of ${projection.points.length} references, ${projection.overlays.length} closest modern populations, and ${projection.target.label}`);
    const tooltip = document.createElement("div");
    tooltip.className = "pca-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = true;
    document.body.append(tooltip);
    pcaTooltip = tooltip;
    const hideTooltip = () => { tooltip.hidden = true; };
    const showTooltip = (label, clientX, clientY) => {
      tooltip.textContent = label.replaceAll("_", " ");
      tooltip.hidden = false;
      tooltip.dataset.label = label;
      tooltip.style.left = `${Math.max(8, Math.min(clientX + 14, window.innerWidth - tooltip.offsetWidth - 8))}px`;
      tooltip.style.top = `${clientY + tooltip.offsetHeight + 18 > window.innerHeight
        ? Math.max(8, clientY - tooltip.offsetHeight - 12) : clientY + 14}px`;
    };
    const bindTooltip = (node, label) => {
      node.setAttribute("tabindex", "0");
      node.setAttribute("aria-label", label.replaceAll("_", " "));
      let touching = false;
      node.addEventListener("pointerdown", (event) => { touching = event.pointerType === "touch"; });
      node.addEventListener("pointerenter", (event) => {
        if (event.pointerType !== "touch") showTooltip(label, event.clientX, event.clientY);
      });
      node.addEventListener("pointermove", (event) => {
        if (event.pointerType !== "touch") showTooltip(label, event.clientX, event.clientY);
      });
      node.addEventListener("pointerleave", (event) => {
        if (event.pointerType !== "touch") hideTooltip();
      });
      node.addEventListener("pointerup", (event) => {
        if (event.pointerType === "touch") {
          if (!tooltip.hidden && tooltip.dataset.label === label) hideTooltip();
          else showTooltip(label, event.clientX, event.clientY);
        }
        touching = false;
      });
      node.addEventListener("pointercancel", () => { touching = false; });
      node.addEventListener("focus", () => {
        if (touching) return;
        const rect = node.getBoundingClientRect();
        showTooltip(label, rect.left + rect.width / 2, rect.top);
      });
      node.addEventListener("blur", hideTooltip);
    };
    const add = (parent, tag, attributes, content) => {
      const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
      if (content !== undefined) element.textContent = content;
      parent.append(element);
      return element;
    };
    const formatTick = (value) => value.toFixed(3);
    for (let i = 0; i <= 4; i += 1) {
      const xValue = xMin + (xMax - xMin) * i / 4;
      const yValue = yMin + (yMax - yMin) * i / 4;
      const x = plotX(xValue);
      const y = plotY(yValue);
      add(svg, "line", { x1: x, y1: bounds.top, x2: x, y2: bounds.bottom, class: "pca-grid" });
      add(svg, "line", { x1: bounds.left, y1: y, x2: bounds.right, y2: y, class: "pca-grid" });
      add(svg, "text", { x, y: bounds.bottom + 19, "text-anchor": "middle", class: "pca-tick" }, formatTick(xValue));
      add(svg, "text", { x: bounds.left - 9, y: y + 4, "text-anchor": "end", class: "pca-tick" }, formatTick(yValue));
    }
    add(svg, "rect", { x: bounds.left, y: bounds.top, width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top, class: "pca-frame" });
    add(svg, "text", { x: (bounds.left + bounds.right) / 2, y: height - 12,
      "text-anchor": "middle", class: "pca-axis-label" }, `PC1 · ${(projection.explained[0] * 100).toFixed(1)}%`);
    add(svg, "text", { transform: `translate(17 ${(bounds.top + bounds.bottom) / 2}) rotate(-90)`,
      "text-anchor": "middle", class: "pca-axis-label" }, `PC2 · ${(projection.explained[1] * 100).toFixed(1)}%`);

    const colors = {
      "Türk": "#087c8c", "Türki": "#087c8c", "Rum": "#c87525", "Slav": "#8256ad",
      "Ermeni": "#bd5063", "İran": "#587e36", "Levant": "#4f70bc",
      "Kartvel": "#956d3a", "Mezopotamya": "#737d88",
    };
    const groups = [...new Set(projection.points.map((point) => point.ethnicity))].sort((a, b) => a.localeCompare(b));
    const fallback = ["#228e71", "#a75d83", "#aa7731", "#657bc0"];
    const groupColor = (group) => colors[group] || fallback[groups.indexOf(group) % fallback.length];
    for (const group of groups) {
      const positions = projection.points.filter((point) => point.ethnicity === group)
        .map((point) => ({ x: plotX(point.x), y: plotY(point.y) }));
      if (positions.length < 2) continue;
      const hull = window.G25PcaLayout.convexHull(positions);
      const path = hull.length === 2
        ? `M ${hull[0].x} ${hull[0].y} L ${hull[1].x} ${hull[1].y}`
        : `M ${hull.map((point) => `${point.x} ${point.y}`).join(" L ")} Z`;
      add(svg, "path", { d: path, fill: hull.length === 2 ? "none" : groupColor(group),
        stroke: groupColor(group), class: hull.length === 2 ? "pca-cluster-line" : "pca-cluster" });
    }
    for (const point of projection.points) {
      const circle = add(svg, "circle", { cx: plotX(point.x), cy: plotY(point.y), r: 6,
        fill: groupColor(point.ethnicity), class: "pca-reference" });
      bindTooltip(circle, point.label);
    }
    projection.overlays.forEach((point, index) => {
      const x = plotX(point.x);
      const y = plotY(point.y);
      const triangle = add(svg, "path", {
        d: `M ${x} ${y - 10} L ${x + 10} ${y + 8} L ${x - 10} ${y + 8} Z`,
        class: "pca-modern",
      });
      bindTooltip(triangle, `#${index + 1} modern: ${point.label} · Distance ${closestModern[index].distance.toFixed(3)}`);
    });
    const targetX = plotX(projection.target.x);
    const targetY = plotY(projection.target.y);
    const marker = add(svg, "path", { d: `M ${targetX} ${targetY - 10} L ${targetX + 10} ${targetY} L ${targetX} ${targetY + 10} L ${targetX - 10} ${targetY} Z`,
      class: "pca-target" });
    bindTooltip(marker, `Input: ${projection.target.label}`);
    container.append(svg);
    for (const group of groups) {
      const item = document.createElement("span");
      item.className = "pca-legend-item";
      const swatch = document.createElement("span");
      swatch.className = "pca-legend-swatch";
      swatch.style.backgroundColor = groupColor(group);
      item.append(swatch, document.createTextNode(group.replaceAll("_", " ")));
      legend.append(item);
    }
    if (projection.overlays.length) {
      const modern = document.createElement("span");
      modern.className = "pca-legend-item";
      const swatch = document.createElement("span");
      swatch.className = "pca-legend-modern-swatch";
      modern.append(swatch, document.createTextNode(`${projection.overlays.length} closest modern`));
      legend.append(modern);
    }
    const input = document.createElement("span");
    input.className = "pca-legend-item";
    input.textContent = "◆ Input";
    legend.append(input);
  }

  function renderMedievalFit(fit) {
    const status = $("#medieval-breakdown-status");
    const distance = $("#medieval-breakdown-distance");
    const list = $("#medieval-breakdown-list");
    status.textContent = `Estimated contributions · ${fit.groups.length} ethnicities · 100.0% total`;
    distance.textContent = `Fit distance ${fit.distance.toFixed(3)}`;
    distance.hidden = false;
    const groupUnits = allocatePercentUnits(fit.groups.map((group) => group.weight), 1000);
    fit.groups.forEach((group, groupIndex) => {
      const details = document.createElement("details");
      details.className = "breakdown-group";
      const summary = document.createElement("summary");
      const name = document.createElement("span");
      name.className = "breakdown-name";
      name.textContent = group.ethnicity.replaceAll("_", " ");
      const share = document.createElement("strong");
      share.textContent = formatPercent(groupUnits[groupIndex]);
      summary.append(name, share);
      const bar = document.createElement("div");
      bar.className = "breakdown-bar";
      const fill = document.createElement("span");
      fill.style.width = `${groupUnits[groupIndex] / 10}%`;
      bar.append(fill);
      const samples = document.createElement("ul");
      samples.className = "breakdown-samples";
      const sampleUnits = allocatePercentUnits(group.samples.map((sample) => sample.weight), groupUnits[groupIndex]);
      group.samples.forEach((component, sampleIndex) => {
        const item = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = component.sample.replaceAll("_", " ");
        const weight = document.createElement("strong");
        weight.textContent = formatPercent(sampleUnits[sampleIndex]);
        item.append(label, weight);
        samples.append(item);
      });
      details.append(summary, bar, samples);
      list.append(details);
    });
  }

  function allocatePercentUnits(weights, totalUnits) {
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const exact = weights.map((weight) => weight / totalWeight * totalUnits);
    const units = exact.map(Math.floor);
    const order = exact.map((value, index) => ({ index, remainder: value - units[index] }))
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    const remaining = totalUnits - units.reduce((sum, value) => sum + value, 0);
    for (let i = 0; i < remaining; i += 1) units[order[i].index] += 1;
    return units;
  }

  function formatPercent(units) {
    return `${(units / 10).toFixed(1)}%`;
  }

  function renderSingleClosestTables() {
    if (!state.single || !references.length) return;
    const category = $("#analyse-match-category").value;
    const candidates = category === "all" ? references : references.filter((row) => row[0] === category);
    $("#single-ancient-matches-group").hidden = true;
    $("#actual-matches-title").textContent = `Up to ${state.closestCount} closest ${category === "all" ? "" : `${category} `}populations to ${state.single.label}`;
    renderMatchTable($("#actual-matches"), core.nearestMatches(state.single, candidates, state.closestCount),
      { distanceKey: "distance", omitCategory: category !== "all" });
  }

  function renderMixtureStatus(selector, message) {
    const status = document.createElement("p");
    status.className = "mixture-status";
    status.textContent = message;
    $(selector).replaceChildren(status);
  }

  function updateStrictProgress(value, label) {
    $("#strict-four-progress-bar").value = value;
    $("#strict-four-progress-value").textContent = `${value}%`;
    $("#strict-four-progress-label").textContent = label;
  }

  function renderMixtureTable(selector, fits, count, title, emptyMessage, showWeights = false) {
    const table = document.createElement("table");
    table.className = "matches-table mixture-table";
    const head = document.createElement("thead");
    const heading = document.createElement("tr");
    for (const label of ["#", ...Array.from({ length: count }, (_, index) => `${title} ${index + 1}`), "Genetic distance (Euclidean)"]) {
      const cell = document.createElement("th");
      cell.textContent = label;
      heading.append(cell);
    }
    head.append(heading);
    table.append(head);
    const body = document.createElement("tbody");
    fits.forEach((fit, index) => {
      const row = document.createElement("tr");
      const parts = showWeights ? [...fit.parts].sort((first, second) => second.weight - first.weight) : fit.parts;
      const cells = [String(index + 1), ...parts.map((part) =>
        showWeights ? `${part.label} · ${(part.weight * 100).toFixed(1)}%`
          : part.label), fit.distance.toFixed(3)];
      for (const value of cells) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      body.append(row);
    });
    if (!fits.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = count + 2;
      cell.className = "empty-matches";
      cell.textContent = emptyMessage || `At least ${count} distinct references are needed in this set.`;
      row.append(cell);
      body.append(row);
    }
    table.append(body);
    $(selector).replaceChildren(table);
  }

  function renderRelaxedTable() {
    $("#relaxed-count-value").textContent = String(state.relaxedCount);
    for (const category of ["modern", "ancient"]) {
      if (relaxedReady[category]) {
        renderMixtureTable(`#relaxed-${category}`, relaxedFits[category].slice(0, state.relaxedCount), 2, "Population",
          "No two-reference fit with two contributing populations was found.", true);
      }
    }
  }

  function renderStrictTable(kind) {
    const parent = kind === "parents";
    const count = parent ? state.strictParentCount : state.strictGrandparentCount;
    $(parent ? "#strict-parent-count-value" : "#strict-grandparent-count-value").textContent = String(count);
    if (strictReady[kind]) {
      renderMixtureTable(parent ? "#parent-estimates" : "#grandparent-estimates",
        strictFits[kind].slice(0, count), parent ? 2 : 4, parent ? "Parent" : "Grandparent",
        "No eligible modern references remain after excluding exact matches to the input.");
    }
  }

  function startMixtures(target, modernReferences, allReferences, requestId) {
    const receive = ({ kind, fits, value, message }) => {
      if (requestId !== mixtureRequest || state.mode !== 1) return;
      if (kind === "relaxedModern" || kind === "relaxedAncient") {
        const category = kind === "relaxedModern" ? "modern" : "ancient";
        relaxedFits[category] = fits;
        relaxedReady[category] = true;
        renderRelaxedTable();
        if (category === "modern") renderMixtureStatus("#relaxed-ancient", "Calculating unsupervised ancient fits…");
        else renderMixtureStatus("#parent-estimates", "Calculating strict two-way fits…");
      }
      if (kind === "strictParents") {
        strictFits.parents = fits;
        strictReady.parents = true;
        renderStrictTable("parents");
        renderMixtureStatus("#grandparent-estimates", "Building exact four-way search index…");
        updateStrictProgress(0, "Building exact four-way search index…");
      }
      if (kind === "strictProgress") {
        updateStrictProgress(value, value === 100 ? "Complete" : strictReady.grandparents
          ? "Current best fits · searching…" : value < 10
            ? "Building exact four-way search index…" : "Checking four-population combinations…");
      }
      if (kind === "strictGrandparentsUpdate") {
        strictFits.grandparents = fits;
        strictReady.grandparents = true;
        renderStrictTable("grandparents");
        $("#strict-four-progress-label").textContent = "Current best fits · searching…";
      }
      if (kind === "strictGrandparents") {
        strictFits.grandparents = fits;
        strictReady.grandparents = true;
        renderStrictTable("grandparents");
        updateStrictProgress(100, "Complete");
      }
      if (kind === "error") {
        if (!relaxedReady.modern) renderMixtureStatus("#relaxed-modern", message);
        if (!relaxedReady.ancient) renderMixtureStatus("#relaxed-ancient", message);
        renderMixtureStatus("#parent-estimates", message);
        renderMixtureStatus("#grandparent-estimates", message);
        updateStrictProgress(0, "Analysis unavailable");
      }
    };
    try {
      const source = `(${window.G25MixtureModule.toString()})(self);\n(${mixtureWorkerMain.toString()})();`;
      const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      mixtureWorkerUrl = url;
      const worker = new Worker(url);
      mixtureWorker = worker;
      worker.onmessage = ({ data }) => {
        if (data.requestId !== mixtureRequest) return;
        receive(data);
        if (data.kind === "strictGrandparents" || data.kind === "error") {
          worker.terminate();
          if (mixtureWorker === worker) {
            URL.revokeObjectURL(mixtureWorkerUrl);
            mixtureWorker = null;
            mixtureWorkerUrl = null;
          }
        }
      };
      worker.onerror = () => {
        if (mixtureWorker !== worker) return;
        worker.terminate();
        URL.revokeObjectURL(mixtureWorkerUrl);
        mixtureWorker = null;
        mixtureWorkerUrl = null;
        receive({ kind: "error", message: "Background analysis could not start in this browser." });
      };
      worker.postMessage({ requestId, target, modernReferences, references: allReferences });
    } catch (error) {
      if (mixtureWorker) mixtureWorker.terminate();
      if (mixtureWorkerUrl) URL.revokeObjectURL(mixtureWorkerUrl);
      mixtureWorker = null;
      mixtureWorkerUrl = null;
      receive({ kind: "error", message: `Background analysis could not start: ${error.message}` });
    }
  }

  function renderMatches(targetComparison, selectedName, compareMode = false) {
    $("#remaining-admixture-panel").hidden = true;
    const panels = [$("#matches-panel"), $("#metric-controls"), $("#difference-panel"), $("#ratio-panel"), $("#d3-panel")];
    if (!targetComparison || !references.length) {
      panels.forEach((panel) => { panel.hidden = true; });
      preparedMatches = null;
      preparedContext = null;
      return;
    }
    panels.forEach((panel) => { panel.hidden = false; });
    const category = $("#match-category").value;
    const candidates = category === "all" ? references : references.filter((row) => row[0] === category);
    preparedMatches = core.prepareMatches(targetComparison.actual, targetComparison.calculated, candidates);
    preparedContext = { selectedName, compareMode };
    if (compareMode) renderRemainingTables();
    const slider = $("#metric-limit");
    slider.max = String(preparedMatches.furthestDistance);
    slider.value = String(Math.min(state.metricLimit, preparedMatches.furthestDistance));
    $("#metric-max-label").textContent = preparedMatches.furthestDistance.toFixed(3);
    renderRankedMatches();
  }

  function renderRemainingTables() {
    if (state.mode !== 0 || !state.compare.every(Boolean) || !references.length) return;
    $("#remaining-admixture-panel").hidden = false;
    const [actual, calculated] = state.compare;
    const category = $("#remaining-category").value;
    const candidates = category === "all" ? references : references.filter((row) => row[0] === category);
    $("#remaining-a-title").textContent = `A: ${actual.label} ≈ % B: ${calculated.label} + remainder`;
    $("#remaining-b-title").textContent = `B: ${calculated.label} ≈ % A: ${actual.label} + remainder`;
    renderRemainingAdmixture($("#remaining-a"), core.remainingAdmixture(actual, calculated, candidates), "B");
    renderRemainingAdmixture($("#remaining-b"), core.remainingAdmixture(calculated, actual, candidates), "A");
  }

  function renderRemainingAdmixture(container, fits, sourceName) {
    const table = document.createElement("table");
    table.className = "matches-table";
    const head = table.createTHead().insertRow();
    for (const label of [`${sourceName} %`, "Remaining population", "Remainder %", "Fit distance"]) {
      const cell = document.createElement("th");
      cell.textContent = label;
      head.append(cell);
    }
    const body = table.createTBody();
    for (const { percent, remainingPercent, best } of core.summarizeRemainingAdmixture(fits)) {
      const row = body.insertRow();
      for (const value of [`${percent}%`, best ? `${best.label} · ${best.category}` : "No matching populations", `${remainingPercent}%`, best ? best.distance.toFixed(3) : "—"]) {
        row.insertCell().textContent = value;
      }
    }
    container.replaceChildren(table);
  }

  function renderRankedMatches() {
    if (!preparedMatches) return;
    const metricLimit = Number($("#metric-limit").value);
    $("#metric-limit-value").textContent = metricLimit.toFixed(3);
    const lists = core.rankMatches(preparedMatches, 10, metricLimit, state.closestCount);
    const { selectedName, compareMode } = preparedContext;
    $("#actual-matches-title").textContent = compareMode
      ? `Up to ${state.closestCount} closest to A: ${preparedMatches.actual.label}`
      : `Up to ${state.closestCount} closest to entered ${selectedName}: ${preparedMatches.actual.label}`;
    $("#calculated-matches-title").textContent = compareMode
      ? `Up to ${state.closestCount} closest to B: ${preparedMatches.calculated.label}`
      : `Up to ${state.closestCount} closest to calculated ${selectedName}: ${preparedMatches.calculated.label}`;
    const comparisonKey = compareMode
      ? `A = ${preparedMatches.actual.label}. B = ${preparedMatches.calculated.label}. C = each population listed below. AC and BC are the respective distances to C.`
      : `A = entered ${selectedName}: ${preparedMatches.actual.label}. B = calculated ${selectedName}: ${preparedMatches.calculated.label}. C = each population listed below. AC and BC are the respective distances to C.`;
    document.querySelectorAll(".comparison-key").forEach((element) => { element.textContent = comparisonKey; });
    renderMatchTable($("#actual-matches"), lists.actual,
      { otherTargetName: compareMode ? "B" : `calculated ${selectedName}`, distanceKey: "ac" });
    renderMatchTable($("#calculated-matches"), lists.calculated,
      { otherTargetName: compareMode ? "A" : `entered ${selectedName}`, distanceKey: "bc" });
    const emptyMessage = `No entries have both AC and BC at or below ${metricLimit.toFixed(3)} in this reference set.`;
    renderMatchTable($("#smallest-difference"), lists.smallestDifference, { metric: "difference", emptyMessage });
    renderMatchTable($("#largest-difference"), lists.largestDifference, { metric: "difference", emptyMessage });
    renderMatchTable($("#smallest-ratio"), lists.smallestRatio, { metric: "ratio", emptyMessage });
    renderMatchTable($("#largest-ratio"), lists.largestRatio, { metric: "ratio", emptyMessage });
    renderMatchTable($("#smallest-d3"), lists.smallestD3, { metric: "d3", emptyMessage });
    renderMatchTable($("#largest-d3"), lists.largestD3, { metric: "d3", emptyMessage });
  }

  function renderMatchTable(container, matches, { otherTargetName = "", distanceKey = null, metric = null, omitCategory = false, emptyMessage = "No matching populations in this reference set." }) {
    const table = document.createElement("table");
    table.className = `matches-table${distanceKey ? " closest-table" : ""}`;
    const head = document.createElement("thead");
    const heading = document.createElement("tr");
    const headings = ["#", otherTargetName ? "Population / target" : "Population"];
    if (distanceKey) headings.push("Genetic distance");
    else headings.push("AC", "BC");
    if (metric === "difference") headings.push("AC − BC");
    if (metric === "ratio") headings.push("AC / BC");
    if (metric === "d3") headings.push("D3");
    for (const label of headings) {
      const cell = document.createElement("th");
      cell.textContent = label;
      heading.append(cell);
    }
    head.append(heading);
    table.append(head);
    const body = document.createElement("tbody");
    matches.forEach((match, index) => {
      const row = document.createElement("tr");
      if (match.category === "target") row.className = "target-row";
      const displayName = match.category === "target"
        ? `${otherTargetName}: ${match.label}` : omitCategory ? match.label : `${match.label} · ${match.category}`;
      const cells = [String(index + 1), displayName];
      if (distanceKey) cells.push(match[distanceKey].toFixed(3));
      else cells.push(match.ac.toFixed(3), match.bc.toFixed(3));
      if (metric === "difference") {
        cells.push(`${match.difference > 0 ? "+" : ""}${match.difference.toFixed(3)}`);
      }
      if (metric === "ratio") cells.push(match.ratio.toFixed(3));
      if (metric === "d3") cells.push(match.d3.toFixed(3));
      cells.forEach((text, column) => {
        const cell = document.createElement("td");
        cell.textContent = text;
        if (column === 1) cell.title = displayName;
        row.append(cell);
      });
      body.append(row);
    });
    if (!matches.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = headings.length;
      cell.className = "empty-matches";
      cell.textContent = emptyMessage;
      row.append(cell);
      body.append(row);
    }
    table.append(body);
    container.replaceChildren(table);
  }

  function renderReferences() {
    const query = normalizeSearch($("#reference-search").value);
    const category = $("#reference-category").value;
    const list = $("#reference-results");
    list.replaceChildren();
    if (!query) {
      const hint = document.createElement("div");
      hint.className = "reference-empty";
      hint.textContent = `Search ${references.length.toLocaleString()} modern and ancient references by name.`;
      list.append(hint);
      return;
    }
    let shown = 0;
    let total = 0;
    const words = query.split(/\s+/);
    for (const row of references) {
      if (category !== "all" && row[0] !== category) continue;
      const searchName = normalizeSearch(row[1]);
      if (!words.every((word) => searchName.includes(word))) continue;
      total += 1;
      if (shown >= 60) continue;
      const button = makeButton(row[1], () => setTarget({ category: row[0], label: row[1], values: row.slice(2), source: "reference" }));
      button.className = "reference-result";
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = row[0];
      button.append(badge);
      list.append(button);
      shown += 1;
    }
    if (!total) {
      const empty = document.createElement("div");
      empty.className = "reference-empty";
      empty.textContent = "No matching references. Try another name or paste a G25 row.";
      list.append(empty);
    } else if (total > shown) {
      const more = document.createElement("div");
      more.className = "reference-empty";
      more.textContent = `Showing ${shown} of ${total} matches. Refine your search to see more.`;
      list.append(more);
    }
  }

  async function copyText(text, button) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(text);
        } catch (_error) {
          fallbackCopy(text);
        }
      } else {
        fallbackCopy(text);
      }
      const previous = button.textContent;
      button.textContent = "Copied!";
      window.setTimeout(() => { button.textContent = previous; }, 1400);
    } catch (error) {
      $("#result-status").textContent = `${error.message} Select and copy the row from the output box.`;
    }
  }

  function fallbackCopy(text) {
    const temporary = document.createElement("textarea");
    temporary.value = text;
    temporary.style.position = "fixed";
    temporary.style.opacity = "0";
    document.body.append(temporary);
    temporary.select();
    const copied = document.execCommand("copy");
    temporary.remove();
    if (!copied) throw new Error("Clipboard access was blocked.");
  }

  document.querySelectorAll(".mode-button").forEach((button) => {
    if (![0, 1, 2, 4, 8].includes(Number(button.dataset.mode))) {
      button.hidden = true;
      return;
    }
    button.addEventListener("click", () => { state.mode = Number(button.dataset.mode); render(); });
  });
  $("#clear-all").addEventListener("click", () => {
    state.single = null;
    state.compare = [null, null];
    state.offspring = null;
    for (const mode of [2, 4, 8]) {
      state.slots[mode].fill(null);
      state.selectedIndexByMode[mode] = null;
    }
    state.metricLimit = 10;
    state.closestCount = 10;
    state.relaxedCount = 10;
    state.strictParentCount = 10;
    state.strictGrandparentCount = 10;
    state.male = false;
    render();
  });
  $("#male-toggle").addEventListener("change", (event) => {
    state.male = event.currentTarget.checked;
    render();
  });
  $("#turkish-toggle").addEventListener("change", (event) => {
    state.turkish = event.currentTarget.checked;
    if (!state.turkish) state.analysisView = "results";
    updateSelectedReferences(state.turkish ? turkishReferences : globalReferences);
    render();
  });
  const analysisTabViews = ["results", "early", "late"];
  const analysisTabSelectors = ["#analysis-results-tab", "#early-medieval-tab", "#late-medieval-tab"];
  for (const [index, selector] of analysisTabSelectors.entries()) {
    const view = analysisTabViews[index];
    const button = $(selector);
    button.addEventListener("click", () => {
      if (state.analysisView === view) return;
      state.analysisView = view;
      renderSingle();
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const other = $(analysisTabSelectors[(index + direction + analysisTabSelectors.length) % analysisTabSelectors.length]);
      other.click();
      other.focus();
    });
  }
  $("#reference-search").addEventListener("input", renderReferences);
  $("#reference-category").addEventListener("change", renderReferences);
  $("#remaining-category").addEventListener("change", renderRemainingTables);
  $("#analyse-match-category").addEventListener("change", renderSingleClosestTables);
  $("#match-category").addEventListener("change", render);
  $("#suggestion-category").addEventListener("change", renderSuggestionTable);
  $("#suggestion-count").addEventListener("input", (event) => {
    state.closestCount = Number(event.currentTarget.value);
    renderSuggestionTable();
  });
  $("#closest-count").addEventListener("input", (event) => {
    state.closestCount = Number(event.currentTarget.value);
    $("#closest-count-value").textContent = String(state.closestCount);
    if (state.mode === 1) renderSingleClosestTables();
    else renderRankedMatches();
  });
  $("#relaxed-count").addEventListener("input", (event) => {
    state.relaxedCount = Number(event.currentTarget.value);
    renderRelaxedTable();
  });
  $("#strict-parent-count").addEventListener("input", (event) => {
    state.strictParentCount = Number(event.currentTarget.value);
    renderStrictTable("parents");
  });
  $("#strict-grandparent-count").addEventListener("input", (event) => {
    state.strictGrandparentCount = Number(event.currentTarget.value);
    renderStrictTable("grandparents");
  });
  $("#metric-limit").addEventListener("input", () => {
    state.metricLimit = Number($("#metric-limit").value);
    renderRankedMatches();
  });
  $("#close-picker").addEventListener("click", () => picker.close());
  picker.addEventListener("close", () => { state.pickerTarget = null; });
  $("#use-pasted").addEventListener("click", () => {
    try {
      const record = core.parseLine($("#pasted-line").value);
      setTarget(record);
    } catch (error) {
      $("#paste-error").textContent = error.message;
    }
  });
  $("#copy-result").addEventListener("click", (event) => copyText(state.output, event.currentTarget));
  render();
})();
