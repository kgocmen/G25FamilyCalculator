const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const raw = require("../calculator/raw_dna.js");
const health = require("../calculator/health.js");

test("every reference marker has a readable definition", () => {
  assert.equal(Object.keys(health.definitions).length, health.variants.length);
  for (const { id, definition, genotypes } of health.variants) {
    assert.ok(definition.length > 25 && definition.endsWith("."), id);
    for (const [genotype, interpretation] of Object.entries(genotypes)) {
      assert.ok(interpretation.meaning.length > 15 && interpretation.meaning.endsWith("."), `${id}:${genotype}`);
    }
  }
});

test("Health uses genotypes from the same parsed raw DNA file", () => {
  const text = [
    "RSID,CHROMOSOME,POSITION,RESULT",
    "rs4988235,2,1,CT",
    "rs429358,19,2,TC",
    "rs7412,19,3,CC",
    "rs6152,X,4,G",
    "rs7903146,10,5,--",
    "rs1333049,9,6,GG",
  ].join("\n");
  const parsed = raw.parse(text);
  const matches = health.matchCalls(parsed.calls, parsed.special);
  assert.equal(parsed.stats.nonAutosomal, 1);
  assert.equal(parsed.stats.usable, 4);
  assert.deepEqual(matches.map(({ id }) => id).sort(), ["rs1333049", "rs429358", "rs4988235", "rs6152", "rs7412"].sort());
  assert.equal(matches.find(({ id }) => id === "rs4988235").genotype, "CT");
  assert.match(matches.find(({ id }) => id === "rs4988235").meaning, /yetişkinlikte/);
  assert.equal(matches.find(({ id }) => id === "rs429358").flag, "negative");
  assert.equal(matches.find(({ id }) => id === "rs6152").genotype, "G");
});

test("conflicting X-chromosome calls cannot produce a Health result", () => {
  const parsed = raw.parse("RSID,CHROMOSOME,POSITION,RESULT\nrs1,1,1,AA\nrs6152,X,2,A\nrs6152,X,2,G");
  assert.ok(!health.matchCalls(parsed.calls, parsed.special).some(({ id }) => id === "rs6152"));
});

test("LPA rs10455872 flags the G allele, not AA, as increased Lp(a) association", () => {
  for (const [genotype, flag] of [["AA", "positive"], ["AG", "negative"], ["GG", "negative"]]) {
    const parsed = raw.parse(`RSID,CHROMOSOME,POSITION,RESULT\nrs10455872,6,1,${genotype}`);
    const match = health.matchCalls(parsed.calls, parsed.special).find(({ id }) => id === "rs10455872");
    assert.equal(match?.flag, flag, genotype);
  }
});

test("ABO estimate combines the O deletion with two B markers", () => {
  const cases = [
    ["DD", "GG", "CC", "O", "OO"],
    ["DI", "GG", "CC", "A", "AO"],
    ["DI", "GT", "CG", "B", "BO"],
    ["II", "GT", "CG", "AB", "AB"],
    ["II", "TT", "GG", "B", "BB"],
    ["II", "GG", "CC", "A", "AA"],
    ["DI", "AC", "CG", "B", "BO"],
  ];
  for (const [deletion, b1, b2, expected, diplotype] of cases) {
    const parsed = raw.parse(`RSID,CHROMOSOME,POSITION,RESULT\nrs1,1,1,AA\n` +
      `rs8176719,9,2,${deletion}\nrs8176746,9,3,${b1}\nrs8176747,9,4,${b2}`);
    const result = health.inferBloodType(parsed.calls, parsed.special);
    assert.equal(result.abo, expected, `${deletion}/${b1}/${b2}`);
    assert.equal(result.diplotype, diplotype, `${deletion}/${b1}/${b2}`);
    assert.equal(result.basis, "direct");
    assert.equal(result.rhD, null);
    assert.equal(result.observed.find(({ id }) => id === "rs8176719").alleleCount,
      [...deletion].filter((allele) => allele === "D").length);
  }
});

test("ABO proxy is provisional and conflicting or missing markers stay unassigned", () => {
  const estimate = (rows) => {
    const parsed = raw.parse(`RSID,CHROMOSOME,POSITION,RESULT\nrs1,1,1,AA\n${rows}`);
    return health.inferBloodType(parsed.calls, parsed.special);
  };
  assert.deepEqual([estimate("rs505922,9,2,CT\nrs8176746,9,3,GT\nrs8176747,9,4,CG").abo,
    estimate("rs505922,9,2,CT\nrs8176746,9,3,GT\nrs8176747,9,4,CG").basis], ["B", "proxy"]);
  const twoMarker = estimate("rs505922,9,2,CT\nrs8176746,9,3,GT");
  assert.equal(twoMarker.abo, "B");
  assert.equal(twoMarker.diplotype, "BO");
  assert.equal(twoMarker.basis, "proxy");
  assert.equal(estimate("rs505922,9,2,CT").abo, null);
  assert.equal(estimate("rs8176719,9,2,II\nrs8176746,9,3,GT\nrs8176747,9,4,CC").basis,
    "conflict");
  assert.equal(estimate("rs8176746,9,3,GT\nrs8176747,9,4,CG").abo, null);
});

