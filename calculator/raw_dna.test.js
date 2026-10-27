const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const raw = require("./raw_dna.js");

function dnaZip(text, method = 8) {
  const name = Buffer.from("dna-data/AncestryDNA.txt");
  const source = Buffer.from(text);
  const packed = method === 8 ? zlib.deflateRawSync(source) : source;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 6); // Data descriptor: lengths come from the central directory.
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(name.length, 26);
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(packed.length, 8);
  descriptor.writeUInt32LE(source.length, 12);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(source.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + packed.length + descriptor.length, 16);
  const file = new Blob([local, name, packed, descriptor, central, name, end]);
  file.name = "dna-data.zip";
  return file;
}

test("MyHeritage quoted CSV handles comments, no-calls, sex chromosomes and conflicting duplicates", () => {
  const input = '\uFEFF##reference=build37\r\n# MyHeritage DNA raw data\r\n#RSID,CHROMOSOME,POSITION,RESULT\r\n' +
    '"rs1","1","100","AG"\r\n"rs1","1","100","GA"\r\n' +
    '"rs2","2","200","--"\r\n"rs3","X","300","AA"\r\n' +
    '"rs4","1","400","CC"\r\n"rs4","1","400","CT"\r\n"rs4","1","400","CC"\r\n' +
    '"rs5","22","1,234","TT"\r\n"rs6","3","600","DI"\r\n"VG7","1","700","AA"';
  const { calls, stats } = raw.parse(input);
  assert.deepEqual([...calls], [[1, 2], [5, 15]]);
  assert.equal(stats.build, "37");
  assert.equal(stats.conflicts, 1);
  assert.equal(stats.duplicates, 3);
  assert.equal(stats.noCalls, 2);
  assert.equal(stats.nonAutosomal, 1);
  assert.equal(stats.invalid, 1);
});

test("MyHeritage split alleles, tab-separated columns and reordered CSV headers", () => {
  const a = raw.parse("rsID\tChromosome\tPosition\tAllele 1\tAllele 2\nrs25\tchr1\t123\tA\tG\nrs26\t2\t4\t0\t0");
  const b = raw.parse('RESULT,POSITION,RSID,CHROMOSOME\nAG,123,rs25,1');
  assert.deepEqual([...a.calls], [...b.calls]);
  assert.equal(a.stats.noCalls, 1);
  assert.throws(() => raw.parse("nonsense\n1,2,3"), /Expected DNA columns/);
  assert.throws(() => raw.parse("# comments"), /empty/);
  assert.throws(() => raw.parse("RSID,CHROMOSOME,POSITION,RESULT\nrs1,1,1,--"), /No usable/);
  assert.throws(() => raw.parse('RSID,CHROMOSOME,POSITION,RESULT\n"rs1,1,1,AG'), /unclosed quote/);
});

test("AncestryDNA split-allele TXT parses build, no-calls, indels, and duplicate calls", () => {
  const text = "#AncestryDNA raw data download\n#Data is from genome build 37\n" +
    "rsid\tchromosome\tposition\tallele1\tallele2\n" +
    "rs1\t1\t72017\tA\tG\nrs1\t1\t72017\tG\tA\n" +
    "rs2\t2\t400\tC\tC\nrs3\t3\t500\t0\t0\n" +
    "rs4\t4\t600\tI\tD\nrs5\t23\t700\tA\tA\n";
  const { calls, stats } = raw.parse(text);
  assert.deepEqual([...calls], [[1, 2], [2, 5]]);
  assert.equal(stats.build, "37");
  assert.equal(stats.usable, 2);
  assert.equal(stats.duplicates, 1);
  assert.equal(stats.noCalls, 2);
  assert.equal(stats.nonAutosomal, 1);
  assert.deepEqual([...raw.parse(text.replace("rsid\tchromosome", "#rsid\tchromosome")).calls], [...calls]);
  assert.deepEqual([...raw.parse("RSID,CHROMOSOME,POSITION,RESULT\nrs1,1,72017,GA\nrs2,2,400,CC").calls],
    [...calls]);
});

