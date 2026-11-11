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

test("Health bundle uses the editable source without generic genotype placeholders", () => {
  const source = require("../data/ydnatr/health.json");
  assert.deepEqual(health.variants, source.variants);
  for (const marker of source.variants) {
    for (const interpretation of Object.values(marker.genotypes)) {
      assert.doesNotMatch(interpretation.meaning, /^Bu rs\d+ genotipi\b/, marker.id);
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
    assert.match(match.meaning, /kan testiyle/);
    if (genotype === "AA") assert.match(match.meaning, /G aleli yoktur/);
    else assert.match(match.meaning, new RegExp(`${genotype === "AG" ? "Bir" : "İki"} G aleli, daha yüksek Lp\\(a\\)`));
  }
});

test("APOE markers are explained independently and the e2-neutral result does not imply e3", () => {
  const result = (risk, protection) => {
    const parsed = raw.parse("RSID,CHROMOSOME,POSITION,RESULT\n" +
      `rs429358,19,1,${risk}\nrs7412,19,2,${protection}`);
    return new Map(health.matchCalls(parsed.calls, parsed.special).map((match) => [match.id, match]));
  };
  const noE2 = result("TT", "CC").get("rs7412");
  assert.equal(noE2.flag, "neutral");
  assert.match(noE2.meaning, /e2 aleli bulunmaz/);
  assert.doesNotMatch(noE2.meaning, /e3|e4/);
  assert.equal(result("CC", "CC").get("rs7412").meaning, noE2.meaning);
  const oneE2 = result("TT", "CT").get("rs7412");
  assert.match(oneE2.meaning, /bir kopyası/);
  assert.equal(result("CT", "CT").get("rs7412").meaning, oneE2.meaning);
  assert.match(result("TT", "TT").get("rs7412").meaning, /Homozigot.*iki kopyası/);
  assert.equal(result("TT", "CC").get("rs429358").meaning,
    result("TT", "CT").get("rs429358").meaning);
});

test("neutral markers use their own phenotype interpretation without a generic suffix", () => {
  const parsed = raw.parse("RSID,CHROMOSOME,POSITION,RESULT\nrs174537,11,1,CT");
  const match = health.matchCalls(parsed.calls, parsed.special).find(({ id }) => id === "rs174537");
  assert.equal(match.flag, "neutral");
  const source = health.variants.find(({ id }) => id === "rs174537");
  assert.equal(match.meaning, source.genotypes.CT.meaning);
});

test("Health comparisons explain the phenotype without genotype labels", () => {
  const data = require("../data/ydnatr/health.json");
  const faah = data.variants.find(({ id }) => id === "rs324420").genotypes.CA.meaning;
  assert.match(faah, /C\/C.*A\/A/);
  assert.doesNotMatch(faah, /Orta seviye yıkım hızı/);
  for (const variant of data.variants) {
    for (const entry of Object.values(variant.genotypes)) {
      assert.doesNotMatch(entry.meaning, /heterozigot/i, variant.id);
    }
  }
});

test("SLCO1B1 rs4149056 keeps the source's genotype-specific statin meanings", () => {
  const source = require("../data/ydnatr/health.json").variants.find(({ id }) => id === "rs4149056");
  const bundled = health.variants.find(({ id }) => id === "rs4149056");
  assert.deepEqual(bundled, source);
  assert.equal(bundled.genotypes.TT.meaning, "Kolesterol ilaçları beklenen düzeyde çalışır.");
  assert.equal(bundled.genotypes.CT.meaning,
    "Orta düzey statin ilişkili kas yıkımı (Miyopati) riski. Dozaj ayarlaması gerekebilir.");
  assert.equal(bundled.genotypes.CC.meaning,
    "Yüksek risk (Miyopati). Kolesterol ilaçları şiddetli kas ağrısına ve doku hasarına sebep olabilir.");
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
    ["A ya da B kan grubu olasılığı ve bir O aleli taşıyıcılığı.",
      "B ya da AB kan grubu olasılığı ve bir B aleli taşıyıcılığı.",
      "B ya da AB kan grubu olasılığı ve bir B aleli taşıyıcılığı."][index]])) {
    const cardText = content(card);
    assert.match(cardText, new RegExp(id));
    assert.match(cardText, new RegExp(genotype));
    assert.ok(cardText.includes(`Fenotip yorumu: ${meaning}`));
    assert.doesNotMatch(cardText, /nötr/);
  }
  const combined = cards[3];
  assert.match(content(combined), /Kan Grubu \(ABO\)/);
  assert.match(content(combined), /Fenotip yorumu: B kan grubu\./);
  assert.doesNotMatch(content(combined), /nötr/);
  assert.equal(combined.children[3].children[0].textContent, "Muhtemel alel çifti:");
  assert.equal(combined.children[3].children[1].textContent, "BO");
  assert.doesNotMatch(content(report), /Vekil O işaretleyicisi|düşük güven|RhD|laboratuvar testi|Kaynak etiketi/);
  assert.equal(elements.get("raw-health-report").hidden, false);
  assert.match(elements.get("raw-health-status").textContent, /101 sağlık belirtecinden 3 tanesi/);
  const metabolismMatch = { id: "rs4988235", genotype: "CT", category: "metabolism",
    flag: "positive", meaning: "Örnek fenotip yorumu." };
  root.G25HealthUI.setMatches([metabolismMatch], bloodGroup);
  assert.match(report.children[0].children[0].textContent, /Kan Grubu · 4/);
  assert.match(report.children[1].children[0].textContent, /Metabolizma/);
  root.G25HealthUI.setMatches([], { abo: null, basis: "insufficient", observed: [
    { id: "rs8176719", genotype: "DD", alleleCount: 2 },
  ] });
  assert.equal(elements.get("raw-health-report").children.length, 1);
  assert.match(content(elements.get("raw-health-report")), /Çift O aleli: kesin O kan grubu\./);
  assert.equal(elements.get("raw-health-report").hidden, false);
  root.G25HealthUI.setMatches([metabolismMatch]);
  assert.doesNotMatch(content(elements.get("raw-health-report")), /olumlu|olumsuz|nötr/);
  assert.doesNotMatch(content(elements.get("raw-health-report")), /Kaynak etiketi:/);
  root.G25HealthUI.setMatches([], { abo: null, basis: "insufficient", rhD: null, observed: [] });
  assert.equal(elements.get("raw-health-report").children.length, 0);
  assert.equal(elements.get("raw-health-report").hidden, true);
});

test("Health card colors follow available outcomes without outcome badges", () => {
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

  const cases = [
    ["rs1800497", "CC", "positive", "health-card health-card-positive"],
    ["rs1800497", "CT", "neutral", "health-card health-card-neutral-three"],
    ["rs1800497", "TT", "negative", "health-card health-card-negative"],
    ["rs17070145", "CT", "neutral", "health-card"],
    ["rs17070145", "TT", "positive", "health-card health-card-positive"],
    ["rs713598", "CC", "neutral", "health-card"],
  ];
  for (const [id, genotype, flag, cardClass] of cases) {
    const record = health.variants.find((variant) => variant.id === id);
    assert.equal(record.genotypes[genotype].flag, flag);
    root.G25HealthUI.setMatches([{ id, genotype, flag, category: record.category,
      meaning: record.genotypes[genotype].meaning }]);
    const card = elements.get("raw-health-report").children[0].children[1].children[0];
    assert.equal(card.className, cardClass);
    const details = card.children[3];
    assert.equal(details.children.length, 1);
    assert.equal(details.children[0].textContent, genotype);
  }
});
