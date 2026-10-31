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

test("farmer proxies distinguish Southeast Asian and northern shifts across mainland groups", () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,
    "../calculator/modern_pca_references.js"), "utf8"), context);
  const pcas = context.window.G25_MODERN_PCAS;
  const south = pcas.find((pca) => pca.id === "global-south-asia");
  const southeast = pcas.find((pca) => pca.id === "global-southeast-asia");
  const score = (row, name) => neolithic.calculate({ values: Array.from(row.slice(2)) }, "global")
    .components.find((part) => part.name === name).weight;
  const farmer = "Southeast Asian Neolithic Farmer";
  const moved = new Set(["Garo_(n=2)", "Khasi_(n=3)", "Hmar_(n=4)", "Kuki_(n=6)",
    "Mizo_(n=112)", "Kom_(n=2)", "Tripuri_(n=19)",
    "Tripuri_Jamatia_(n=18)", "Tripuri_Reang_(n=10)"]);
  const relocated = southeast.references.filter((row) => moved.has(row[1].split(":")[1].trim()));
  assert.equal(relocated.length, moved.size);
  const himalaya = south.references.filter((row) => row[1].startsWith("Himalaya:"));
  const minimumRelocated = Math.min(...relocated.map((row) => score(row, farmer)));
  const maximumRetained = Math.max(...himalaya.map((row) => score(row, farmer)));
  // Compare these dataset-specific proxy fits without treating weights as measured ancestry.
  assert.ok(minimumRelocated > maximumRetained + .03);
  const northern = southeast.references.find((row) => row[1].includes("Nyishi_"));
  assert.ok(score(northern, "Yellow River Neolithic Farmer") > score(northern, farmer) + .5);
});
