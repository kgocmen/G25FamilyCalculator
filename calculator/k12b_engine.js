(function (root) {
  "use strict";

  const raw = root.G25RawDNA || (typeof module !== "undefined" && module.exports ? require("./raw_dna.js") : null);
  // Independently implement the mathematical procedure documented by the engine
  // used on Turkish Genomics, including its matching and termination conventions.
  // https://github.com/emre-tarhan/admixture/tree/8d9f0cbc856ee37c53593e8541eb17bd328187e2
  const method = "turkish-genomics-k12b-8d9f0cbc";
  const bases = "ACGT";

  function match(reportedCalls, model) {
    const rows = [], dosages = [], copies = [];
    const stats = { total: model.n, overlap: 0, matched: 0, partial: 0, flipped: 0, incompatible: 0 };
    for (let i = 0; i < model.n; i++) {
      const call = reportedCalls.get(model.ids[i]);
      if (call === undefined) continue;
      stats.overlap++;
      const first = bases[model.alleles[i] >> 2], second = bases[model.alleles[i] & 3];
      // The published engine uses the first and last reported characters and
      // counts each recognizable allele separately, without strand complements.
      const a = call[0], b = call[call.length - 1];
      const major = Number(a === second) + Number(b === second);
      const minor = Number(a === first) + Number(b === first);
      const observed = major + minor;
      if (!observed) { stats.incompatible++; continue; }
      rows.push(i); dosages.push(major); copies.push(observed);
      if (observed === 1) stats.partial++;
    }
    const frequencies = new Float64Array(rows.length * model.k);
    rows.forEach((row, i) => {
      for (let j = 0; j < model.k; j++) {
        // The audited K12b source has at most six decimal places. Recover those
        // exact decimals from the lossless-at-this-precision float32 bundle so
        // the likelihood stopping rule uses the same numbers as the Go engine.
        frequencies[i * model.k + j] = Math.round(model.frequencies[row * model.k + j] * 1e6) / 1e6;
      }
    });
    stats.matched = rows.length;
    stats.coverage = rows.length / model.n;
    return { frequencies, dosages: Uint8Array.from(dosages), copies: Uint8Array.from(copies), k: model.k, stats };
  }

  function evaluate(q, data) {
    const { frequencies: f, dosages: g, copies, k } = data;
    const grad = new Float64Array(k);
    let loss = 0;
    for (let i = 0, at = 0; i < g.length; i++, at += k) {
      let p = 0;
      for (let j = 0; j < k; j++) p += q[j] * f[at + j];
      p = Math.max(1e-9, Math.min(1 - 1e-9, p));
      const other = copies[i] - g[i];
      loss -= g[i] * Math.log(p) + other * Math.log(1 - p);
      const derivative = other / (1 - p) - g[i] / p;
      for (let j = 0; j < k; j++) grad[j] += derivative * f[at + j];
    }
    return { loss, grad };
  }

  function fit(data, progress = () => {}) {
    if (!data.dosages.length) throw new Error("No model alleles matched the raw DNA file.");
    let q = new Float64Array(data.k).fill(1 / data.k);
    let current = evaluate(q, data), rate = .001, termination = "iteration-limit", iterations = 0;
    for (; iterations < 5000;) {
      const proposal = raw.simplex(q.map((value, j) => value - rate * current.grad[j]));
      const next = evaluate(proposal, data);
      iterations++;
      if (next.loss < current.loss) {
        const improvement = current.loss - next.loss;
        q = proposal; current = next;
        if (improvement < 1e-4) { termination = "loss-change"; break; }
        rate *= 1.1;
      } else {
        rate /= 2;
        if (rate < 1e-10) { termination = "step-floor"; break; }
      }
      if (iterations % 20 === 0) progress({ iteration: iterations, loss: current.loss });
    }
    return { proportions: Array.from(q), converged: termination !== "iteration-limit",
      iterations, loss: current.loss, termination, method };
  }

  const api = { match, fit, method };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.G25K12bEngine = api;
})(typeof self !== "undefined" ? self : globalThis);