test("AncestryDNA download ZIP reads its TXT locally, including data-descriptor archives", async () => {
  const text = "#AncestryDNA raw data download\nrsid\tchromosome\tposition\tallele1\tallele2\nrs1\t1\t100\tA\tG\n";
  for (const method of [0, 8]) {
    const extracted = await raw.readRawText(dnaZip(text, method));
    assert.equal(extracted, text);
    assert.deepEqual([...raw.parse(extracted).calls], [[1, 2]]);
  }
  const plain = new Blob([text]); plain.name = "AncestryDNA.txt";
  assert.equal(await raw.readRawText(plain), text);
  const bad = new Blob(["not a zip"]); bad.name = "dna-data.zip";
  await assert.rejects(raw.readRawText(bad), /ZIP is invalid/);
});

test("matching counts the published second allele and complements only unambiguous sites", () => {
  const model = { n: 5, k: 2, ids: Uint32Array.from([1, 2, 3, 4, 5]),
    // A/G, A/G, A/G, A/T, A/G
    alleles: Uint8Array.from([2, 2, 2, 3, 2]),
    frequencies: Float32Array.from([.2,.8, .3,.7, .4,.6, .1,.9, .5,.5]) };
  const calls = raw.parse("RSID,CHROMOSOME,POSITION,RESULT\nrs1,1,1,GG\nrs2,1,2,AA\nrs3,1,3,CT\nrs4,1,4,AT\nrs5,1,5,AC").calls;
  const result = raw.match(calls, model);
  assert.deepEqual([...result.dosages], [2, 0, 1]);
  assert.equal(result.stats.flipped, 1);
  assert.equal(result.stats.incompatible, 1);
  assert.equal(result.stats.ambiguous, 1);
  assert.equal(result.stats.matched, 3);
  assert.equal(result.frequencies.length, 6);
});

test("fixed-frequency maximum likelihood recovers an analytic two-component optimum, including boundaries", () => {
  // Every marker has p(q) = .1 q0 + .9 q1. Empirical allele frequency is .3.
  const frequencies = Float32Array.from(Array.from({ length: 100 }, () => [.1, .9]).flat());
  const dosages = Uint8Array.from(Array.from({ length: 100 }, (_, i) => i < 30 ? 2 : 0));
  const fit = raw.fit({ frequencies, dosages, k: 2 });
  assert.ok(fit.converged);
  assert.ok(Math.abs(fit.proportions[1] - .25) < 1e-5);
  const boundary = raw.fit({ frequencies, dosages: new Uint8Array(100), k: 2 });
  assert.ok(boundary.converged);
  assert.ok(boundary.proportions[0] > 1 - 1e-6);
  assert.ok(Math.abs(fit.proportions.reduce((a, b) => a + b) - 1) < 1e-12);
});

test("likelihood gradient agrees with finite differences along the simplex", () => {
  const f = Float32Array.from([.1,.4,.9, .3,.6,.7, .8,.2,.5, .3,.9,.1]);
  const g = Uint8Array.from([0,1,2,1]), q = Float64Array.from([.2,.3,.5]);
  const { grad } = raw.evaluate(q, f, g, 3, true);
  const epsilon = 1e-6;
  for (let i = 0; i < 2; i++) {
    const up = q.slice(), down = q.slice();
    up[i] += epsilon; up[2] -= epsilon;
    down[i] -= epsilon; down[2] += epsilon;
    const numeric = (raw.evaluate(up, f, g, 3).loss - raw.evaluate(down, f, g, 3).loss) / (2 * epsilon);
    assert.ok(Math.abs(numeric - (grad[i] - grad[2])) < 1e-7);
  }
});

