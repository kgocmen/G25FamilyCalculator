const test = require("node:test");
const assert = require("node:assert/strict");
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
