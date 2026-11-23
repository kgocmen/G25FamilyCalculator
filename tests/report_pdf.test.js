const test = require("node:test");
const assert = require("node:assert/strict");
const { buildReport, createPdf } = require("../calculator/report_pdf.js");
const k12b = require("../calculator/k12b.js");

test("PDF report includes requested sections in order and no four-way section", () => {
  const zero = Array(25).fill(0);
  const references = [
    ["modern", "Modern_near", ...zero.map((value, index) => index ? value : 0.01)],
    ["ancient", "Ancient_near", ...zero.map((value, index) => index ? value : 0.02)],
  ];
  const fit = { distance: 0.5, parts: [
    { label: "First_population", weight: 0.6 }, { label: "Second_population", weight: 0.4 },
  ] };
  const report = buildReport({ sample: "Sample", results: {
    k12b: { fit: { proportions: Array(12).fill(1 / 12) } },
    k36: { fit: { proportions: Array(36).fill(1 / 36) } },
  }, g25: zero, health: { matches: [{ id: "rs1800497", genotype: "CC", flag: "positive",
    meaning: "Example phenotype meaning." }], bloodType: { abo: "B", diplotype: "BO",
    observed: [{ id: "rs505922", genotype: "CT", alleleCount: 1 }] } }, references,
  analysisFits: { relaxedModern: [fit], relaxedAncient: [fit], strictModern: [fit] } });
  assert.deepEqual(report.sections.map(({ title }) => title), [
    "K12b row", "K36 row", "G25 row", "K12b Chart", "K12b Oracle · Modern",
    "K12b Oracle · Modern two-population fits", "K12b Oracle · Ancient",
    "K12b Oracle · All (Modern + Ancient)",
    "Analysis · Closest 10 modern", "Analysis · Closest 10 ancient",
    "Analysis · Two-way fits · Modern", "Analysis · Two-way fits · Ancient",
    "Analysis · Strict two-way fits · Modern", "Health",
  ]);
  assert.deepEqual(report.sections.map(({ pageBreakBefore }) => Boolean(pageBreakBefore)), [
    false, false, false, false, true, true, true, true, true, false, false, true, false, true,
  ]);
  assert.match(report.sections[0].entries[0].text, /^Sample_K12b,/);
  assert.match(report.sections[1].entries[0].text, /^Sample_K36,/);
  assert.match(report.sections[2].entries[0].text, /^Sample_simulated_scaled,/);
  assert.equal(report.sections[3].entries[0].values.length, 12);
  assert.match(report.sections[8].entries[1].text, /Modern near/);
  assert.match(report.sections[9].entries[1].text, /Ancient near/);
  assert.match(report.sections[12].entries[0].text, /60\.0% First population \+ 40\.0% Second population/);
  const health = report.sections.at(-1).entries;
  assert.ok(health.some((entry) => entry.type === "health" && entry.title.includes("rs505922")));
  assert.ok(health.some((entry) => entry.type === "health" && entry.title.includes("rs1800497") &&
    entry.meaning === "Example phenotype meaning."));
  assert.equal(health.find((entry) => entry.title?.includes("rs505922")).flag, "plain");
});

test("PDF G25 row preserves the selected calculation method", () => {
  const report = buildReport({ sample: "Sample", results: {}, g25: Array(25).fill(0.02),
    g25Label: "Sample_kgocmen_scaled", health: null });
  assert.match(report.sections[2].entries[0].text, /^Sample_kgocmen_scaled,0\.020000/);
});

test("PDF omits G25 and Analysis sections when the source is None", () => {
  const report = buildReport({ sample: "Sample", results: {}, g25: Array(25).fill(0.02),
    health: null, includeG25: false });
  assert.ok(report.sections.every(({ title }) => title !== "G25 row" && !title.startsWith("Analysis")));
  assert.ok(report.sections.some(({ title }) => title === "Health"));
});

