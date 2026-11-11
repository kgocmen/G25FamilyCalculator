(function (root) {
  "use strict";
  const data = root.G25_HEALTH_DATA ||
    (typeof module !== "undefined" && module.exports ? require("./health_data.js") : null);
  if (!data) throw new Error("Health reference data was not loaded.");
  const variants = data.variants;
  const categories = Object.entries(data.categories);
  const definitions = Object.fromEntries(variants.map(({ id, definition }) => [id, definition]));
  const byId = new Map(variants.map((variant) => [variant.id, variant]));
  const bloodType = data.bloodType;
  const bases = "ACGT";
  const normalize = (value) => value.toUpperCase().split("").sort().join("");
  const genotypeAt = (calls, id) => {
    const code = calls.get(Number(id.slice(2)));
    return code === undefined ? null : bases[code >> 2] + bases[code & 3];
  };
  function cardTone(flag, genotypes) {
    if (flag !== "neutral") return flag;
    return new Set(Object.values(genotypes).map((entry) => entry.flag)).size === 3
      ? "neutral-three" : "plain";
  }
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

  function inferBloodType(calls, special = new Map()) {
    const ids = bloodType.markers;
    const direct = special.get(Number(ids.oDirect.slice(2)));
    const proxy = genotypeAt(calls, ids.oProxy);
    const primary = genotypeAt(calls, ids.bPrimary);
    const confirm = genotypeAt(calls, ids.bConfirm);
    const directCount = /^(DD|DI|II)$/.test(direct || "")
      ? [...direct].filter((allele) => allele === "D").length : null;
    const proxyCount = proxy && /^[CT]{2}$/.test(proxy)
      ? [...proxy].filter((allele) => allele === "T").length
      : proxy && /^[AG]{2}$/.test(proxy)
        ? [...proxy].filter((allele) => allele === "A").length : null;
    const oCount = directCount ?? proxyCount;
    const forward = primary && /^[GT]{2}$/.test(primary);
    const reverse = primary && /^[AC]{2}$/.test(primary);
    const bCount = forward ? [...primary].filter((allele) => allele === "T").length
      : reverse ? [...primary].filter((allele) => allele === "A").length : null;
    const confirmCount = confirm && /^[CG]{2}$/.test(confirm)
      ? [...confirm].filter((allele) => allele === (reverse ? "C" : "G")).length : null;
    const counts = new Map([[ids.oDirect, directCount], [ids.oProxy, proxyCount],
      [ids.bPrimary, bCount], [ids.bConfirm, confirmCount]]);
    const observed = [[ids.oDirect, direct], [ids.oProxy, proxy],
      [ids.bPrimary, primary], [ids.bConfirm, confirm]]
      .filter(([, genotype]) => Boolean(genotype))
      .map(([id, genotype]) => ({ id, genotype, alleleCount: counts.get(id) }));
    // RhD often depends on RHD copy number, which these SNP calls do not establish.
    const result = { abo: null, diplotype: null, basis: directCount !== null ? "direct"
      : proxyCount !== null ? "proxy" : "insufficient", observed, rhD: null };
    if (bCount !== null && confirmCount !== null && bCount !== confirmCount) {
      result.basis = "conflict";
      return result;
    }
    if (oCount === null) return result;
    if (result.basis === "proxy" && bCount === null) {
      result.basis = "insufficient";
      return result;
    }
    if (oCount === 2 && (bCount === null || bCount === 0)) {
      result.abo = "O";
      result.diplotype = "OO";
      return result;
    }
    if (bCount === null || bCount > 2 - oCount) {
      result.basis = bCount === null ? "insufficient" : "conflict";
      return result;
    }
    result.abo = bCount === 2 ? "B" : bCount === 1
      ? oCount === 1 ? "B" : "AB" : "A";
    result.diplotype = {
      "0:0": "AA", "0:1": "AB", "0:2": "BB", "1:0": "AO", "1:1": "BO"
    }[`${oCount}:${bCount}`];
    return result;
  }

  const api = { variants, definitions, matchCalls, inferBloodType, cardTone };
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
    $("raw-health-status").textContent = "Sağlık sonuçları için yukarıdaki ham DNA analizini çalıştırın.";
    $("raw-health-report").replaceChildren();
    $("raw-health-report").hidden = true;
  }
  function appendBloodTypeSection(report, heading, bloodMarkers, bloodGroup) {
    const count = bloodMarkers.length + Number(Boolean(bloodGroup?.abo));
    const section = append(report, "section", "", "health-section");
    append(section, "h3", `${heading} · ${count}`);
    const grid = append(section, "div", "", "health-grid");
    for (const { id, genotype, alleleCount } of bloodMarkers) {
      const marker = bloodType.markerDetails[id];
      const card = append(grid, "article", "", "health-card");
      const header = append(card, "div", "", "health-card-header");
      append(header, "h4", marker.title);
      append(header, "span", id, "health-rsid");
      append(card, "p", `Tanım: ${marker.definition}`, "health-definition");
      append(card, "p", `Fenotip yorumu: ${bloodType.alleleMeanings[marker.allele][alleleCount]}`,
        "health-meaning");
      const details = append(card, "div", "", "health-card-details");
      append(details, "strong", genotype, "health-genotype");
    }
    if (bloodGroup?.abo) {
      const card = append(grid, "article", "", "health-card health-combined-card");
      const header = append(card, "div", "", "health-card-header");
      append(header, "h4", bloodType.title);
      append(card, "p", `Tanım: ${bloodType.definition}`, "health-definition");
      append(card, "p", `Fenotip yorumu: ${bloodType.meaning.replace("{abo}", bloodGroup.abo)}`,
        "health-meaning");
      const details = append(card, "div", "", "health-card-details");
      append(details, "span", "Muhtemel alel çifti:", "health-allele-label");
      append(details, "strong", bloodGroup.diplotype || bloodGroup.abo, "health-genotype");
    }
  }
  function setMatches(matches, bloodGroup) {
    const report = $("raw-health-report");
    report.replaceChildren();
    const valid = (matches || []).filter((item) => byId.has(item.id) &&
      /^[ACGT]{1,2}$/.test(item.genotype) && ["positive", "neutral", "negative"].includes(item.flag) &&
      typeof item.meaning === "string");
    const bloodMarkers = bloodType && Array.isArray(bloodGroup?.observed)
      ? bloodGroup.observed.filter((item) =>
        bloodType.markerDetails[item.id] && typeof item.genotype === "string" &&
        Number.isInteger(item.alleleCount) && item.alleleCount >= 0 && item.alleleCount <= 2) : [];
    const foundCount = valid.length + bloodMarkers.length;
    const markerCount = variants.length + Object.keys(bloodType.markerDetails).length;
    $("raw-health-status").textContent = foundCount
      ? `Ham DNA dosyanızda ${markerCount} sağlık belirtecinden ${foundCount} tanesi bulundu.`
      : "Ham DNA dosyanızda eşleşen sağlık belirteci bulunamadı.";
    for (const [category, heading] of categories) {
      if (category === bloodType.category) {
        if (bloodMarkers.length || bloodGroup?.abo) {
          appendBloodTypeSection(report, heading, bloodMarkers, bloodGroup);
        }
        continue;
      }
      const rows = valid.filter((item) => item.category === category);
      if (!rows.length) continue;
      const section = append(report, "section", "", "health-section");
      append(section, "h3", `${heading} · ${rows.length}`);
      const grid = append(section, "div", "", "health-grid");
      for (const item of rows) {
        const record = byId.get(item.id);
        const tone = cardTone(item.flag, record.genotypes);
        const cardColor = tone === "plain" ? "" : ` health-card-${tone}`;
        const card = append(grid, "article", "", `health-card${cardColor}`);
        const header = append(card, "div", "", "health-card-header");
        append(header, "h4", record.title);
        append(header, "span", item.id, "health-rsid");
        append(card, "p", `Tanım: ${record.definition}`, "health-definition");
        append(card, "p", `Fenotip yorumu: ${item.meaning}`, "health-meaning");
        const details = append(card, "div", "", "health-card-details");
        append(details, "strong", item.genotype, "health-genotype");
      }
    }
    report.hidden = !valid.length && !bloodMarkers.length && !bloodGroup?.abo;
  }
  root.G25HealthUI = { reset, setMatches };
  root.document.addEventListener("DOMContentLoaded", reset, { once: true });
})(typeof self === "undefined" ? globalThis : self);
