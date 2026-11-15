const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const raw = require("../calculator/raw_dna.js");
const engine = require("../calculator/k12b_engine.js");

test("K12b preserves reported partial calls and the last duplicate without changing filtered calls", () => {
  const parsed = raw.parse("RSID,CHROMOSOME,POSITION,RESULT\n" +
    "rs1,1,1,GG\nrs1,1,1,AA\nrs2,1,2,G0\nrs3,1,3,--\nrs4,X,4,G\nrs5,1,5,TT\n");
  assert.deepEqual([...parsed.reportedCalls], [[1, "AA"], [2, "G0"], [3, "--"], [4, "G"], [5, "TT"]]);
  assert.deepEqual([...parsed.calls], [[5, 15]]);
  assert.equal(parsed.stats.conflicts, 1);
});

test("K12b directly counts reported alleles without complementing reverse-strand calls", () => {
  const model = { n: 7, k: 2, ids: Uint32Array.from([1, 2, 3, 4, 5, 6, 7]),
    alleles: new Uint8Array(7).fill(2), // A/G
    frequencies: Float32Array.from(Array.from({ length: 7 }, () => [.123456, .654321]).flat()) };
  const calls = new Map([[1, "CT"], [2, "AG"], [3, "GG"], [4, "G0"], [5, "G"], [6, "--"], [7, "GC"]]);
  const matched = engine.match(calls, model);
  assert.deepEqual([...matched.dosages], [1, 2, 1, 2, 1]);
  assert.deepEqual([...matched.copies], [2, 2, 1, 2, 1]);
  assert.equal(matched.stats.matched, 5);
  assert.equal(matched.stats.overlap, 7);
  assert.equal(matched.stats.partial, 2);
  assert.equal(matched.stats.incompatible, 2);
  assert.equal(matched.stats.flipped, 0);
  assert.ok(matched.frequencies instanceof Float64Array);
  assert.deepEqual([...matched.frequencies.slice(0, 2)], [.123456, .654321]);
  assert.throws(() => engine.fit(engine.match(new Map(), model)), /No model alleles/);
});

test("K12b matches independent outputs from the published Turkish Genomics Go engine", () => {
  const reference = require("./fixtures/k12b_compatibility.json");
  const manifest = require("../calculator/raw_data/manifest.json");
  assert.equal(manifest.models.k12b.sourceSha256["K12b.12.F"], reference.frequencySourceSha256);
  const bytes = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, "../calculator/raw_data/k12b.bin.gz")));
  const model = raw.decodeModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  for (const c of reference.cases) {
    let state = c.seed;
    const random = () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const calls = new Map();
    for (let i = 0; i < c.count; i++) {
      const row = i * c.stride, first = "ACGT"[model.alleles[row] >> 2], second = "ACGT"[model.alleles[row] & 3];
      let p = 0;
      for (let j = 0; j < model.k; j++) p += c.q[j] * Math.round(model.frequencies[row * model.k + j] * 1e6) / 1e6;
      let call = (random() < p ? second : first) + (random() < p ? second : first);
      if (c.variant === "partial") {
        if (i % 11 === 0) call = [...call].map((a) => "TGCA"["ACGT".indexOf(a)]).join("");
        else if (i % 17 === 0) call = call[0] + "0";
        else if (i % 23 === 0) call = call[0];
      }
      if (c.variant === "missing" && i % 7 === 0) call = "--";
      calls.set(model.ids[row], call);
    }
    const matched = engine.match(calls, model);
    assert.equal(matched.stats.overlap, c.sourceMatched);
    const fit = engine.fit(matched);
    assert.ok(fit.converged, c.name);
    assert.equal(fit.method, engine.method);
    fit.proportions.forEach((value, j) => {
      assert.ok(Math.abs(value - c.expected[j]) < 1e-8, `${c.name}: component ${j} differs from Go reference`);
      assert.equal((100 * value).toFixed(2), (100 * c.expected[j]).toFixed(2), `${c.name}: displayed percentage differs`);
    });
  }
});
