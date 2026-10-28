#!/usr/bin/env node
"use strict";

// Run from any directory: node tests/deep_pca_selfcheck.js
// Optional: --pca global-jewish, --limit 10, --output-dir /path/to/reports

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../calculator/core.js");
const modern = require("../calculator/modern_pca.js");

const root = path.resolve(__dirname, "..");
const calculator = path.join(root, "calculator");
const pcaDirectory = path.join(root, "data", "pca");

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith("--")) {
    throw new Error(`${name} needs a value.`);
  }
  return process.argv[index + 1];
}

function readRows(filename) {
  return fs.readFileSync(path.join(pcaDirectory, filename), "utf8")
    .split(/\r?\n/).filter((line) => line.trim() && !line.trimStart().startsWith("#"))
    .map((line) => {
      const [label, ...cells] = line.split(",");
      const values = cells.map(Number);
      if (!label || values.length !== 25 || values.some((value) => !Number.isFinite(value))) {
        throw new Error(`${filename}: invalid G25 row: ${label}`);
      }
      return ["modern", label.trim(), ...values];
    });
}

function populationName(row) {
  return row[1].slice(row[1].lastIndexOf(":") + 1).trim();
}

function worker() {
  const app = fs.readFileSync(path.join(calculator, "app.js"), "utf8");
  const start = app.indexOf("  function medievalWorkerMain() {");
  const end = app.indexOf("  function mixtureWorkerMain() {", start);
  if (start < 0 || end < 0) throw new Error("Could not find the modern PCA worker.");
  const modules = ["medieval.js", "modern_pca.js"].map((file) =>
    fs.readFileSync(path.join(calculator, file), "utf8")).join("\n");
  let messages = [];
  const self = { postMessage(message) { messages.push(message); } };
  vm.runInNewContext(`${modules}\n(${app.slice(start, end).trim()})()`, { self, globalThis: self });
  return (data) => {
    messages = [];
    self.onmessage({ data });
    return messages;
  };
}

function run() {
  if (process.argv.includes("--help")) {
    console.log("Usage: node tests/deep_pca_selfcheck.js [--pca ID] [--limit N] [--per-pca-limit N] [--output-dir DIR]");
    console.log("Tests deep-only populations with the app's main-then-deep worker; writes successful.tsv and unsuccessful.tsv.");
    return;
  }
  const pcaFilter = option("--pca");
  const rawLimit = option("--limit");
  const limit = rawLimit === null ? Infinity : Number(rawLimit);
  if (!(limit === Infinity || Number.isSafeInteger(limit) && limit > 0)) {
    throw new Error("--limit needs a positive integer.");
  }
  const rawPerPcaLimit = option("--per-pca-limit");
  const perPcaLimit = rawPerPcaLimit === null ? Infinity : Number(rawPerPcaLimit);
  if (!(perPcaLimit === Infinity || Number.isSafeInteger(perPcaLimit) && perPcaLimit > 0)) {
    throw new Error("--per-pca-limit needs a positive integer.");
  }
  const outputDir = path.resolve(option("--output-dir") || path.join(__dirname, "results"));
  const config = JSON.parse(fs.readFileSync(path.join(pcaDirectory, "pca_config.txt"), "utf8"));
  const pcas = config.modern.filter((entry) => !pcaFilter || entry.id === pcaFilter)
    .map((entry) => ({ id: entry.id, title: entry.title,
      references: readRows(entry.file),
      deepReferences: readRows(entry.file.replace(/\.g25\.txt$/, "_deep.g25.txt"))
        .filter((row) => !row[1].startsWith("Deprecated:")) }));
  if (!pcas.length) throw new Error(`No PCA found for ${pcaFilter}.`);
  const candidates = pcas.flatMap((pca) => {
    const mainNames = new Set(pca.references.map(populationName));
    return pca.deepReferences.filter((row) => !mainNames.has(populationName(row)))
      .slice(0, perPcaLimit).map((row) => ({ pca, row }));
  }).slice(0, limit);
  const calculate = worker();
  const successful = [], unsuccessful = [];
  const byPca = new Map();
  for (const [index, { pca, row }] of candidates.entries()) {
    const target = { label: populationName(row), values: row.slice(2) };
    const mainReferences = modern.selectFitReferences(target,
      pca.references.filter((reference) => !modern.isIstanbulReference(reference)), core.nearestMatches);
    let result;
    try {
      const messages = calculate({ requestId: index + 1, target, references: mainReferences,
        groupLimit: "auto", groupStyle: "modern", selectedPcaId: pca.id, displayedPcaId: pca.id,
        closestPcaId: pca.id, closestPopulationDistance: 0,
        modernPcas: [{ id: pca.id, title: pca.title, references: mainReferences }],
        deepAnalysis: true, deepGroupLimit: "auto",
        deepPcas: [{ id: pca.id, title: pca.title, references: pca.deepReferences }] });
      const main = messages.find((message) => message.kind === "selected")?.fit;
      const deep = messages.find((message) => message.kind === "deep");
      const error = messages.find((message) => message.kind === "error")?.error || deep?.error;
      if (error || !main || !deep?.fit) throw new Error(error || "main or deep fit missing");
      const selfWeight = deep.fit.components.filter((part) => part.label === row[1])
        .reduce((sum, part) => sum + part.weight, 0);
      const ownGroup = row[1].split(":", 1)[0].trim();
      const mainGroups = main.groups.map((group) => group.ethnicity);
      const passed = selfWeight >= 0.999 && deep.fit.distance <= 0.001;
      result = { pca: pca.title, population: row[1], selfWeight, distance: deep.fit.distance,
        mainGroups, passed, reason: passed ? "" : mainGroups.includes(ownGroup)
          ? "Different deep fit" : "Own group excluded by main fit" };
    } catch (error) {
      result = { pca: pca.title, population: row[1], selfWeight: 0, distance: NaN,
        mainGroups: [], passed: false, reason: error.message };
    }
    (result.passed ? successful : unsuccessful).push(result);
    if (!byPca.has(pca.title)) byPca.set(pca.title, { successful: 0, unsuccessful: 0 });
    byPca.get(pca.title)[result.passed ? "successful" : "unsuccessful"]++;
    if ((index + 1) % 50 === 0) console.error(`Checked ${index + 1} / ${candidates.length}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "successful.tsv"),
    ["PCA\tPopulation\tSelf weight\tDeep fit distance", ...successful.map((item) =>
      `${item.pca}\t${item.population}\t${item.selfWeight}\t${item.distance}`)].join("\n") + "\n");
  fs.writeFileSync(path.join(outputDir, "unsuccessful.tsv"),
    ["PCA\tPopulation\tReason\tMain groups\tSelf weight\tDeep fit distance", ...unsuccessful.map((item) =>
      `${item.pca}\t${item.population}\t${item.reason}\t${item.mainGroups.join(", ")}\t${item.selfWeight}\t${item.distance}`)].join("\n") + "\n");
  for (const [name, counts] of byPca) {
    console.log(`${name}: ${counts.successful} successful, ${counts.unsuccessful} unsuccessful`);
  }
  console.log(`Total: ${successful.length} successful, ${unsuccessful.length} unsuccessful (${candidates.length} tested)`);
  console.log(`Reports: ${outputDir}`);
  if (unsuccessful.length) process.exitCode = 1;
}

try { run(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
