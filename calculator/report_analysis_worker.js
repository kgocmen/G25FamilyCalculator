"use strict";
importScripts("mixture.js?v=20261111-1");

self.onmessage = ({ data }) => {
  const send = (type, extras = {}) => self.postMessage({ type, ...extras });
  try {
    const modern = data.references.filter((row) => row[0] === "modern");
    const ancient = data.references.filter((row) => row[0] === "ancient");
    send("progress", { message: "Calculating modern two-way fits for PDF…" });
    const relaxedModern = self.G25Mixtures.estimateRelaxed(data.target, modern, 10);
    send("progress", { message: "Calculating ancient two-way fits for PDF…" });
    const relaxedAncient = self.G25Mixtures.estimateRelaxed(data.target, ancient, 10);
    send("progress", { message: "Calculating strict two-way fits for PDF…" });
    const strictModern = self.G25Mixtures.estimateStrictPairs(data.target, modern, 10);
    send("result", { fits: { relaxedModern, relaxedAncient, strictModern } });
  } catch (error) {
    send("error", { message: error.message || "Could not calculate the PDF analysis." });
  }
};
