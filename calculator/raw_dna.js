(function (root) {
  "use strict";

  const BASES = "ACGT";
  function fields(line, delimiter) {
    const result = [];
    let value = "", quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (quoted && line[i + 1] === '"') { value += '"'; i++; }
        else quoted = !quoted;
      } else if (c === delimiter && !quoted) { result.push(value.trim()); value = ""; }
      else value += c;
    }
    if (quoted) throw new Error("A DNA row has an unclosed quote. Use the original MyHeritage export.");
    result.push(value.trim());
    return result;
  }

  function parse(text) {
    const calls = new Map(), conflicts = new Set();
    const stats = { rows: 0, noCalls: 0, nonAutosomal: 0, invalid: 0, duplicates: 0, conflicts: 0, build: "unspecified" };
    let columns = null, delimiter;
    for (let line of text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/)) {
      line = line.trim();
      if (!line) continue;
      if (line.startsWith("#")) {
        const build = line.match(/(?:build\s*=?\s*|GRCh)(\d+)/i);
        if (build) stats.build = build[1];
        if (!/^#+\s*"?RSID["\s,\t]/i.test(line)) continue;
        line = line.replace(/^#+\s*/, "");
      }
      if (!columns) {
        delimiter = line.includes("\t") ? "\t" : ",";
        const names = fields(line, delimiter).map((x) => x.toUpperCase().replace(/[ _]/g, ""));
        columns = { rs: names.indexOf("RSID"), chr: names.indexOf("CHROMOSOME"),
          result: names.indexOf("RESULT"), a: names.indexOf("ALLELE1"), b: names.indexOf("ALLELE2") };
        if (columns.result < 0) columns.result = names.indexOf("GENOTYPE");
        if (columns.rs < 0 || columns.chr < 0 || !names.includes("POSITION") ||
            (columns.result < 0 && (columns.a < 0 || columns.b < 0))) {
          throw new Error("Expected MyHeritage columns: RSID, CHROMOSOME, POSITION, RESULT (or ALLELE1 and ALLELE2).");
        }
        continue;
      }
      stats.rows++;
      const row = fields(line, delimiter);
      const chr = Number((row[columns.chr] || "").replace(/^chr/i, ""));
      if (!Number.isInteger(chr) || chr < 1 || chr > 22) { stats.nonAutosomal++; continue; }
      const id = /^rs([1-9]\d*)$/i.exec(row[columns.rs] || "");
      if (!id || Number(id[1]) > 0xffffffff) { stats.invalid++; continue; }
      const genotype = (columns.result >= 0 ? row[columns.result] || "" :
        (row[columns.a] || "") + (row[columns.b] || "")).toUpperCase();
      if (!/^[ACGT]{2}$/.test(genotype)) { stats.noCalls++; continue; }
      const first = BASES.indexOf(genotype[0]), second = BASES.indexOf(genotype[1]);
      const code = Math.min(first, second) * 4 + Math.max(first, second), rs = Number(id[1]);
      if (conflicts.has(rs)) { stats.duplicates++; continue; }
      if (calls.has(rs)) {
        stats.duplicates++;
        if (calls.get(rs) !== code) { calls.delete(rs); conflicts.add(rs); }
      } else calls.set(rs, code);
    }
    if (!columns) throw new Error("The file is empty or has no MyHeritage column header.");
    if (!calls.size) throw new Error("No usable autosomal SNP calls were found in this file.");
    stats.conflicts = conflicts.size;
    stats.usable = calls.size;
    return { calls, stats };
  }

  function decodeModel(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength < 16 || new TextDecoder().decode(new Uint8Array(buffer, 0, 8)) !== "G25RAW01") {
      throw new Error("Invalid allele-frequency model. Reload the page to retry.");
    }
    const n = view.getUint32(8, true), k = view.getUint32(12, true);
    const offset = 16 + n * 4 + n + (4 - n % 4) % 4;
    if (!n || ![12, 36].includes(k) || offset + n * k * 4 !== buffer.byteLength) {
      throw new Error("The allele-frequency model is incomplete.");
    }
    return { n, k, ids: new Uint32Array(buffer, 16, n), alleles: new Uint8Array(buffer, 16 + n * 4, n),
      frequencies: new Float32Array(buffer, offset, n * k) };
  }

  function match(calls, model) {
    const indices = [], dosages = [];
    const stats = { total: model.n, overlap: 0, flipped: 0, incompatible: 0, ambiguous: 0 };
    for (let i = 0; i < model.n; i++) {
      const code = calls.get(model.ids[i]);
      if (code === undefined) continue;
      stats.overlap++;
      let a = code >> 2, b = code & 3;
      const first = model.alleles[i] >> 2, second = model.alleles[i] & 3;
      // Without an external strand map, A/T and C/G sites cannot be aligned safely.
      if (first + second === 3) { stats.ambiguous++; continue; }
      const valid = (x) => x === first || x === second;
      if (!valid(a) || !valid(b)) {
        a = 3 - a; b = 3 - b;
        if (!valid(a) || !valid(b)) { stats.incompatible++; continue; }
        stats.flipped++;
      }
      indices.push(i);
      // The published frequency is for allele 2, not allele 1.
      dosages.push(Number(a === second) + Number(b === second));
    }
    const frequencies = new Float32Array(indices.length * model.k);
    indices.forEach((index, i) => frequencies.set(model.frequencies.subarray(index * model.k, (index + 1) * model.k), i * model.k));
    stats.matched = indices.length;
    stats.coverage = indices.length / model.n;
    return { frequencies, dosages: Uint8Array.from(dosages), k: model.k, stats };
  }

  function simplex(values) {
    const sorted = Array.from(values).sort((a, b) => b - a);
    let sum = 0, threshold = 0;
    for (let i = 0; i < sorted.length; i++) {
      sum += sorted[i];
      const t = (sum - 1) / (i + 1);
      if (sorted[i] > t) threshold = t;
    }
    return Float64Array.from(values, (v) => Math.max(0, v - threshold));
  }

  function evaluate(q, f, g, k, gradient = false) {
    const grad = gradient ? new Float64Array(k) : null;
    let loss = 0;
    for (let i = 0, offset = 0; i < g.length; i++, offset += k) {
      let p = 0;
      for (let j = 0; j < k; j++) p += q[j] * f[offset + j];
      p = Math.min(1 - 1e-10, Math.max(1e-10, p));
      loss -= g[i] * Math.log(p) + (2 - g[i]) * Math.log1p(-p);
      if (gradient) {
        const derivative = (2 - g[i]) / (1 - p) - g[i] / p;
        for (let j = 0; j < k; j++) grad[j] += derivative * f[offset + j];
      }
    }
    const scale = 2 * g.length;
    if (grad) for (let j = 0; j < k; j++) grad[j] /= scale;
    return { loss: loss / scale, grad };
  }

  // Spectral projected gradient on the simplex; deterministic, convex fixed-F likelihood.
  function fit(data, progress = () => {}, options = {}) {
    const { frequencies: f, dosages: g, k } = data;
    if (!g.length) throw new Error("No model SNPs matched the raw DNA file.");
    const maxIterations = options.maxIterations || 1200;
    const tolerance = options.tolerance || 1e-7;
    let q = new Float64Array(k).fill(1 / k), current = evaluate(q, f, g, k, true);
    let step = 1, converged = false, iteration = 0, residual = Infinity;
    for (; iteration < maxIterations; iteration++) {
      const projected = simplex(q.map((v, j) => v - current.grad[j]));
      residual = Math.max(...q.map((v, j) => Math.abs(v - projected[j])));
      if (residual < tolerance) { converged = true; break; }
      const target = simplex(q.map((v, j) => v - step * current.grad[j]));
      const direction = target.map((v, j) => v - q[j]);
      let slope = 0;
      for (let j = 0; j < k; j++) slope += direction[j] * current.grad[j];
      let alpha = 1, candidate, next;
      for (let search = 0; search < 40; search++) {
        candidate = q.map((v, j) => v + alpha * direction[j]);
        next = evaluate(candidate, f, g, k);
        if (next.loss <= current.loss + 1e-4 * alpha * slope + 1e-14) break;
        alpha *= .5;
      }
      next = evaluate(candidate, f, g, k, true);
      let ss = 0, sy = 0;
      for (let j = 0; j < k; j++) {
        const s = candidate[j] - q[j];
        ss += s * s; sy += s * (next.grad[j] - current.grad[j]);
      }
      step = sy > 0 ? Math.min(10000, Math.max(1e-4, ss / sy)) : 1;
      q = candidate; current = next;
      if (iteration % 20 === 0) progress({ iteration: iteration + 1, loss: current.loss });
    }
    return { proportions: Array.from(q), converged, iterations: iteration, residual, loss: current.loss };
  }

  function regress(proportions, regression, components) {
    if (regression.output !== "scaled" || regression.components.length !== 36 ||
        JSON.stringify(regression.components) !== JSON.stringify(components) ||
        regression.coefficients.length !== 36 || proportions.length !== 36 ||
        proportions.some((v) => !Number.isFinite(v) || v < 0) ||
        regression.coefficients.some((row) => row.length !== 25 || row.some((v) => !Number.isFinite(v)))) {
      throw new Error("The K36 regression model has an incompatible component order or scale.");
    }
    const total = proportions.reduce((a, b) => a + b, 0);
    if (!total) throw new Error("K36 proportions sum to zero.");
    return Array.from({ length: 25 }, (_, pc) => proportions.reduce((sum, weight, i) =>
      sum + weight / total * regression.coefficients[i][pc], 0));
  }

  const api = { fields, parse, decodeModel, match, simplex, evaluate, fit, regress };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.G25RawDNA = api;
})(typeof self !== "undefined" ? self : globalThis);