test("PDF Health colors use the same neutral rules as the Health tab", () => {
  const report = buildReport({ sample: "Sample", results: {}, g25: null, references: [],
    health: { matches: [
      { id: "rs1800497", genotype: "CT", flag: "neutral", meaning: "Three-option neutral." },
      { id: "rs17070145", genotype: "CT", flag: "neutral", meaning: "Two-option neutral." },
    ], bloodType: { observed: [{ id: "rs505922", genotype: "CT", alleleCount: 1 }] } } });
  const cards = report.sections.at(-1).entries.filter((entry) => entry.type === "health");
  assert.equal(cards.find((entry) => entry.title.includes("rs1800497")).flag, "neutral-three");
  assert.equal(cards.find((entry) => entry.title.includes("rs17070145")).flag, "plain");
  assert.equal(cards.find((entry) => entry.title.includes("rs505922")).flag, "plain");
});

test("PDF modern Oracle includes the shared Medieval Turkic estimate and all two-population sets", () => {
  const report = buildReport({ sample: "Sample", results: { k12b: { fit: {
    proportions: [.1499, .039, .0301, 0, .1128, .0773, .023, 0, .1126, .0664, .3814, .0075],
  } } }, g25: null, health: null });
  const modern = report.sections.find(({ title }) => title === "K12b Oracle · Modern");
  assert.ok(modern.entries.some(({ text }) => text === "Medieval Turkic: 24%"));
  assert.ok(modern.entries.some(({ text }) => text === "Closest Turkey provinces"));
  const pairs = report.sections.find(({ title }) => title === "K12b Oracle · Modern two-population fits");
  assert.deepEqual(pairs.entries.filter(({ type }) => type === "subheading").map(({ text }) => text),
    ["Two-population fits (Global)", "Two-population fits (Global, 50/50)",
      "Two-population fits (Turkish)", "Two-population fits (Turkish, 50/50)"]);
  const headings = k12b.oracleSets("modern").map(([title]) => title);
  assert.deepEqual([...modern.entries, ...pairs.entries].filter(({ type }) => type === "subheading").map(({ text }) => text), headings);
  assert.ok(!JSON.stringify(report).includes("Oğuz/Türkmen"));
});

for (const [label, id] of [["Global", "ikili1"], ["Turkish", "ikili2tr"]])
test(`PDF ${label} modern 50/50 results show exactly equal proportions`, () => {
  const rows = k12b.referenceRows(id, "modern");
  const proportions = rows[0].slice(1).map((value, index) => (value + rows[1][index + 1]) / 200);
  const report = buildReport({ sample: "Sample", results: { k12b: { fit: { proportions } } }, g25: null, health: null });
  const pairs = report.sections.find(({ title }) => title === "K12b Oracle · Modern two-population fits");
  const start = pairs.entries.findIndex(({ text }) => text === `Two-population fits (${label}, 50/50)`);
  assert.ok(start >= 0);
  const end = pairs.entries.findIndex((entry, index) => index > start && entry.type === "subheading");
  const fits = pairs.entries.slice(start + 1, end < 0 ? undefined : end).filter(({ oracleName }) => oracleName);
  assert.ok(fits.length > 0);
  assert.ok(fits.every(({ oracleName }) => /^50\.0% .+ \+ 50\.0% .+$/.test(oracleName)));
  const labels = new Set(rows.map(([name]) => name.replaceAll("_", " ")));
  assert.ok(fits.every(({ oracleName }) => oracleName.split(" + ")
    .every((part) => labels.has(part.replace(/^50\.0% /, "")))));
  assert.ok(fits.some(({ oracleDistance }) => oracleDistance < 1e-8));
  for (const section of report.sections.filter(({ title }) => title.includes("Ancient") || title.includes("All")))
    assert.ok(!section.entries.some(({ text }) => text?.includes("50/50")));
});

