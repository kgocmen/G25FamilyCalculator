const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const neolithic = require("../calculator/neolithic.js");

test("browser scripts load the fitter and Breakdown tabs follow chronological order", () => {
  const html = fs.readFileSync(path.join(__dirname, "../calculator/index.html"), "utf8");
  const tabs = html.match(/<div id="period-tabs"[^>]*>([\s\S]*?)<\/div>/)[1];
  assert.deepEqual([...tabs.matchAll(/<button id="([^"]+)"/g)].map((match) => match[1]), [
    "neolithic-tab", "early-medieval-tab", "late-medieval-tab", "modern-analysis-tab",
  ]);

  const scripts = [...html.matchAll(/<script defer src="([^"?]+)(?:\?[^"]*)?"/g)]
    .map((match) => match[1])
    .filter((name) => ["neolithic_references.js", "medieval.js", "neolithic.js"].includes(name));
  assert.deepEqual(scripts, ["neolithic_references.js", "medieval.js", "neolithic.js"]);
  const browserWindow = {};
  const context = { window: browserWindow, self: browserWindow };
  for (const script of scripts) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../calculator", script), "utf8"), context);
  }
  assert.equal(typeof context.window.G25Medieval.fitUnrestricted, "function");
  const reference = context.window.G25_NEOLITHIC_REFERENCES.turkish[0];
  const result = context.window.G25Neolithic.calculate({ values: reference.values }, "turkish");
  assert.ok(result.components.find((entry) => entry.name === reference.name).weight > 0.999);
});

test("an exact ancient proxy fits its own Neolithic model", () => {
  for (const scope of ["turkish", "global"]) {
    const reference = neolithic.references[scope][0];
    const result = neolithic.calculate({ values: reference.values }, scope);
    assert.ok(result.distance < 0.001, `${scope}: ${result.distance}`);
    assert.ok(result.components.find((entry) => entry.name === reference.name).weight > 0.999, scope);
    assert.ok(Math.abs(result.components.reduce((sum, entry) => sum + entry.weight, 0) - 1) < 1e-8);
  }
});

test("Neolithic model rejects invalid G25 coordinates", () => {
  assert.throws(() => neolithic.calculate({ values: [0] }, "turkish"), /25 finite G25/);
  assert.throws(() => neolithic.calculate({ values: Array(25).fill(0) }, "unknown"), /Unknown Neolithic/);
});
