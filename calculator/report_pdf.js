(function (root) {
  "use strict";

  const core = root.G25Core || (typeof module !== "undefined" && module.exports ? require("./core.js") : null);
  const k12b = root.G25K12B || (typeof module !== "undefined" && module.exports ? require("./k12b.js") : null);
  const healthData = root.G25_HEALTH_DATA ||
    (typeof module !== "undefined" && module.exports ? require("./health_data.js") : null);
  const healthApi = root.G25Health ||
    (typeof module !== "undefined" && module.exports ? require("./health.js") : null);
  const PAGE = { width: 595, height: 842, margin: 44, bottom: 48 };

  function formatRow(sample, model, values) {
    return values ? `${sample}_${model},${values.map((value) => (value * 100).toFixed(4)).join(",")}` :
      `${model} result unavailable.`;
  }

  function formatFit(fit) {
    return `${fit.distance.toFixed(3)} · ${fit.parts.map((part) =>
      `${(part.weight * 100).toFixed(1)}% ${part.label.replaceAll("_", " ")}`).join(" + ")}`;
  }

  function oracleEntries(values, period) {
    const entries = [];
    const sets = [
      ["Closest populations", "yakinlik1", k12b.nearest],
      [period === "modern" ? "Turkey province references" : "Expanded references", "yakinlik2tr", k12b.nearest],
      ["Two-population fits", "ikili1", k12b.twoWay],
      ["Turkey two-population fits", "ikili2tr", k12b.twoWay],
    ];
    for (const [heading, id, calculate] of sets) {
      const rows = k12b.referenceRows(id, period);
      if (!rows.length) continue;
      entries.push({ type: "subheading", text: heading });
      const fits = calculate(values, rows);
      entries.push(...fits.map((fit, index) => ({ type: "line", text: `${index + 1}. ${fit.distance.toFixed(3)} · ${
        fit.other ? `${(fit.weight * 100).toFixed(1)}% ${fit.name} + ${((1 - fit.weight) * 100).toFixed(1)}% ${fit.other}` : fit.name
      }`.replaceAll("_", " ") })));
    }
    return entries;
  }

  function healthEntries(health) {
    if (!health) return [{ type: "line", text: "Health results unavailable." }];
    const matches = new Map((health.matches || []).map((item) => [item.id, item]));
    const entries = [];
    for (const [category, heading] of Object.entries(healthData.categories)) {
      const cards = [];
      if (category === healthData.bloodType.category) {
        for (const item of health.bloodType?.observed || []) {
          const marker = healthData.bloodType.markerDetails[item.id];
          if (!marker || !Number.isInteger(item.alleleCount) || item.alleleCount < 0 || item.alleleCount > 2) continue;
          cards.push({ type: "health", title: `${marker.title} · ${item.id} · ${item.genotype}`,
            definition: marker.definition, meaning: healthData.bloodType.alleleMeanings[marker.allele][item.alleleCount],
            flag: "plain" });
        }
        if (health.bloodType?.abo) cards.push({ type: "health", title: healthData.bloodType.title,
          definition: healthData.bloodType.definition,
          meaning: healthData.bloodType.meaning.replace("{abo}", health.bloodType.abo) +
            ` Muhtemel alel çifti: ${health.bloodType.diplotype || health.bloodType.abo}.`, flag: "plain" });
      } else {
        for (const marker of healthData.variants.filter((item) => item.category === category)) {
          const match = matches.get(marker.id);
          if (!match) continue;
          cards.push({ type: "health", title: `${marker.title} · ${marker.id} · ${match.genotype}`,
            definition: marker.definition, meaning: match.meaning,
            flag: healthApi.cardTone(match.flag, marker.genotypes) });
        }
      }
      if (cards.length) entries.push({ type: "subheading", text: `${heading} · ${cards.length}` }, ...cards);
    }
    return entries.length ? entries : [{ type: "line", text: "No matching Health markers were found." }];
  }

  function buildReport({ sample, results, g25, health, references = [], analysisFits = null,
    referenceLabel = "Global references" }) {
    const sections = [];
    const k12Values = results.k12b?.fit?.proportions;
    const k36Values = results.k36?.fit?.proportions;
    sections.push({ title: "K12b row", entries: [{ type: "row", text: formatRow(sample, "K12b", k12Values) }] });
    sections.push({ title: "K36 row", entries: [{ type: "row", text: formatRow(sample, "K36", k36Values) }] });
    sections.push({ title: "G25 row", entries: [{ type: "row", text: g25
      ? `${sample}_simulated_scaled,${g25.map((value) => value.toFixed(6)).join(",")}` :
        "Simulated G25 result unavailable." }] });
    sections.push({ title: "K12b Chart", entries: k12Values
      ? [{ type: "bars", values: k12Values.map((value) => value * 100) }]
      : [{ type: "line", text: "K12b result unavailable." }] });
    if (k12Values) {
      const values = k12Values.map((value) => value * 100);
      const east = values[1] + values[3] + values[9];
      const oguz = east <= 40 ? `${(east * 2.1).toFixed(1)}–${Math.min(100, east * 2.8).toFixed(1)}%` : "Outside range";
      sections.push({ title: "K12b Oracle · Modern", entries: [
        { type: "line", text: `East Eurasian component sum: ${east.toFixed(2)}%` },
        { type: "line", text: `Oğuz/Türkmen heuristic: ${oguz}` },
        ...oracleEntries(values, "modern"),
      ] });
      sections.push({ title: "K12b Oracle · Ancient", entries: oracleEntries(values, "ancient") });
    } else {
      sections.push({ title: "K12b Oracle · Modern", entries: [{ type: "line", text: "K12b result unavailable." }] });
      sections.push({ title: "K12b Oracle · Ancient", entries: [{ type: "line", text: "K12b result unavailable." }] });
    }
    const target = g25 ? { label: `${sample}_simulated_scaled`, values: g25 } : null;
    for (const period of ["modern", "ancient"]) {
      const title = `Analysis · Closest 10 ${period}`;
      const rows = references.filter((row) => row[0] === period);
      const nearest = target ? core.nearestMatches(target, core.excludeTargetReferences(rows, [target]), 10) : [];
      sections.push({ title, entries: [
        { type: "line", text: `Reference set: ${referenceLabel}` },
        ...(nearest.length ? nearest.map((match, index) => ({ type: "line",
          text: `${index + 1}. ${match.distance.toFixed(3)} · ${match.label.replaceAll("_", " ")}` })) :
          [{ type: "line", text: target ? `No ${period} references available.` : "Simulated G25 result unavailable." }]),
      ] });
    }
    for (const [title, key] of [
      ["Analysis · Two-way fits · Modern", "relaxedModern"],
      ["Analysis · Two-way fits · Ancient", "relaxedAncient"],
      ["Analysis · Strict two-way fits · Modern", "strictModern"],
    ]) {
      const fits = analysisFits?.[key] || [];
      sections.push({ title, entries: fits.length
        ? fits.slice(0, 10).map((fit, index) => ({ type: "line", text: `${index + 1}. ${formatFit(fit)}` }))
        : [{ type: "line", text: target ? "No eligible two-way fit was found." : "Simulated G25 result unavailable." }] });
    }
    sections.push({ title: "Health", entries: healthEntries(health) });
    return { sample, sections };
  }

  function createPdf(report, document = root.document) {
    if (!document?.createElement) throw new Error("PDF export needs a browser canvas.");
    const images = [], selectableRows = [];
    let canvas, ctx, y;
    function finishPage() {
      if (!canvas) return;
      ctx.fillStyle = "#8495a4";
      ctx.font = "10px Arial, sans-serif";
      ctx.fillText(`Page ${images.length + 1}`, PAGE.width - PAGE.margin - 42, PAGE.height - 23);
      const data = atob(canvas.toDataURL("image/jpeg", 0.88).split(",")[1]);
      images.push(Uint8Array.from(data, (char) => char.charCodeAt(0)));
      canvas = null;
    }
    function page() {
      finishPage();
      canvas = document.createElement("canvas");
      canvas.width = PAGE.width * 2;
      canvas.height = PAGE.height * 2;
      ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser cannot render PDF pages.");
      ctx.scale(2, 2);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, PAGE.width, PAGE.height);
      ctx.fillStyle = "#14243b";
      ctx.font = "bold 13px Arial, sans-serif";
      ctx.fillText("G25 Family Calculator · Raw DNA report", PAGE.margin, 39);
      ctx.fillStyle = "#526c7e";
      ctx.font = "10px Arial, sans-serif";
      ctx.fillText(report.sample, PAGE.margin, 56, PAGE.width - 2 * PAGE.margin);
      ctx.strokeStyle = "#dce4eb";
      ctx.beginPath(); ctx.moveTo(PAGE.margin, 66); ctx.lineTo(PAGE.width - PAGE.margin, 66); ctx.stroke();
      y = 84;
      selectableRows.push([]);
    }
    function ensure(height) { if (y + height > PAGE.height - PAGE.bottom) page(); }
    function wrap(text, width) {
      const lines = [];
      let line = "";
      for (const token of String(text).match(/[^,\s]+,?|,|\s+/g) || []) {
        if (/^\s+$/.test(token)) { if (line) line += " "; continue; }
        if (line && ctx.measureText(line + token).width > width) {
          lines.push(line.trimEnd()); line = "";
        }
        for (const char of token) {
          if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = ""; }
          line += char;
        }
      }
      if (line.trim()) lines.push(line.trimEnd());
      return lines.length ? lines : [""];
    }
    function text(value, size = 10, bold = false, color = "#243d51", indent = 0, gap = 2,
      selectable = false) {
      ctx.font = `${bold ? "bold " : ""}${size}px Arial, sans-serif`;
      const lines = wrap(value, PAGE.width - 2 * PAGE.margin - indent);
      const height = size + 5;
      if (selectable) ensure(lines.length * height + gap);
      const selection = selectable ? { text: value, lines: [] } : null;
      for (const line of lines) {
        ensure(height);
        ctx.font = `${bold ? "bold " : ""}${size}px Arial, sans-serif`;
        ctx.fillStyle = color;
        ctx.fillText(line, PAGE.margin + indent, y + size);
        if (selection) selection.lines.push({ text: line, x: PAGE.margin + indent,
          y: PAGE.height - y - size, size });
        y += height;
      }
      if (selection) selectableRows.at(-1).push(selection);
      y += gap;
    }
    function drawHealth(item) {
      const palette = {
        positive: { border: "#a9d9bb", background: "#edf8f0" },
        "neutral-three": { border: "#efd17e", background: "#fff8df" },
        negative: { border: "#e6afa9", background: "#fff0ee" },
        plain: { border: "#dce4eb", background: "#fff" },
      }[item.flag];
      ctx.font = "bold 10px Arial, sans-serif";
      const titleLines = wrap(item.title, PAGE.width - 2 * PAGE.margin - 22);
      ctx.font = "9px Arial, sans-serif";
      const definitionLines = wrap(`Tanım: ${item.definition}`, PAGE.width - 2 * PAGE.margin - 22);
      const meaningLines = wrap(`Fenotip yorumu: ${item.meaning}`, PAGE.width - 2 * PAGE.margin - 22);
      const height = 15 + titleLines.length * 15 + (definitionLines.length + meaningLines.length) * 14;
      ensure(height + 8);
      const width = PAGE.width - 2 * PAGE.margin;
      ctx.fillStyle = palette.border; ctx.fillRect(PAGE.margin, y, width, height);
      ctx.fillStyle = palette.background; ctx.fillRect(PAGE.margin + 1, y + 1, width - 2, height - 2);
      y += 7;
      text(item.title, 10, true, "#14243b", 13, 0);
      text(`Tanım: ${item.definition}`, 9, false, "#526c7e", 13, 0);
      text(`Fenotip yorumu: ${item.meaning}`, 9, false, "#365a72", 13, 0);
      y += 8;
    }
    page();
    for (const section of report.sections) {
      ensure(35);
      y += 8;
      text(section.title, 15, true, "#14243b", 0, 7);
      for (const item of section.entries) {
        if (item.type === "subheading") { y += 5; text(item.text, 11, true, "#176e8d", 0, 4); }
        else if (item.type === "row") text(item.text, 9, false, "#173c50", 0, 4, true);
        else if (item.type === "line") text(item.text, 9.5, false, "#243d51", 0, 1);
        else if (item.type === "health") drawHealth(item);
        else if (item.type === "bars") {
          const max = Math.max(1, ...item.values);
          for (let i = 0; i < item.values.length; i++) {
            ensure(21);
            ctx.font = "9px Arial, sans-serif";
            ctx.fillStyle = "#243d51";
            ctx.fillText(k12b.labels[i].replaceAll("_", " "), PAGE.margin, y + 11);
            ctx.fillStyle = "#edf2f5"; ctx.fillRect(PAGE.margin + 157, y + 2, 266, 12);
            ctx.fillStyle = k12b.colors[i];
            ctx.fillRect(PAGE.margin + 157, y + 2, 266 * item.values[i] / max, 12);
            ctx.fillStyle = "#243d51";
            ctx.fillText(`${item.values[i].toFixed(2)}%`, PAGE.width - PAGE.margin - 74, y + 11);
            y += 21;
          }
        }
      }
    }
    finishPage();
    const encoder = new TextEncoder();
    const encode = (value) => encoder.encode(value);
    const actualText = (value) => {
      let hex = "FEFF";
      for (let index = 0; index < value.length; index++) {
        hex += value.charCodeAt(index).toString(16).padStart(4, "0");
      }
      return hex;
    };
    const pdfAscii = (value) => String(value).replace(/[^\x20-\x7E]/g, "?")
      .replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
    const objects = [null, null, null];
    const kids = [];
    for (let index = 0; index < images.length; index++) {
      const pageId = objects.length, contentId = pageId + 1, imageId = pageId + 2;
      kids.push(`${pageId} 0 R`);
      objects.push([encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /XObject << /Im1 ${imageId} 0 R >> /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${contentId} 0 R >>`)]);
      let content = `q ${PAGE.width} 0 0 ${PAGE.height} 0 0 cm /Im1 Do Q\n`;
      for (const row of selectableRows[index]) {
        content += `/Span << /ActualText <${actualText(row.text)}> >> BDC\n`;
        for (const line of row.lines) {
          content += `BT /F1 ${line.size} Tf 3 Tr 1 0 0 1 ${line.x} ${line.y} Tm (${pdfAscii(line.text)}) Tj ET\n`;
        }
        content += "EMC\n";
      }
      const commands = encode(content);
      objects.push([encode(`<< /Length ${commands.length} >>\nstream\n`), commands, encode("\nendstream")]);
      objects.push([encode(`<< /Type /XObject /Subtype /Image /Width ${PAGE.width * 2} /Height ${PAGE.height * 2} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${images[index].length} >>\nstream\n`), images[index], encode("\nendstream")]);
    }
    objects[1] = [encode("<< /Type /Catalog /Pages 2 0 R >>")];
    objects[2] = [encode(`<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`)];
    const chunks = [], offsets = [0];
    let length = 0;
    function add(bytes) { chunks.push(bytes); length += bytes.length; }
    add(encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"));
    for (let id = 1; id < objects.length; id++) {
      offsets[id] = length;
      add(encode(`${id} 0 obj\n`));
      for (const part of objects[id]) add(part);
      add(encode("\nendobj\n"));
    }
    const xref = length;
    add(encode(`xref\n0 ${objects.length}\n0000000000 65535 f \n`));
    for (let id = 1; id < objects.length; id++) add(encode(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`));
    add(encode(`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
    return new Blob(chunks, { type: "application/pdf" });
  }

  const api = { buildReport, createPdf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.G25ReportPdf = api;
})(typeof window === "undefined" ? globalThis : window);
