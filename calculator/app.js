(function () {
  "use strict";

  const references = window.G25_REFERENCES || [];
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
    16: Array.from({ length: 16 }, (_, index) => `Great-great-grandparent ${index + 1}`),
  };
  const generation = { 2: "PARENTS", 4: "GRANDPARENTS", 8: "GREAT-GRANDPARENTS", 16: "GREAT-GREAT-GRANDPARENTS" };
  const singular = { 2: "parent", 4: "grandparent", 8: "great_grandparent", 16: "great_great_grandparent" };
  const state = {
    mode: 2,
    single: null,
    offspring: null,
    slots: { 2: Array(2).fill(null), 4: Array(4).fill(null), 8: Array(8).fill(null), 16: Array(16).fill(null) },
    selectedIndexByMode: { 2: null, 4: null, 8: null, 16: null },
    pickerTarget: null,
    output: "",
    metricLimit: 10,
    relaxedCount: 10,
    strictParentCount: 10,
    strictGrandparentCount: 10,
    male: false,
  };

  const $ = (selector) => document.querySelector(selector);
  const picker = $("#picker");
  let preparedMatches = null;
  let preparedSelectedName = "";
  let mixtureWorker = null;
  let mixtureWorkerUrl = null;
  let mixtureRequest = 0;
  let relaxedFits = { modern: [], ancient: [] };
  let relaxedReady = { modern: false, ancient: false };
  let strictFits = { parents: [], grandparents: [] };
  let strictReady = { parents: false, grandparents: false };

  function cancelMixtures() {
    mixtureRequest += 1;
    if (mixtureWorker) mixtureWorker.terminate();
    if (mixtureWorkerUrl) URL.revokeObjectURL(mixtureWorkerUrl);
    mixtureWorker = null;
    mixtureWorkerUrl = null;
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
          }, 100);
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
    else if (state.pickerTarget.type === "offspring") state.offspring = item;
    else state.slots[state.mode][state.pickerTarget.index] = item;
    picker.close();
    render();
  }

  function openPicker(target, pasteFirst) {
    state.pickerTarget = target;
    $("#picker-title").textContent = target.type === "single" ? "Add sample coordinates"
      : target.type === "offspring" ? "Add offspring coordinates"
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
    document.querySelectorAll(".mode-button").forEach((button) => {
      const active = Number(button.dataset.mode) === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    $("#single-input").hidden = mode !== 1;
    $("#family-inputs").hidden = mode === 1;
    $("#result-panel").hidden = mode === 1;
    $("#single-ancient-matches-group").hidden = mode !== 1;
    $("#calculated-matches-group").hidden = mode === 1;
    $("#matches-note").hidden = mode === 1;
    $("#match-filter").hidden = mode === 1;
    $("#inputs-title").textContent = mode === 1 ? "G25 input" : "Family inputs";
    $("#inputs-intro").textContent = mode === 1
      ? "Choose a reference population or paste one G25 row."
      : "Choose a reference population or paste any G25 row for each person.";
    if (mode === 1) {
      renderSingle();
      return;
    }
    cancelMixtures();
    $("#relaxed-estimates-panel").hidden = true;
    $("#parent-estimates-panel").hidden = true;
    $("#grandparent-estimates-panel").hidden = true;
    $("#matches-intro").textContent = "Each list ranks all reference populations by genetic distance from its selected target. Distances use Euclidean G25 × 100.";
    const ancestors = state.slots[mode];
    const male = (mode === 2 || mode === 4) && state.male;
    const weights = core.ancestorWeights(mode, male);
    const result = core.calculate(state.offspring, ancestors, male);
    const complete = Boolean(state.offspring) && ancestors.every(Boolean);
    const selectedIndex = state.selectedIndexByMode[mode];
    const selectedName = selectedIndex === null ? "offspring" : names[mode][selectedIndex].toLowerCase();
    const targetComparison = complete
      ? core.calculateComparison(state.offspring, ancestors, selectedIndex, male) : null;
    $("#selection-hint").textContent = complete
      ? "Click a person or use Compare to calculate and compare that person's G25 coordinates."
      : "Fill the offspring and every ancestor to compare any person.";
    const select = (index) => {
      state.selectedIndexByMode[mode] = index;
      render();
    };
    const offspringDerived = result.kind === "offspring"
      ? { label: core.resultLabel(state.offspring, ancestors, male), values: result.values } : null;

    $("#offspring-row").replaceChildren(
      createRow("Offspring", { type: "offspring" }, state.offspring, offspringDerived,
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
      message = `Comparing ${selectedName}: entered coordinates versus the family-based calculation. Click another person to compare them.`;
      output = core.formatLine(targetComparison.calculated.label, targetComparison.calculated.values);
    } else if (result.kind === "offspring") {
      message = "Offspring calculated from all entered ancestors.";
      output = core.formatLine(core.resultLabel(state.offspring, ancestors, male), result.values);
    } else if (result.kind === "residual") {
      const count = result.missing.length;
      if (count === 1) {
        const missingIndex = result.missing[0];
        message = `Full coordinates for the missing ${names[mode][missingIndex].toLowerCase()} calculated. They are also available in its slot.`;
        output = core.formatLine(core.missingAncestorLabel(state.offspring, ancestors, male), result.inferred);
      } else {
        message = `Combined contribution of ${count} missing ancestors calculated. Individual missing coordinates cannot be determined.`;
        output = core.formatLine(core.resultLabel(state.offspring, ancestors, male), result.values);
      }
    } else if (state.offspring) {
      message = "Add ancestors to subtract their contribution from the offspring.";
    } else {
      message = `Fill all ${mode} ancestors to calculate offspring, or add offspring to calculate the missing contribution.`;
    }
    if (!references.length) message = "Reference data is unavailable. Reload the page.";
    $("#result-title").textContent = result.kind === "residual" && result.missing.length === 1
      ? `Calculated missing ${singular[mode].replaceAll("_", " ")}`
      : result.kind === "residual" ? "Combined missing contribution" : "Calculated G25 row";
    $("#result-status").textContent = message;
    $("#result-line").value = output;
    $("#copy-result").disabled = !output;
    state.output = output;

    const comparisonText = $("#comparison");
    comparisonText.hidden = !targetComparison;
    if (targetComparison) {
      comparisonText.textContent = `Distance between entered and calculated ${selectedName}: ${targetComparison.distance.toFixed(3)} (Euclidean G25 distance × 100).`;
    }

    let methodNote;
    if (result.kind === "residual" && result.missing.length === 1) {
      const missingIndex = result.missing[0];
      methodNote = male
        ? `Calculated ${names[mode][missingIndex].toLowerCase()} = (offspring − each known ancestor's weighted contribution) / ${weights[missingIndex]}.`
        : `Calculated ${names[mode][missingIndex].toLowerCase()} = ${mode} × offspring − the other ${mode - 1} ancestors.`;
    } else if (male && targetComparison && selectedIndex !== null) {
      const otherContributions = names[mode]
        .map((name, index) => index === selectedIndex ? null : `${weights[index]} × ${name.toLowerCase()}`)
        .filter(Boolean).join(" − ");
      methodNote = `Calculated ${selectedName} = (offspring − ${otherContributions}) / ${weights[selectedIndex]}.`;
    } else if (male && result.kind === "residual") {
      const ancestorType = mode === 2 ? "parent" : "grandparent";
      methodNote = `Residual = offspring − each known ${ancestorType}'s weighted contribution. With one blank, divide the residual by that ${ancestorType}'s weight to infer their coordinates.`;
    } else if (male) {
      methodNote = mode === 2
        ? "The calculated offspring is 51% mother + 49% father."
        : "The calculated offspring is 25.5% from each maternal grandparent + 24.5% from each paternal grandparent.";
    } else if (targetComparison && selectedIndex !== null) {
      methodNote = `Calculated ${selectedName} = ${mode} × offspring − the other ${mode - 1} ancestors.`;
    } else if (result.kind === "residual") {
      methodNote = `Residual = offspring − ${1 / mode} × each known ancestor. With one blank, that ancestor's full inferred coordinates are ${mode} × residual.`;
    } else {
      methodNote = "The calculated offspring is the arithmetic average of all entered G25 ancestor rows.";
    }
    $("#method-note").textContent = methodNote;
    renderMatches(targetComparison, selectedName);
  }

  function renderSingle() {
    cancelMixtures();
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
    $("#single-row").replaceChildren(createRow("Sample", { type: "single" }, state.single, null));
    for (const selector of ["#metric-controls", "#difference-panel", "#ratio-panel", "#d3-panel"]) {
      $(selector).hidden = true;
    }
    $("#matches-panel").hidden = !state.single || !references.length;
    $("#relaxed-estimates-panel").hidden = !state.single || !references.length;
    $("#parent-estimates-panel").hidden = !state.single || !references.length;
    $("#grandparent-estimates-panel").hidden = !state.single || !references.length;
    if (!state.single || !references.length) return;
    $("#matches-intro").textContent = "Modern and ancient reference populations ranked separately by genetic distance from the input. Distances use Euclidean G25 × 100.";
    const modernReferences = references.filter((row) => row[0] === "modern");
    const ancientReferences = references.filter((row) => row[0] === "ancient");
    $("#actual-matches-title").textContent = `Up to 10 closest modern populations to ${state.single.label}`;
    $("#single-ancient-matches-title").textContent = `Up to 10 closest ancient populations to ${state.single.label}`;
    renderMatchTable($("#actual-matches"), core.nearestMatches(state.single, modernReferences),
      { distanceKey: "distance", omitCategory: true });
    renderMatchTable($("#single-ancient-matches"), core.nearestMatches(state.single, ancientReferences),
      { distanceKey: "distance", omitCategory: true });
    renderMixtureStatus("#relaxed-modern", "Calculating unsupervised modern fits…");
    renderMixtureStatus("#relaxed-ancient", "Waiting for modern fits…");
    renderMixtureStatus("#parent-estimates", "Waiting for unsupervised fits…");
    renderMixtureStatus("#grandparent-estimates", "Waiting for earlier analyses…");
    updateStrictProgress(0, "Waiting for earlier analyses…");
    startMixtures(state.single, modernReferences, references, mixtureRequest);
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
        strictFits[kind].slice(0, count), parent ? 2 : 4, parent ? "Parent" : "Grandparent");
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
        updateStrictProgress(value, value === 100 ? "Complete" : value < 10
          ? "Building exact four-way search index…" : "Checking four-population combinations…");
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

  function renderMatches(targetComparison, selectedName) {
    const panels = [$("#matches-panel"), $("#metric-controls"), $("#difference-panel"), $("#ratio-panel"), $("#d3-panel")];
    if (!targetComparison || !references.length) {
      panels.forEach((panel) => { panel.hidden = true; });
      preparedMatches = null;
      return;
    }
    panels.forEach((panel) => { panel.hidden = false; });
    const category = $("#match-category").value;
    const candidates = category === "all" ? references : references.filter((row) => row[0] === category);
    preparedMatches = core.prepareMatches(targetComparison.actual, targetComparison.calculated, candidates);
    preparedSelectedName = selectedName;
    const slider = $("#metric-limit");
    slider.max = String(preparedMatches.furthestDistance);
    slider.value = String(Math.min(state.metricLimit, preparedMatches.furthestDistance));
    $("#metric-max-label").textContent = preparedMatches.furthestDistance.toFixed(3);
    renderRankedMatches();
  }

  function renderRankedMatches() {
    if (!preparedMatches) return;
    const metricLimit = Number($("#metric-limit").value);
    $("#metric-limit-value").textContent = metricLimit.toFixed(3);
    const lists = core.rankMatches(preparedMatches, 10, metricLimit);
    const selectedName = preparedSelectedName;
    $("#actual-matches-title").textContent = `Up to 10 closest to entered ${selectedName}`;
    $("#calculated-matches-title").textContent = `Up to 10 closest to calculated ${selectedName}`;
    renderMatchTable($("#actual-matches"), lists.actual, { otherTargetName: `calculated ${selectedName}`, distanceKey: "ac" });
    renderMatchTable($("#calculated-matches"), lists.calculated, { otherTargetName: `entered ${selectedName}`, distanceKey: "bc" });
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
    if (distanceKey) headings.push("Genetic distance (Euclidean)");
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
      const button = makeButton(row[1], () => setTarget({ category: row[0], label: row[1], values: row.slice(2) }));
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
    button.addEventListener("click", () => { state.mode = Number(button.dataset.mode); render(); });
  });
  $("#clear-all").addEventListener("click", () => {
    state.single = null;
    state.offspring = null;
    for (const mode of [2, 4, 8, 16]) {
      state.slots[mode].fill(null);
      state.selectedIndexByMode[mode] = null;
    }
    state.metricLimit = 10;
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
  $("#reference-search").addEventListener("input", renderReferences);
  $("#reference-category").addEventListener("change", renderReferences);
  $("#match-category").addEventListener("change", render);
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
