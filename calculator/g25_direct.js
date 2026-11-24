(function (root) {
  "use strict";

  function decode(buffer) {
    const view = new DataView(buffer), bytes = new Uint8Array(buffer);
    const signature = new TextDecoder().decode(bytes.subarray(0, 8));
    if (signature !== "G25BLSQ2" && signature !== "G25BLSQ3") throw new Error("Invalid G25 kgocmen algorithm model.");
    let offset = 8;
    const takeU32 = () => { const value = view.getUint32(offset, true); offset += 4; return value; };
    const takeF32 = (count) => {
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++, offset += 4) out[i] = view.getFloat32(offset, true);
      return out;
    };
    const takeF64 = (count) => {
      const out = new Float64Array(count);
      for (let i = 0; i < count; i++, offset += 8) out[i] = view.getFloat64(offset, true);
      return out;
    };
    const n = takeU32();
    if (n < 10000 || n > 200000) throw new Error("Invalid G25 kgocmen algorithm marker count.");
    const count = signature === "G25BLSQ3" ? takeU32() : 2;
    if (count < 1 || count > 3) throw new Error("Invalid G25 kgocmen algorithm axis count.");
    const ids = new Uint32Array(n);
    for (let i = 0; i < n; i++) ids[i] = takeU32();
    const a1 = bytes.subarray(offset, offset + n); offset += n;
    const a2 = bytes.subarray(offset, offset + n); offset += n;
    const chrom = bytes.subarray(offset, offset + n); offset += n;
    const pos = new Uint32Array(n);
    for (let i = 0; i < n; i++) pos[i] = takeU32();
    const freq = takeF64(n);
    function mapper(axes) {
      const neighbors = takeU32();
      const power = view.getFloat64(offset, true); offset += 8;
      const strength = view.getFloat64(offset, true); offset += 8;
      const rows = takeU32();
      if (neighbors < 1 || neighbors > rows || rows > 20000) throw new Error("Invalid G25 kgocmen algorithm references.");
      return { axes, neighbors, power, strength, rows,
        a: takeF64(axes * 25), c: takeF64(25), train: takeF64(rows * 25),
        residual: takeF64(rows * 25) };
    }
    let bases;
    if (signature === "G25BLSQ2") {
      const scale50 = takeF64(50), scale100 = takeF64(100);
      const loadings50 = takeF32(n * 50), loadings100 = takeF32(n * 100);
      const gram50 = takeF64(50 * 50), gram100 = takeF64(100 * 100);
      bases = [
        { axes: 50, scale: scale50, loadings: loadings50, gram: gram50, mapper: mapper(50) },
        { axes: 100, scale: scale100, loadings: loadings100, gram: gram100, mapper: mapper(100) },
      ];
    } else {
      bases = [];
      for (let i = 0; i < count; i++) {
        const axes = takeU32();
        if (![25, 50, 100].includes(axes) || bases.some((basis) => basis.axes === axes)) {
          throw new Error("Invalid G25 kgocmen algorithm PCA axes.");
        }
        bases.push({ axes, scale: takeF64(axes), loadings: takeF32(n * axes),
          gram: takeF64(axes * axes), mapper: mapper(axes) });
      }
    }
    if (offset !== buffer.byteLength) throw new Error("Invalid G25 kgocmen algorithm model length.");
    return { n, ids, a1, a2, chrom, pos, freq, bases };
  }

  function solve(gram, rhs, scale) {
    const k = rhs.length, lower = new Float64Array(k * k), y = new Float64Array(k), output = new Float64Array(k);
    let trace = 0;
    for (let i = 0; i < k; i++) trace += gram[i * k + i];
    const ridge = 1e-6 * trace / k;
    for (let i = 0; i < k; i++) {
      for (let j = 0; j <= i; j++) {
        let value = gram[i * k + j] + (i === j ? ridge : 0);
        for (let m = 0; m < j; m++) value -= lower[i * k + m] * lower[j * k + m];
        lower[i * k + j] = i === j ? Math.sqrt(value) : value / lower[j * k + j];
        if (!Number.isFinite(lower[i * k + j])) throw new Error("G25 kgocmen algorithm projection could not be solved.");
      }
    }
    for (let i = 0; i < k; i++) {
      let value = rhs[i];
      for (let j = 0; j < i; j++) value -= lower[i * k + j] * y[j];
      y[i] = value / lower[i * k + i];
    }
    for (let i = k - 1; i >= 0; i--) {
      let value = y[i];
      for (let j = i + 1; j < k; j++) value -= lower[j * k + i] * output[j];
      output[i] = value / lower[i * k + i];
    }
    for (let i = 0; i < k; i++) output[i] *= scale[i];
    return output;
  }

  function project(calls, model, positionCalls = new Map()) {
    const states = model.bases.map((basis) => ({ basis, rhs: new Float64Array(basis.axes),
      gram: basis.gram.slice() }));
    const complement = [3, 2, 1, 0];
    const missing = [];
    let matched = 0;
    for (let i = 0; i < model.n; i++) {
      const code = calls.get(model.ids[i]) ?? positionCalls.get(model.ids[i]);
      if (code === undefined) { missing.push(i); continue; }
      let first = Math.floor(code / 4), second = code % 4;
      const a = model.a1[i], b = model.a2[i];
      let direct = (first === a || first === b) && (second === a || second === b);
      if (!direct) {
        first = complement[first]; second = complement[second];
        direct = (first === a || first === b) && (second === a || second === b);
      }
      if (!direct) { missing.push(i); continue; }
      const frequency = model.freq[i];
      const variance = 2 * frequency * (1 - frequency);
      const invSd = variance > 1e-12 ? Math.fround(1 / Math.sqrt(variance)) : 0;
      const x = Math.fround(Math.fround((first === a) + (second === a) - Math.fround(2 * frequency)) * invSd);
      matched++;
      for (const state of states) {
        const { axes, loadings } = state.basis, at = i * axes;
        for (let j = 0; j < axes; j++) state.rhs[j] += loadings[at + j] * x;
      }
    }
    for (const i of missing) {
      for (const state of states) {
        const { axes, loadings } = state.basis, gram = state.gram, at = i * axes;
        for (let j = 0; j < axes; j++) {
          const left = loadings[at + j], row = j * axes;
          for (let m = 0; m <= j; m++) {
            const value = left * loadings[at + m];
            gram[row + m] -= value;
            if (m !== j) gram[m * axes + j] -= value;
          }
        }
      }
    }
    return { local: states.map((state) => solve(state.gram, state.rhs, state.basis.scale)),
      matched, coverage: matched / model.n };
  }

  function mapped(local, mapper) {
    const baseline = new Float64Array(25);
    for (let j = 0; j < 25; j++) baseline[j] = mapper.c[j];
    for (let i = 0; i < mapper.axes; i++) {
      const at = i * 25;
      for (let j = 0; j < 25; j++) baseline[j] += local[i] * mapper.a[at + j];
    }
    const distances = [];
    for (let row = 0; row < mapper.rows; row++) {
      const at = row * 25;
      let d2 = 0;
      for (let j = 0; j < 25; j++) {
        const diff = baseline[j] - mapper.train[at + j];
        d2 += diff * diff;
      }
      distances.push([d2, row]);
    }
    distances.sort((a, b) => a[0] - b[0]);
    const result = Array.from(baseline), weights = [], correction = new Float64Array(25);
    let total = 0;
    for (let k = 0; k < mapper.neighbors; k++) {
      const weight = Math.pow(distances[k][0] + 1e-6, -mapper.power / 2);
      weights.push(weight); total += weight;
    }
    for (let k = 0; k < mapper.neighbors; k++) {
      const at = distances[k][1] * 25, weight = weights[k] / total;
      for (let j = 0; j < 25; j++) correction[j] += weight * mapper.residual[at + j];
    }
    for (let j = 0; j < 25; j++) result[j] += mapper.strength * correction[j];
    return result;
  }

  function predict(calls, model, positionCalls) {
    const projected = project(calls, model, positionCalls);
    // The Python blend maps the six-decimal local rows written by convert.py.
    const components = projected.local.map((local, i) => mapped(
      local.map((value) => Number(value.toFixed(6))), model.bases[i].mapper));
    const values = components[0].map((_, i) =>
      components.reduce((sum, row) => sum + row[i], 0) / components.length);
    return { values, components, matched: projected.matched, coverage: projected.coverage };
  }

  const api = { decode, predict };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.G25Direct = api;
})(typeof self !== "undefined" ? self : globalThis);