test("bundled model checksums, sizes, reference counts and frequencies are valid", () => {
  const manifest = require("./raw_data/manifest.json");
  for (const [id, info] of Object.entries(manifest.models)) {
    const compressed = fs.readFileSync(path.join(__dirname, "raw_data", info.file));
    assert.equal(compressed.length, info.bytes);
    assert.equal(crypto.createHash("sha256").update(compressed).digest("hex"), info.sha256);
    const bytes = zlib.gunzipSync(compressed);
    const model = raw.decodeModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    assert.equal(model.n, id === "k36" ? 165688 : 166770);
    assert.equal(model.k, info.components.length);
    assert.equal(new Set(model.ids).size, model.n);
    for (const frequency of model.frequencies) assert.ok(Number.isFinite(frequency) && frequency >= 0 && frequency <= 1);
    // Both original panels exclude palindromic SNPs.
    assert.ok(model.alleles.every((v) => (v >> 2) + (v & 3) !== 3));
    const reference = raw.match(new Map([[model.ids[0], model.alleles[0]]]), model);
    assert.equal(reference.dosages[0], 1);
  }
  assert.throws(() => raw.decodeModel(new ArrayBuffer(16)), /Invalid/);
});

test("regression preserves component order and uses fractions, with no second scaling", () => {
  const regression = require("./raw_data/k36_g25.json");
  const q = Array(36).fill(0); q[0] = 1;
  assert.deepEqual(raw.regress(q, regression, regression.components), regression.coefficients[0]);
  q[0] = 50; q[1] = 50;
  const actual = raw.regress(q, regression, regression.components);
  actual.forEach((v, pc) => assert.ok(Math.abs(v - (regression.coefficients[0][pc] + regression.coefficients[1][pc]) / 2) < 1e-12));
  assert.throws(() => raw.regress(q, regression, [...regression.components].reverse()), /component order/);
  assert.throws(() => raw.regress(Array(36).fill(0), regression, regression.components), /sum to zero/);
  assert.throws(() => raw.regress([...q.slice(0, 35), NaN], regression, regression.components), /incompatible/);
});

test("active regression reproduces the published converter's independent reference outputs", () => {
  const manifest = require("./raw_data/manifest.json");
  assert.equal(manifest.regression.file, "k36_g25_vbknethio.json");
  const bytes = fs.readFileSync(path.join(__dirname, "raw_data", manifest.regression.file));
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), manifest.regression.sha256);
  const model = JSON.parse(bytes);
  const reference = require("./raw_data/vbknethio_reference.json");
  assert.equal(model.id, manifest.regression.id);
  assert.equal(model.sourceSha256, reference.sourceSha256);
  assert.equal(model.validation.independentAccuracyEstimate, null);
  for (const fixture of reference.cases) {
    const actual = raw.regress(fixture.percentages.map((v) => v / 100), model, model.components);
    actual.forEach((v, pc) => assert.ok(Math.abs(v - fixture.expectedScaled[pc]) < 1e-12,
      `${fixture.name}: PC${pc + 1} differs from the original published formula`));
  }
});

test("published regression applies all intercepts once and converts fractions to percentages", () => {
  const model = require("./raw_data/k36_g25_vbknethio.json");
  const q = Array(36).fill(0); q[0] = .25; q[35] = .75;
  const actual = raw.regress(q, model, model.components);
  actual.forEach((v, pc) => assert.ok(Math.abs(v - (model.intercept[pc] +
    25 * model.coefficients[0][pc] + 75 * model.coefficients[35][pc])) < 1e-12));
  assert.throws(() => raw.regress(q, { ...model, input: "fractions" }, model.components), /incompatible/);
  assert.throws(() => raw.regress(q, { ...model, intercept: undefined }, model.components), /incompatible/);
  assert.throws(() => raw.regress(q, { ...model, intercept: Array(25).fill(NaN) }, model.components), /incompatible/);
  assert.throws(() => raw.regress(q, { ...model, output: "unscaled" }, model.components), /incompatible/);
  assert.throws(() => raw.regress(q, model, [...model.components].reverse()), /component order/);
});