test("PDF generator returns a valid PDF container", async () => {
  const jpeg = "data:image/jpeg;base64,/9j/2Q==";
  const context = { scale() {}, fillRect() {}, fillText() {}, beginPath() {}, moveTo() {},
    lineTo() {}, stroke() {}, measureText(text) { return { width: text.length * 6 }; } };
  const document = { createElement() { return { getContext() { return context; }, toDataURL() { return jpeg; } }; } };
  const row = "Çağrı_simulated_scaled," + Array(25).fill("0.000000").join(",");
  const pdf = createPdf({ sample: "Çağrı", sections: [{ title: "G25 row", entries: [
    { type: "row", text: row },
  ] }] }, document);
  assert.equal(pdf.type, "application/pdf");
  const text = Buffer.from(await pdf.arrayBuffer()).toString("latin1");
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /\/Type \/Page /);
  assert.match(text, /\/Subtype \/Image/);
  const exactRowHex = "FEFF" + Array.from({ length: row.length }, (_, index) =>
    row.charCodeAt(index).toString(16).padStart(4, "0")).join("");
  assert.ok(text.includes(`/ActualText <${exactRowHex}>`), "the complete row is selectable PDF text");
  assert.match(text, / 3 Tr /, "the selectable text layer must not cover the visible row");
  assert.match(text, /xref\n/);
  assert.match(text, /%%EOF\n$/);
});

test("PDF Oracle uses the source distance color on the number", () => {
  const drawn = [];
  const context = { scale() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    measureText(value) { return { width: value.length * 6 }; },
    fillText(value) { drawn.push([value, this.fillStyle]); } };
  const document = { createElement() { return { getContext() { return context; },
    toDataURL() { return "data:image/jpeg;base64,/9j/2Q=="; } }; } };
  createPdf({ sample: "Sample", sections: [{ title: "K12b Oracle", entries: [
    { type: "line", text: "1. 5.000 · Example", oracleRank: 1, oracleDistance: 5,
      oracleName: "Example" },
  ] }] }, document);
  assert.ok(drawn.some(([value, color]) => value === "5.000" && color === "#EABE34"));
  assert.ok(drawn.some(([value, color]) => value === "Example" && color === "#243d51"));
});

test("PDF Analysis colors only G25 distance text", () => {
  const drawn = [];
  const fills = [];
  const context = { scale() {}, fillRect() { fills.push(this.fillStyle); },
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    measureText(value) { return { width: value.length * 6 }; },
    fillText(value) { drawn.push([value, this.fillStyle]); } };
  const document = { createElement() { return { getContext() { return context; },
    toDataURL() { return "data:image/jpeg;base64,/9j/2Q=="; } }; } };
  createPdf({ sample: "Sample", sections: [{ title: "Analysis · Closest 10 modern", entries: [
    { type: "line", text: "1. 4.500 · Sample", g25Rank: 1, g25Distance: 4.5 },
  ] }] }, document);
  assert.ok(!fills.includes("#C73535"));
  assert.ok(drawn.some(([value, color]) => value === "4.500" && color === "#C73535"));
  assert.ok(drawn.some(([value, color]) => value === "1. " && color === "#243d51"));
});

test("PDF Oracle omits two-way fits when every distance is at least four", () => {
  const report = buildReport({ sample: "Sample", results: { k12b: { fit: {
    proportions: [1, ...Array(11).fill(0)],
  } } }, g25: null, health: null });
  for (const section of report.sections.filter(({ title }) => title.startsWith("K12b Oracle") &&
    (title.includes("two-population fits") || title.includes("Ancient") || title.includes("All")))) {
    const headings = section.entries.map((entry, index) => ({ ...entry, index })).filter((entry) =>
      entry.type === "subheading" && (entry.text.startsWith("Two-population fits") || entry.text === "Modern + ancient fits"));
    assert.ok(headings.length > 0);
    for (const { index } of headings) {
      assert.equal(section.entries[index + 1].text, "No fit below distance 4.");
      const next = section.entries.findIndex((entry, at) => at > index && entry.type === "subheading");
      assert.ok(!section.entries.slice(index + 1, next < 0 ? undefined : next)
        .some((entry) => Number.isFinite(entry.oracleDistance)));
    }
  }
});

