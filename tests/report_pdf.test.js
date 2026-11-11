const test = require("node:test");
const assert = require("node:assert/strict");
const { buildReport, createPdf } = require("../calculator/report_pdf.js");

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

test("PDF Oracle omits two-way fits when every distance is at least four", () => {
  const report = buildReport({ sample: "Sample", results: { k12b: { fit: {
    proportions: [1, ...Array(11).fill(0)],
  } } }, g25: null, health: null });
  for (const section of report.sections.filter(({ title }) => title.startsWith("K12b Oracle") &&
    (title.includes("two-population fits") || title.includes("Ancient") || title.includes("All")))) {
    const twoWay = section.entries.findIndex((entry) => entry.text === "Two-population fits");
    assert.ok(twoWay >= 0);
    assert.equal(section.entries[twoWay + 1].text, "No fit below distance 4.");
    assert.ok(!section.entries.slice(twoWay + 1).some((entry) => Number.isFinite(entry.oracleDistance)));
  }
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
