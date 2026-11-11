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
    "K12b Oracle · Ancient", "Analysis · Closest 10 modern", "Analysis · Closest 10 ancient",
    "Analysis · Two-way fits · Modern", "Analysis · Two-way fits · Ancient",
    "Analysis · Strict two-way fits · Modern", "Health",
  ]);
  assert.match(report.sections[0].entries[0].text, /^Sample_K12b,/);
  assert.match(report.sections[1].entries[0].text, /^Sample_K36,/);
  assert.match(report.sections[2].entries[0].text, /^Sample_simulated_scaled,/);
  assert.equal(report.sections[3].entries[0].values.length, 12);
  assert.match(report.sections[6].entries[1].text, /Modern near/);
  assert.match(report.sections[7].entries[1].text, /Ancient near/);
  assert.match(report.sections[10].entries[0].text, /60\.0% First population \+ 40\.0% Second population/);
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