test("Health renders separate ABO marker cards with the likely blood group", () => {
  class Element {
    constructor() { this.children = []; this.textContent = ""; this.hidden = false; }
    append(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
  }
  const elements = new Map(["raw-health-status", "raw-health-report"].map((id) => [id, new Element()]));
  const document = { getElementById: (id) => elements.get(id), createElement: () => new Element(),
    addEventListener() {} };
  const root = { G25_HEALTH_DATA: require("../calculator/health_data.js"), document };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../calculator/health.js"), "utf8"),
    { self: root });
  const bloodGroup = { abo: "B", diplotype: "BO", basis: "proxy", rhD: null, observed: [
    { id: "rs505922", genotype: "CT", alleleCount: 1 },
    { id: "rs8176746", genotype: "GT", alleleCount: 1 },
    { id: "rs8176747", genotype: "CG", alleleCount: 1 },
  ] };
  root.G25HealthUI.setMatches([], bloodGroup);
  const content = (node) => [node.textContent, ...node.children.flatMap(content)].join(" ");
  const report = elements.get("raw-health-report");
  assert.equal(report.children.length, 1);
  assert.match(content(report.children[0].children[0]), /Kan Grubu · 4/);
  assert.doesNotMatch(content(report), /Birleşik ABO tahmini/);
  const cards = report.children[0].children[1].children;
  assert.equal(cards.length, 4);
  for (const [card, id, genotype, meaning] of cards.slice(0, 3).map((card, index) => [card,
    ["rs505922", "rs8176746", "rs8176747"][index], ["CT", "GT", "CG"][index],
    ["O aleli taşıyıcısı; muhtemel A veya B kan grubu.",
      "Muhtemel B veya AB kan grubu.", "Muhtemel B veya AB kan grubu."][index]])) {
    const cardText = content(card);
    assert.match(cardText, new RegExp(id));
    assert.match(cardText, new RegExp(genotype));
    assert.ok(cardText.includes(`Fenotip yorumu: ${meaning}`));
    assert.match(cardText, /nötr/);
  }
  const combined = cards[3];
  assert.match(content(combined), /Kan Grubu \(ABO\)/);
  assert.match(content(combined), /Fenotip yorumu: Muhtemel B kan grubu\./);
  assert.match(content(combined), /nötr/);
  assert.equal(combined.children[3].children[0].textContent, "Muhtemel alel çifti:");
  assert.equal(combined.children[3].children[1].textContent, "BO");
  assert.doesNotMatch(content(report), /Vekil O işaretleyicisi|düşük güven|RhD|laboratuvar testi|Kaynak etiketi/);
  assert.equal(elements.get("raw-health-report").hidden, false);
  assert.match(elements.get("raw-health-status").textContent, /101 sağlık belirtecinden 3 tanesi/);
  const metabolismMatch = { id: "rs4988235", genotype: "CT", category: "metabolism",
    flag: "positive", meaning: "Örnek fenotip yorumu." };
  root.G25HealthUI.setMatches([metabolismMatch], bloodGroup);
  assert.match(report.children[0].children[0].textContent, /Metabolizma/);
  assert.match(report.children[1].children[0].textContent, /Kan Grubu · 4/);
  root.G25HealthUI.setMatches([], { abo: null, basis: "insufficient", observed: [
    { id: "rs8176719", genotype: "DD", alleleCount: 2 },
  ] });
  assert.equal(elements.get("raw-health-report").children.length, 1);
  assert.match(content(elements.get("raw-health-report")), /Muhtemel O kan grubu\./);
  assert.equal(elements.get("raw-health-report").hidden, false);
  root.G25HealthUI.setMatches([metabolismMatch]);
  assert.match(content(elements.get("raw-health-report")), /olumlu/);
  assert.doesNotMatch(content(elements.get("raw-health-report")), /Kaynak etiketi:/);
  root.G25HealthUI.setMatches([], { abo: null, basis: "insufficient", rhD: null, observed: [] });
  assert.equal(elements.get("raw-health-report").children.length, 0);
  assert.equal(elements.get("raw-health-report").hidden, true);
});
