(function (root) {
  "use strict";

  const data = root.G25_ILLUSTRATIVE_CONVERSION ||
    (typeof module !== "undefined" && module.exports ? require("./illustrative_data.js") : null);
  const core = root.G25Core ||
    (typeof module !== "undefined" && module.exports ? require("./core.js") : null);

  function convert(values) {
    if (!Array.isArray(values) || values.length !== 25 || values.some((value) => !Number.isFinite(value))) {
      throw new Error("An IllustrativeDNA row needs 25 finite coordinates.");
    }
    if (!data || !Array.isArray(data.matrix) || data.matrix.length !== 25 ||
        !Array.isArray(data.offset) || data.offset.length !== 25 ||
        data.matrix.some((row) => !Array.isArray(row) || row.length !== 25 ||
          row.some((value) => !Number.isFinite(value))) ||
        data.offset.some((value) => !Number.isFinite(value))) {
      throw new Error("IllustrativeDNA conversion data is unavailable.");
    }
    return data.offset.map((base, output) =>
      base + values.reduce((sum, value, input) =>
        sum + value * data.matrix[input][output], 0));
  }

  function convertRows(text) {
    const lines = String(text).split(/\r?\n/).filter((line) => line.trim());
    if (!lines.length) throw new Error("Paste at least one named IllustrativeDNA row.");
    return lines.map((line) => {
      const parsed = core.parseLine(line);
      if (parsed.label === "Pasted_sample") throw new Error("Give every custom reference a name.");
      return core.formatLine(parsed.label, convert(parsed.values));
    }).join("\n");
  }

  const api = { convert, convertRows };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.G25Illustrative = api;
})(typeof window === "undefined" ? globalThis : window);
