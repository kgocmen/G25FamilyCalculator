(function (root) {
  "use strict";
  const data = root.G25_HEALTH_DATA ||
    (typeof module !== "undefined" && module.exports ? require("./health_data.js") : null);
  if (!data) throw new Error("Health reference data was not loaded.");
  const variants = data.variants;
  const categories = Object.entries(data.categories);
  const definitions = Object.fromEntries(variants.map(({ id, definition }) => [id, definition]));
  const byId = new Map(variants.map((variant) => [variant.id, variant]));
  const bases = "ACGT";
  const normalize = (value) => value.toUpperCase().split("").sort().join("");
  function matchCalls(calls, special = new Map()) {
    const matches = [];
    for (const { id, category, genotypes } of variants) {
      let genotype;
      if (id === "rs6152") genotype = special.get(6152);
      else {
        const code = calls.get(Number(id.slice(2)));
        if (code === undefined) continue;
        genotype = bases[code >> 2] + bases[code & 3];
      }
      if (!genotype) continue;
      const key = Object.keys(genotypes).find((candidate) => normalize(candidate) === normalize(genotype));
      if (key) matches.push({ id, genotype: normalize(genotype), category,
        flag: genotypes[key].flag, meaning: genotypes[key].meaning });
    }
    return matches;
  }

  const api = { variants, definitions, matchCalls };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.G25Health = api;
  if (!root.document) return;

  const $ = (id) => root.document.getElementById(id);
  function append(parent, tag, content, className) {
    const element = root.document.createElement(tag);
    element.textContent = content;
    if (className) element.className = className;
    parent.append(element);
    return element;
  }
  function reset() {
    $("k12b-health-status").textContent = "Sağlık sonuçları için yukarıdaki ham DNA analizini çalıştırın.";
    $("k12b-health-report").replaceChildren();
    $("k12b-health-report").hidden = true;
  }
  function setMatches(matches) {
    const report = $("k12b-health-report");
    report.replaceChildren();
    const valid = (matches || []).filter((item) => byId.has(item.id) &&
      /^[ACGT]{1,2}$/.test(item.genotype) && ["positive", "neutral", "negative"].includes(item.flag) &&
      typeof item.meaning === "string");
    $("k12b-health-status").textContent = valid.length
      ? `Ham DNA dosyanızda ${variants.length} sağlık belirtecinden ${valid.length} tanesi bulundu.`
      : "Ham DNA dosyanızda eşleşen sağlık belirteci bulunamadı.";
    for (const [category, heading] of categories) {
      const rows = valid.filter((item) => item.category === category);
      if (!rows.length) continue;
      const section = append(report, "section", "", "health-section");
      append(section, "h3", `${heading} · ${rows.length}`);
      const grid = append(section, "div", "", "health-grid");
      for (const item of rows) {
        const record = byId.get(item.id);
        const card = append(grid, "article", "", "health-card");
        const header = append(card, "div", "", "health-card-header");
        append(header, "h4", record.title);
        append(header, "span", item.id, "health-rsid");
        append(card, "p", `Tanım: ${record.definition}`, "health-definition");
        append(card, "p", `Fenotip yorumu: ${item.meaning}`, "health-meaning");
        const details = append(card, "div", "", "health-card-details");
        append(details, "strong", item.genotype, "health-genotype");
        const flag = `Kaynak etiketi: ${{ positive: "olumlu", neutral: "nötr", negative: "olumsuz" }[item.flag]}`;
        append(details, "span", flag, `health-flag health-flag-${item.flag}`);
      }
    }
    report.hidden = !valid.length;
  }
  root.G25HealthUI = { reset, setMatches };
  root.document.addEventListener("DOMContentLoaded", reset, { once: true });
})(typeof self === "undefined" ? globalThis : self);
