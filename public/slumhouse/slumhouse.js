// Slumhouse shared client helpers.
// Auth: redirects to /login.html on 401, /not-mapped.html on 403.

async function fetchJSON(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (res.status === 401) { window.location.href = "/slumhouse/login.html"; return null; }
  if (res.status === 403) { window.location.href = "/slumhouse/not-mapped.html"; return null; }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("slumhouse fetch failed", res.status, txt);
    return null;
  }
  return res.json();
}

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return node;
}

// Render a smooth sparkline as inline SVG. Returns an SVG element.
// values: number[] (any length). Auto-scales to fit. Color defaults to lime;
// drops to red for net-negative series (last point below first).
function sparkline(values, opts) {
  opts = opts || {};
  const width = opts.width || 100;
  const height = opts.height || 28;
  const pad = 2;
  if (!values || values.length === 0) values = [0];
  if (values.length === 1) values = [values[0], values[0]];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const xStep = (width - pad * 2) / (values.length - 1);
  const points = values.map((v, i) => {
    const x = pad + i * xStep;
    const y = pad + (1 - (v - min) / range) * (height - pad * 2);
    return [x, y];
  });

  // Build a smooth cubic-Bezier path so the line reads premium.
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const midX = (px + cx) / 2;
    d += ` C ${midX} ${py}, ${midX} ${cy}, ${cx} ${cy}`;
  }

  const lastVal = values[values.length - 1];
  const firstVal = values[0];
  const trendUp = lastVal >= firstVal;
  const stroke = opts.color || (trendUp ? "#a3ff12" : "#ff6363");
  const fillOpacity = trendUp ? 0.18 : 0.12;

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");

  // Gradient fill under the line
  const defs = document.createElementNS(svgNS, "defs");
  const grad = document.createElementNS(svgNS, "linearGradient");
  const gradId = "sg" + Math.random().toString(36).slice(2, 8);
  grad.setAttribute("id", gradId);
  grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0");
  grad.setAttribute("x2", "0"); grad.setAttribute("y2", "1");
  const stop1 = document.createElementNS(svgNS, "stop");
  stop1.setAttribute("offset", "0%");
  stop1.setAttribute("stop-color", stroke);
  stop1.setAttribute("stop-opacity", String(fillOpacity));
  const stop2 = document.createElementNS(svgNS, "stop");
  stop2.setAttribute("offset", "100%");
  stop2.setAttribute("stop-color", stroke);
  stop2.setAttribute("stop-opacity", "0");
  grad.appendChild(stop1); grad.appendChild(stop2);
  defs.appendChild(grad);
  svg.appendChild(defs);

  // Area fill
  const lastX = points[points.length - 1][0];
  const firstX = points[0][0];
  const areaD = `${d} L ${lastX} ${height - pad} L ${firstX} ${height - pad} Z`;
  const area = document.createElementNS(svgNS, "path");
  area.setAttribute("d", areaD);
  area.setAttribute("fill", `url(#${gradId})`);
  svg.appendChild(area);

  // Stroke line
  const line = document.createElementNS(svgNS, "path");
  line.setAttribute("d", d);
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", stroke);
  line.setAttribute("stroke-width", "1.5");
  line.setAttribute("stroke-linejoin", "round");
  line.setAttribute("stroke-linecap", "round");
  svg.appendChild(line);

  // End-point dot
  const dot = document.createElementNS(svgNS, "circle");
  dot.setAttribute("cx", String(points[points.length - 1][0]));
  dot.setAttribute("cy", String(points[points.length - 1][1]));
  dot.setAttribute("r", "1.8");
  dot.setAttribute("fill", stroke);
  svg.appendChild(dot);

  return svg;
}

// Compute % change between first non-zero and last value in a series.
// Returns { pct: number, direction: "up"|"down"|"flat" }.
function sparkTrend(values) {
  if (!values || values.length < 2) return { pct: 0, direction: "flat" };
  const first = values[0];
  const last = values[values.length - 1];
  if (first === 0 && last === 0) return { pct: 0, direction: "flat" };
  if (first === 0) return { pct: 100, direction: last >= 0 ? "up" : "down" };
  const pct = ((last - first) / Math.abs(first)) * 100;
  if (Math.abs(pct) < 1) return { pct: 0, direction: "flat" };
  return { pct, direction: pct > 0 ? "up" : "down" };
}

window.SH = { fetchJSON, el, sparkline, sparkTrend };
