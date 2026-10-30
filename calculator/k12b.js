(function (root) {
  "use strict";

  const labels = ["Gedrosia", "Siberian", "Northwest_African", "Southeast_Asian", "Atlantic_Med", "North_European", "South_Asian", "East_African", "Southwest_Asian", "East_Asian", "Caucasus", "Sub_Saharan"];
  const colors = ["#e94a4a", "#ec8c36", "#a9784c", "#e4c845", "#9eae49", "#91ba62", "#4daa75", "#5bbca0", "#4daeb4", "#7187d0", "#a77bbf", "#c98ac8"];

  function parseProfile(raw) {
    const text = String(raw || "").trim();
    if (!text) throw new Error("Paste a K12b profile first.");
    const found = new Map();
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:\d+[.)\s]+)?([A-Za-z_]+)\s*[,\t:\s-]+\s*([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*%?\s*$/i);
      if (!match) continue;
      const index = labels.findIndex((label) => label.toLowerCase() === match[1].toLowerCase());
      if (index >= 0) {
        if (found.has(index)) throw new Error("The profile repeats a K12b component.");
        found.set(index, Number(match[2]));
      }
    }
    let values;
    if (found.size === 12) values = labels.map((_, i) => found.get(i));
    else if (found.size) throw new Error("Include all twelve labeled K12b components.");
    else {
      const parts = text.includes(",") || text.includes(";") ? text.split(/[,;]+/).map((v) => v.trim()).filter(Boolean) : text.split(/\s+/).filter(Boolean);
      const numeric = parts.length === 13 ? parts.slice(1) : parts;
      if (numeric.length !== 12 || !numeric.every((v) => /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i.test(v)))
        throw new Error("Use twelve labeled lines or twelve comma-separated percentages in K12b order.");
      values = numeric.map((v) => Number(v.replace("%", "")));
    }
    if (!values.every((v) => Number.isFinite(v) && v >= 0)) throw new Error("K12b percentages must be finite, nonnegative numbers.");
    const total = values.reduce((a, b) => a + b, 0);
    if (!(total > 0)) throw new Error("At least one K12b component must be above zero.");
    return values.map((v) => v * 100 / total);
  }

  function vectorRows(rows) {
    return (rows || []).filter((row) => Array.isArray(row) && row.length === 13 && typeof row[0] === "string" && row.slice(1).every((v) => Number.isFinite(v)));
  }
  function distance(a, b) { return Math.hypot(...a.map((v, i) => v - b[i])); }
  function nearest(target, rows, count = 15) {
    return vectorRows(rows).map((row) => ({ name: row[0], distance: distance(target, row.slice(1)) }))
      .sort((a, b) => a.distance - b.distance).slice(0, count);
  }
  function twoWay(target, rows, count = 10) {
    const data = vectorRows(rows), best = [];
    for (let i = 0; i < data.length - 1; i++) for (let j = i + 1; j < data.length; j++) {
      const a = data[i].slice(1), b = data[j].slice(1);
      let dot = 0, span = 0;
      for (let k = 0; k < 12; k++) { const delta = a[k] - b[k]; dot += (target[k] - b[k]) * delta; span += delta * delta; }
      if (span < 1e-12) continue;
      const weight = Math.max(0, Math.min(1, dot / span));
      const fit = b.map((v, k) => v + weight * (a[k] - v));
      const result = { name: data[i][0], other: data[j][0], weight, distance: distance(target, fit) };
      if (best.length < count || result.distance < best[best.length - 1].distance) {
        best.push(result); best.sort((x, y) => x.distance - y.distance); best.length = Math.min(count, best.length);
      }
    }
    return best;
  }

  const referenceData = root.G25_K12B_DATA ||
    (typeof module !== "undefined" && module.exports ? require("./k12b_data.js") : null);
  if (!referenceData) throw new Error("K12b reference data was not loaded.");

  function referenceRows(id, category = "modern") {
    if (!["modern", "ancient", "all"].includes(category)) throw new Error("Unknown K12b reference category.");
    const periods = referenceData.sets[id];
    if (!periods) throw new Error("Unknown K12b reference set.");
    return category === "all" ? periods.modern.concat(periods.ancient) : periods[category];
  }

  const api = { labels, colors, parseProfile, distance, nearest, twoWay, referenceRows };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (!root.document) return;

  const $ = (id) => root.document.getElementById(id);
  const views = ["chart", "oracle"];
  let selectedView = "chart";
  let currentValues = null;
  const error = (message) => { $("k12b-error").textContent = message; $("k12b-error").hidden = !message; };
  function appendText(parent, tag, value, className) {
    const el = root.document.createElement(tag);
    el.textContent = value;
    if (className) el.className = className;
    parent.append(el);
    return el;
  }
  function selectView(view) {
    selectedView = view;
    for (const name of views) {
      const active = name === view, tab = $("raw-k12b-" + name + "-tab");
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      $("raw-k12b-" + name).hidden = !active;
    }
  }
  function renderSummary(values) {
    const container = $("k12b-summary"); container.replaceChildren();
    const east = values[1] + values[3] + values[9];
    const eastCard = appendText(container, "div", "", "k12b-summary-card");
    appendText(eastCard, "span", "East Eurasian component sum");
    appendText(eastCard, "strong", `${east.toFixed(2)}%`);
    const oguzCard = appendText(container, "div", "", "k12b-summary-card");
    appendText(oguzCard, "span", "Oğuz/Türkmen heuristic");
    appendText(oguzCard, "strong", east <= 40 ? `${(east * 2.1).toFixed(1)}–${Math.min(100, east * 2.8).toFixed(1)}%` : "Outside range");
    container.hidden = false;
  }
  function renderMatches(values) {
    const container = $("k12b-matches"); container.replaceChildren();
    const category = $("k12b-reference-category").value;
    const sets = [
      ["Closest populations", "yakinlik1", nearest],
      [category === "modern" ? "Turkey province references" : "Expanded references", "yakinlik2tr", nearest],
      ["Two-population fits", "ikili1", twoWay],
      ["Turkey two-population fits", "ikili2tr", twoWay],
    ];
    for (const [title, id, calculate] of sets) {
      const rows = referenceRows(id, category);
      if (!rows.length) continue;
      const box = appendText(container, "section", "", "k12b-match-set");
      appendText(box, "h3", title);
      const list = appendText(box, "ol", "");
      for (const result of calculate(values, rows)) {
        const row = appendText(list, "li", "");
        appendText(row, "span", result.distance.toFixed(3), "k12b-distance");
        const name = result.other ? `${(result.weight * 100).toFixed(1)}% ${result.name} + ${((1 - result.weight) * 100).toFixed(1)}% ${result.other}` : result.name;
        appendText(row, "span", name.replaceAll("_", " "));
      }
    }
    container.hidden = false;
  }
  function generate() {
    error("");
    let values;
    try { values = parseProfile($("k12b-input").value); }
    catch (e) {
      currentValues = null;
      error(e.message);
      $("k12b-summary").hidden = true;
      $("k12b-matches").hidden = true;
      return;
    }
    currentValues = values;
    root.G25AdmixtureCharts.render({ chart: $("k12b-chart"), table: $("k12b-table"), components: labels, values, colors });
    renderSummary(values); renderMatches(values);
  }
  function reset() {
    selectView("chart");
    currentValues = null;
    $("k12b-input").value = "";
    for (const id of ["k12b-chart", "k12b-table", "k12b-summary", "k12b-matches"]) $(id).replaceChildren();
    $("k12b-summary").hidden = true;
    $("k12b-matches").hidden = true;
    error("");
  }
  function setProfile(proportions) {
    if (!Array.isArray(proportions) || proportions.length !== 12 || !proportions.every((v) => Number.isFinite(v) && v >= 0)) return;
    $("k12b-input").value = proportions.map((v, i) => `${labels[i]}\t${(v * 100).toFixed(5)}`).join("\n");
    generate();
  }
  for (const view of views) $("raw-k12b-" + view + "-tab").addEventListener("click", () => selectView(view));
  root.document.querySelector(".k12b-subtabs").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = views.indexOf(selectedView);
    const view = event.key === "Home" ? views[0] : event.key === "End" ? views[views.length - 1] :
      views[(index + (event.key === "ArrowRight" ? 1 : views.length - 1)) % views.length];
    selectView(view);
    $("raw-k12b-" + view + "-tab").focus();
  });
  $("k12b-generate").addEventListener("click", generate);
  $("k12b-clear").addEventListener("click", reset);
  $("k12b-reference-category").addEventListener("change", () => {
    if (currentValues) renderMatches(currentValues);
  });
  root.G25K12BUI = { setProfile, reset };
})(typeof window === "undefined" ? globalThis : window);
