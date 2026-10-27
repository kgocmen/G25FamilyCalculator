(function (root) {
  "use strict";

  const BASES = "ACGT";
  const MAX_RAW_BYTES = 100 * 1024 * 1024;

  async function readRawText(file) {
    if (!file || !file.size || file.size > MAX_RAW_BYTES) {
      throw new Error("Choose a nonempty DNA file smaller than 100 MB.");
    }
    const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const zipped = /\.zip$/i.test(file.name || "") ||
      (header[0] === 0x50 && header[1] === 0x4b && header[2] === 3 && header[3] === 4);
    if (!zipped) return file.text();

    const bytes = await file.arrayBuffer();
    const view = new DataView(bytes);
    const start = Math.max(0, bytes.byteLength - 65557);
    let end = -1;
    for (let offset = bytes.byteLength - 22; offset >= start; offset--) {
      if (view.getUint32(offset, true) === 0x06054b50 &&
          offset + 22 + view.getUint16(offset + 20, true) === bytes.byteLength) {
        end = offset; break;
      }
    }
    if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) {
      throw new Error("The DNA ZIP is invalid or uses multiple archive parts.");
    }
    const count = view.getUint16(end + 10, true);
    let offset = view.getUint32(end + 16, true);
    const decoder = new TextDecoder();
    let entry = null;
    for (let index = 0; index < count; index++) {
      if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) {
        throw new Error("The DNA ZIP directory is incomplete.");
      }
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const next = offset + 46 + nameLength + extraLength + commentLength;
      if (next > end) throw new Error("The DNA ZIP directory is incomplete.");
      const name = decoder.decode(new Uint8Array(bytes, offset + 46, nameLength));
      if (/\.(txt|csv|tsv)$/i.test(name) && !name.startsWith("__MACOSX/")) {
        const candidate = { flags: view.getUint16(offset + 8, true),
          method: view.getUint16(offset + 10, true),
          compressed: view.getUint32(offset + 20, true),
          uncompressed: view.getUint32(offset + 24, true),
          local: view.getUint32(offset + 42, true) };
        if (/(?:ancestry|dna|genome)/i.test(name)) { entry = candidate; break; }
        if (!entry) entry = candidate;
      }
      offset = next;
    }
    if (!entry) throw new Error("The ZIP has no raw DNA TXT or CSV file.");
    if (entry.flags & 1) throw new Error("Encrypted DNA ZIP files are unsupported. Extract the TXT file first.");
    if (entry.uncompressed > MAX_RAW_BYTES || entry.compressed > MAX_RAW_BYTES) {
      throw new Error("The DNA text inside the ZIP exceeds 100 MB.");
    }
    if (![0, 8].includes(entry.method)) {
      throw new Error("This DNA ZIP compression method is unsupported. Extract the TXT file first.");
    }
    const local = entry.local;
    if (local + 30 > bytes.byteLength || view.getUint32(local, true) !== 0x04034b50) {
      throw new Error("The DNA ZIP entry is incomplete.");
    }
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (dataStart + entry.compressed > bytes.byteLength) {
      throw new Error("The DNA ZIP entry is incomplete.");
    }
    const packed = bytes.slice(dataStart, dataStart + entry.compressed);
    if (entry.method === 0) {
      if (packed.byteLength !== entry.uncompressed) throw new Error("The DNA ZIP entry has an invalid size.");
      return decoder.decode(packed);
    }
    if (typeof DecompressionStream === "undefined") {
      throw new Error("This browser cannot open DNA ZIP files. Extract the TXT file first.");
    }
    let stream;
    try { stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream("deflate-raw")); }
    catch (_) { throw new Error("This browser cannot open DNA ZIP files. Extract the TXT file first."); }
    const reader = stream.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_RAW_BYTES) throw new Error("The DNA text inside the ZIP exceeds 100 MB.");
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      if (error.message.includes("100 MB")) throw error;
      throw new Error("The DNA ZIP entry could not be decompressed.");
    }
    if (length !== entry.uncompressed) throw new Error("The DNA ZIP entry has an invalid size.");
    const output = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) { output.set(chunk, at); at += chunk.byteLength; }
    return decoder.decode(output);
  }

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
    if (quoted) throw new Error("A DNA row has an unclosed quote. Use the original DNA export.");
    result.push(value.trim());
    return result;
  }

  function parse(text) {
    const calls = new Map(), conflicts = new Set(), special = new Map(), specialConflicts = new Set();
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
          throw new Error("Expected DNA columns: RSID, CHROMOSOME, POSITION, and RESULT or ALLELE1 and ALLELE2.");
        }
        continue;
      }
      stats.rows++;
      const row = fields(line, delimiter);
      const chromosome = (row[columns.chr] || "").replace(/^chr/i, "").toUpperCase();
      const chr = Number(chromosome);
      if (!Number.isInteger(chr) || chr < 1 || chr > 22) {
        // Preserve the one X-chromosome marker in the Health reference table.
        // Haploid calls and two matching alleles both resolve to one base.
        if ((chromosome === "X" || chromosome === "23") && /^rs6152$/i.test(row[columns.rs] || "")) {
          const genotype = (columns.result >= 0 ? row[columns.result] || "" :
            (row[columns.a] || "") + (row[columns.b] || "")).toUpperCase();
          if (/^(A|G|AA|GG)$/.test(genotype) && !specialConflicts.has(6152)) {
            const allele = genotype[0];
            if (special.has(6152) && special.get(6152) !== allele) {
              special.delete(6152); specialConflicts.add(6152);
            } else special.set(6152, allele);
          }
        }
        stats.nonAutosomal++; continue;
      }
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
    if (!columns) throw new Error("The file is empty or has no DNA column header.");
    if (!calls.size) throw new Error("No usable autosomal SNP calls were found in this file.");
    stats.conflicts = conflicts.size;
    stats.usable = calls.size;
    return { calls, special, stats };
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
    const legacy = regression?.version === 1 && regression.input === "fractions summing to one";
    const published = regression?.version === 2 && regression.input === "percentages" &&
      Array.isArray(regression.intercept) && regression.intercept.length === 25 &&
      regression.intercept.every(Number.isFinite);
    if ((!legacy && !published) || regression.output !== "scaled" ||
        !Array.isArray(regression.components) || regression.components.length !== 36 ||
        JSON.stringify(regression.components) !== JSON.stringify(components) ||
        !Array.isArray(regression.coefficients) || regression.coefficients.length !== 36 ||
        !Array.isArray(proportions) || proportions.length !== 36 ||
        proportions.some((v) => !Number.isFinite(v) || v < 0) ||
        regression.coefficients.some((row) => !Array.isArray(row) || row.length !== 25 || row.some((v) => !Number.isFinite(v)))) {
      throw new Error("The K36 regression model has an incompatible component order or scale.");
    }
    const total = proportions.reduce((a, b) => a + b, 0);
    if (!total) throw new Error("K36 proportions sum to zero.");
    const scale = published ? 100 : 1;
    return Array.from({ length: 25 }, (_, pc) => proportions.reduce((sum, weight, i) =>
      sum + weight / total * scale * regression.coefficients[i][pc], published ? regression.intercept[pc] : 0));
  }

  const api = { fields, parse, readRawText, decodeModel, match, simplex, evaluate, fit, regress };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.G25RawDNA = api;
})(typeof self !== "undefined" ? self : globalThis);