test("PDF All Oracle includes modern and ancient mixed pairs", () => {
  const modern = k12b.referenceRows("ikili1", "modern")[0];
  const ancient = k12b.referenceRows("ikili1", "ancient")[0];
  const proportions = modern.slice(1).map((value, index) =>
    (value + ancient[index + 1]) / 200);
  const report = buildReport({ sample: "Sample", results: {
    k12b: { fit: { proportions } },
  }, g25: null, health: null });
  const all = report.sections.find(({ title }) => title === "K12b Oracle · All (Modern + Ancient)");
  assert.ok(!all.entries.some((entry) => entry.text === "Two-population fits"));
  assert.equal(all.entries.filter((entry) => entry.text === "Closest populations").length, 1);
  assert.equal(all.entries.slice(1, 16).filter((entry) => Number.isFinite(entry.oracleDistance)).length, 15);
  const mixedHeading = all.entries.findIndex((entry) => entry.text === "Modern + ancient fits");
  assert.ok(mixedHeading >= 0);
  const mixedFits = all.entries.slice(mixedHeading + 1).filter((entry) => Number.isFinite(entry.oracleDistance));
  assert.equal(mixedFits.length, 10);
  assert.ok(mixedFits.some((entry) => entry.oracleDistance < 1e-8 &&
    entry.oracleName.includes(modern[0].replaceAll("_", " ")) &&
    entry.oracleName.includes(ancient[0].replaceAll("_", " "))));
});

test("PDF keeps the requested Oracle, Analysis, and Health sections on pages 2 through 8", () => {
  const zero = Array(25).fill(0);
  const references = ["modern", "ancient"].flatMap((period) => Array.from({ length: 20 }, (_, index) =>
    [period, `${period}_reference_population_${index}_with_region_name`,
      ...zero.map((value, dimension) => dimension === 0 ? index / 10000 : value)]));
  const fit = { distance: 0.5, parts: [
    { label: "First_population_with_long_region_and_subgroup", weight: 0.6 },
    { label: "Second_population_with_long_region_and_subgroup", weight: 0.4 },
  ] };
  const report = buildReport({ sample: "Sample", results: {
    k12b: { fit: { proportions: Array(12).fill(1 / 12) } },
    k36: { fit: { proportions: Array(36).fill(1 / 36) } },
  }, g25: zero, health: { matches: [] }, references,
  analysisFits: { relaxedModern: Array(10).fill(fit), relaxedAncient: Array(10).fill(fit),
    strictModern: Array(10).fill(fit) } });
  const pages = [];
  const document = { createElement() {
    const lines = [];
    pages.push(lines);
    return { getContext() { return { scale() {}, fillRect() {}, beginPath() {}, moveTo() {},
      lineTo() {}, stroke() {}, measureText(value) { return { width: value.length * 6 }; },
      fillText(value) { lines.push(value); } }; },
    toDataURL() { return "data:image/jpeg;base64,/9j/2Q=="; } };
  } };
  createPdf(report, document);
  assert.equal(pages.length, 8);
  const sectionTitles = new Set(report.sections.map(({ title }) => title));
  assert.deepEqual(pages.map((lines) => lines.filter((line) => sectionTitles.has(line))), [
    ["K12b row", "K36 row", "G25 row", "K12b Chart"],
    ["K12b Oracle · Modern"],
    ["K12b Oracle · Modern two-population fits"],
    ["K12b Oracle · Ancient"],
    ["K12b Oracle · All (Modern + Ancient)"],
    ["Analysis · Closest 10 modern", "Analysis · Closest 10 ancient", "Analysis · Two-way fits · Modern"],
    ["Analysis · Two-way fits · Ancient", "Analysis · Strict two-way fits · Modern"],
    ["Health"],
  ]);
});
