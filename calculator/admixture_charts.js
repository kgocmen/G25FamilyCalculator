(function (root) {
  "use strict";
  const svgNS = "http://www.w3.org/2000/svg";

  function render({ chart, table, components, values, colors }) {
    if (components.length !== values.length || !values.every((v) => Number.isFinite(v) && v >= 0))
      throw new Error("Invalid admixture chart values.");
    const total = values.reduce((sum, value) => sum + value, 0);
    chart.replaceChildren();
    table.replaceChildren();
    if (!total) return;
    const document = chart.ownerDocument;
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 300 300");
    svg.setAttribute("aria-hidden", "true");
    let angle = -Math.PI / 2;
    components.forEach((component, i) => {
      const percent = values[i] * 100 / total;
      const color = colors?.[i] || `hsl(${(i * 137.508) % 360} 55% 52%)`;
      if (percent > 0) {
        const next = angle + Math.PI * 2 * percent / 100;
        const slice = document.createElementNS(svgNS, percent >= 99.999999 ? "circle" : "path");
        if (percent >= 99.999999) {
          slice.setAttribute("cx", "150"); slice.setAttribute("cy", "150"); slice.setAttribute("r", "135");
        } else {
          const x1 = 150 + 135 * Math.cos(angle), y1 = 150 + 135 * Math.sin(angle);
          const x2 = 150 + 135 * Math.cos(next), y2 = 150 + 135 * Math.sin(next);
          slice.setAttribute("d", `M150 150 L${x1} ${y1} A135 135 0 ${next - angle > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`);
        }
        slice.setAttribute("fill", color);
        const title = document.createElementNS(svgNS, "title");
        title.textContent = `${component.replaceAll("_", " ")} ${percent.toFixed(2)}%`;
        slice.append(title); svg.append(slice); angle = next;
      }
      const row = document.createElement("div"); row.className = "admixture-component";
      const swatch = document.createElement("span"); swatch.className = "admixture-swatch";
      swatch.style.backgroundColor = color; swatch.setAttribute("aria-hidden", "true");
      const label = document.createElement("span"); label.className = "admixture-component-name";
      label.textContent = component.replaceAll("_", " ");
      const value = document.createElement("strong"); value.textContent = percent < 0.005 ? "–" : `${percent.toFixed(2)}%`;
      row.append(swatch, label, value); table.append(row);
    });
    chart.append(svg);
  }
  root.G25AdmixtureCharts = { render };
  if (typeof module !== "undefined" && module.exports) module.exports = { render };
})(typeof window === "undefined" ? globalThis : window);
