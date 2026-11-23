const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const zlib = require("node:zlib");

test("raw worker calculates K12b, K36 and the direct G25 blend independently", async () => {
  const calls = new Map([[1, 2]]), reportedCalls = new Map([[1, "AG"]]), special = new Map();
  const events = [], selected = [], fetched = [];
  const manifest = { directBlend: { file: "g25_blend.bin.gz", snps: 52961,
    bytes: 100, minCoverage: .99, sha256: "abcdef1234567890test" }, models: {
    k12b: { snps: 10000, components: Array(12).fill("component"), bytes: 1 },
    k36: { snps: 10000, components: Array(36).fill("component"), bytes: 1 },
  } };
  const fakeMatch = (k) => ({ k, stats: { matched: 10000, total: 10000 } });
  const self = { location: { href: "https://example.test/calculator/raw_dna_worker.js" },
    postMessage: (event) => events.push(event) };
  const context = vm.createContext({ self, URL, Response, Blob, DecompressionStream,
    importScripts() {},
    fetch: async (url) => {
      fetched.push(url);
      return url.pathname.endsWith("manifest.json")
        ? { ok: true, json: async () => manifest }
        : new Response(zlib.gzipSync(Buffer.from([url.pathname.includes("k12b") ? 12 : 36])));
    },
    G25Health: { matchCalls: () => [], inferBloodType: () => null },
    G25Direct: { decode: () => ({ n: 52961 }), predict: () => ({
      values: Array(25).fill(.02), matched: 52960, coverage: 52960 / 52961,
    }) },
    G25RawDNA: {
      readRawText: async () => "synthetic DNA",
      parse: () => ({ calls, reportedCalls, special, stats: {} }),
      matchPositionCalls: () => new Map(),
      decodeModel: (buffer) => ({ n: 10000, k: new Uint8Array(buffer)[0] }),
      match(input, model) {
        assert.equal(input, calls);
        assert.equal(model.k, 36);
        selected.push("k36"); return fakeMatch(36);
      },
      fit: () => ({ proportions: Array(36).fill(1 / 36), converged: false }),
    },
    G25K12bEngine: {
      match(input, model) {
        assert.equal(input, reportedCalls);
        assert.equal(model.k, 12);
        selected.push("k12b"); return fakeMatch(12);
      },
      fit: () => ({ proportions: Array(12).fill(1 / 12), converged: true, method: "turkish-genomics-k12b-8d9f0cbc" }),
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../calculator/raw_dna_worker.js"), "utf8"), context);
  await self.onmessage({ data: { file: { size: 100 } } });
  assert.deepEqual(selected, ["k12b", "k36"]);
  assert.equal(events.filter((event) => event.type === "result").length, 2);
  assert.equal(events.find((event) => event.type === "g25-blend").matched, 52960);
  assert.equal(fetched.find((url) => url.pathname.endsWith("g25_blend.bin.gz")).searchParams.get("v"), "abcdef1234567890");
  assert.equal(events.at(-1).type, "done");
  assert.equal(calls.size, 0);
  assert.equal(reportedCalls.size, 0);
});
