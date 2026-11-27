(function (root) {
  "use strict";

  const data = root.G25_ILLUSTRATIVE_CONVERSION ||
    (typeof module !== "undefined" && module.exports ? require("./illustrative_data.js") : null);
  const core = root.G25Core ||
    (typeof module !== "undefined" && module.exports ? require("./core.js") : null);

  function applyConversion(values, matrix, offset, name) {
    if (!Array.isArray(values) || values.length !== 25 || values.some((value) => !Number.isFinite(value))) {
      throw new Error(`A ${name} row needs 25 finite coordinates.`);
    }
    if (!Array.isArray(matrix) || matrix.length !== 25 ||
        !Array.isArray(offset) || offset.length !== 25 ||
        matrix.some((row) => !Array.isArray(row) || row.length !== 25 ||
          row.some((value) => !Number.isFinite(value))) ||
        offset.some((value) => !Number.isFinite(value))) {
      throw new Error(`${name} conversion data is unavailable.`);
    }
    return offset.map((base, output) =>
      base + values.reduce((sum, value, input) =>
        sum + value * matrix[input][output], 0));
  }

  function convert(values) {
    return applyConversion(values, data?.matrix, data?.offset, "IllustrativeDNA");
  }

  function toIllustrative(values) {
    return applyConversion(values, data?.inverseMatrix, data?.inverseOffset, "G25");
  }

  function convertRows(text, converter = convert, source = "IllustrativeDNA", decimals = 6) {
    const lines = String(text).split(/\r?\n/).filter((line) => line.trim());
    if (!lines.length) throw new Error(`Paste at least one named ${source} row.`);
    return lines.map((line) => {
      const parsed = core.parseLine(line);
      if (parsed.label === "Pasted_sample") throw new Error("Give every custom reference a name.");
      return core.formatLine(parsed.label, converter(parsed.values), decimals);
    }).join("\n");
  }

  function convertRowsToIllustrative(text) {
    return convertRows(text, toIllustrative, "G25", 8);
  }

  const api = { convert, toIllustrative, convertRows, convertRowsToIllustrative };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.G25Illustrative = api;
})(typeof window === "undefined" ? globalThis : window);
