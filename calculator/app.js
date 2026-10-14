(function () {
  "use strict";

  const references = window.G25_REFERENCES || [];
  const core = window.G25Core;
  const names = {
    2: ["Mother", "Father"],
    4: ["Paternal grandparent 1", "Paternal grandparent 2", "Maternal grandparent 1", "Maternal grandparent 2"],
    8: [
      "Paternal grandparent 1 · parent 1", "Paternal grandparent 1 · parent 2",
      "Paternal grandparent 2 · parent 1", "Paternal grandparent 2 · parent 2",
      "Maternal grandparent 1 · parent 1", "Maternal grandparent 1 · parent 2",
      "Maternal grandparent 2 · parent 1", "Maternal grandparent 2 · parent 2",
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
    male: false,
  };

  const $ = (selector) => document.querySelector(selector);
  const picker = $("#picker");
  let preparedMatches = null;
  let preparedSelectedName = "";

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
    $("#calculated-matches-group").hidden = mode === 1;
    $("#matches-note").hidden = mode === 1;
    $("#inputs-title").textContent = mode === 1 ? "G25 input" : "Family inputs";
    $("#inputs-intro").textContent = mode === 1
      ? "Choose a reference population or paste one G25 row."
      : "Choose a reference population or paste any G25 row for each person.";
    if (mode === 1) {
      renderSingle();
      return;
    }
    $("#matches-intro").textContent = "Each list ranks all reference populations by genetic distance from its selected target. Distances use Euclidean G25 × 100.";
    const ancestors = state.slots[mode];
    const male = mode === 2 && state.male;
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

    $("#male-option").hidden = mode !== 2;
    $("#male-toggle").checked = state.male;
    $("#male-weight-note").textContent = male ? "Mother 51% · Father 49%" : "Mother 50% · Father 50%";

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
      message = count === 1
        ? `Residual contribution calculated. The missing ${singular[mode].replaceAll("_", " ")} also has a full inferred row in its slot.`
        : `Combined contribution of ${count} missing ancestors calculated. Individual missing coordinates cannot be determined.`;
      output = core.formatLine(core.resultLabel(state.offspring, ancestors, male), result.values);
    } else if (state.offspring) {
      message = "Add ancestors to subtract their contribution from the offspring.";
    } else {
      message = `Fill all ${mode} ancestors to calculate offspring, or add offspring to calculate the missing contribution.`;
    }
    if (!references.length) message = "Reference data is unavailable. Reload the page.";
    $("#result-status").textContent = message;
    $("#result-line").value = output;
    $("#copy-result").disabled = !output;
    state.output = output;

    const comparisonText = $("#comparison");
    comparisonText.hidden = !targetComparison;
    if (targetComparison) {
      comparisonText.textContent = `Distance between entered and calculated ${selectedName}: ${targetComparison.distance.toFixed(3)} (Euclidean G25 distance × 100).`;
    }

    $("#method-note").textContent = male
      ? targetComparison && selectedIndex !== null
        ? `Calculated ${selectedName} = (offspring − ${weights[1 - selectedIndex]} × ${names[mode][1 - selectedIndex].toLowerCase()}) / ${weights[selectedIndex]}.`
        : result.kind === "residual"
          ? `Residual = offspring − each known parent's weighted contribution. With one blank, divide the residual by that parent's weight to infer their coordinates.`
          : "The calculated offspring is 51% mother + 49% father."
      : targetComparison && selectedIndex !== null
        ? `Calculated ${selectedName} = ${mode} × offspring − the other ${mode - 1} ancestors.`
        : result.kind === "residual"
          ? `Residual = offspring − ${1 / mode} × each known ancestor. With one blank, that ancestor's full inferred coordinates are ${mode} × residual.`
          : "The calculated offspring is the arithmetic average of all entered G25 ancestor rows.";
    renderMatches(targetComparison, selectedName);
  }

  function renderSingle() {
    preparedMatches = null;
    $("#single-row").replaceChildren(createRow("Sample", { type: "single" }, state.single, null));
    for (const selector of ["#metric-controls", "#difference-panel", "#ratio-panel", "#d3-panel"]) {
      $(selector).hidden = true;
    }
    $("#matches-panel").hidden = !state.single || !references.length;
    if (!state.single || !references.length) return;
    $("#matches-intro").textContent = "Reference populations ranked by genetic distance from the input. Distances use Euclidean G25 × 100.";
    const category = $("#match-category").value;
    const candidates = category === "all" ? references : references.filter((row) => row[0] === category);
    $("#actual-matches-title").textContent = `Up to 10 closest to ${state.single.label}`;
    renderMatchTable($("#actual-matches"), core.nearestMatches(state.single, candidates), { distanceKey: "distance" });
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

  function renderMatchTable(container, matches, { otherTargetName = "", distanceKey = null, metric = null, emptyMessage = "No matching populations in this reference set." }) {
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
        ? `${otherTargetName}: ${match.label}` : `${match.label} · ${match.category}`;
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
