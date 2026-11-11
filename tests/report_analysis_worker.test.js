const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("PDF analysis worker returns modern, ancient and strict two-way fits only", () => {
  const messages = [];
  const context = vm.createContext({});
  context.self = context;
  context.postMessage = (message) => messages.push(message);
  context.importScripts = () => vm.runInContext(fs.readFileSync(
    path.join(__dirname, "../calculator/mixture.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(
    path.join(__dirname, "../calculator/report_analysis_worker.js"), "utf8"), context);
  const vector = (first) => [first, ...Array(24).fill(0)];
  context.onmessage({ data: { target: { label: "Sample", values: vector(0) }, references: [
    ["modern", "M1", ...vector(-1)], ["modern", "M2", ...vector(1)],
    ["ancient", "A1", ...vector(-2)], ["ancient", "A2", ...vector(2)],
  ] } });
  assert.deepEqual(Object.keys(messages.at(-1).fits).sort(),
    ["relaxedAncient", "relaxedModern", "strictModern"].sort());
  assert.equal(messages.at(-1).type, "result");
  assert.equal(messages.at(-1).fits.strictModern[0].distance, 0);
  assert.ok(messages.some((message) => message.type === "progress"));
});
