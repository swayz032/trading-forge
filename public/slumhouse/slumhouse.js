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

// Render a premium fintech sparkline as inline SVG.
// Multi-stop gradient fill + drop shadow under the line + draw-in animation
// give the chart "3D depth" without a 3D engine.
function sparkline(values, opts) {
  opts = opts || {};
  const width = opts.width || 300;
  const height = opts.height || 110;
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

  // Smooth cubic-Bezier path
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

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");

  // ── Defs: multi-stop gradient + drop-shadow filter ──
  const defs = document.createElementNS(svgNS, "defs");

  // Area gradient (4 stops give the depth illusion — bright at top, fading)
  const grad = document.createElementNS(svgNS, "linearGradient");
  const gradId = "sg" + Math.random().toString(36).slice(2, 8);
  grad.setAttribute("id", gradId);
  grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0");
  grad.setAttribute("x2", "0"); grad.setAttribute("y2", "1");
  const stops = trendUp
    ? [["0%", 0.45], ["40%", 0.22], ["80%", 0.06], ["100%", 0.0]]
    : [["0%", 0.30], ["40%", 0.16], ["80%", 0.05], ["100%", 0.0]];
  for (const [offset, op] of stops) {
    const s = document.createElementNS(svgNS, "stop");
    s.setAttribute("offset", offset);
    s.setAttribute("stop-color", stroke);
    s.setAttribute("stop-opacity", String(op));
    grad.appendChild(s);
  }
  defs.appendChild(grad);

  // Glow filter — gives the line a soft halo (the "3D" lift)
  const filter = document.createElementNS(svgNS, "filter");
  const filterId = "sf" + Math.random().toString(36).slice(2, 8);
  filter.setAttribute("id", filterId);
  filter.setAttribute("x", "-20%"); filter.setAttribute("y", "-20%");
  filter.setAttribute("width", "140%"); filter.setAttribute("height", "140%");
  const blur = document.createElementNS(svgNS, "feGaussianBlur");
  blur.setAttribute("in", "SourceGraphic");
  blur.setAttribute("stdDeviation", "2.2");
  blur.setAttribute("result", "coloredBlur");
  const merge = document.createElementNS(svgNS, "feMerge");
  const mergeNode1 = document.createElementNS(svgNS, "feMergeNode");
  mergeNode1.setAttribute("in", "coloredBlur");
  const mergeNode2 = document.createElementNS(svgNS, "feMergeNode");
  mergeNode2.setAttribute("in", "SourceGraphic");
  merge.appendChild(mergeNode1);
  merge.appendChild(mergeNode2);
  filter.appendChild(blur);
  filter.appendChild(merge);
  defs.appendChild(filter);

  svg.appendChild(defs);

  // Area fill
  const lastX = points[points.length - 1][0];
  const firstX = points[0][0];
  const areaD = `${d} L ${lastX} ${height - pad} L ${firstX} ${height - pad} Z`;
  const area = document.createElementNS(svgNS, "path");
  area.setAttribute("d", areaD);
  area.setAttribute("fill", `url(#${gradId})`);
  svg.appendChild(area);

  // Stroke line — with glow filter and draw-in animation
  const line = document.createElementNS(svgNS, "path");
  line.setAttribute("d", d);
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", stroke);
  line.setAttribute("stroke-width", "1.75");
  line.setAttribute("stroke-linejoin", "round");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("filter", `url(#${filterId})`);
  // Path-length-based draw-in animation
  try {
    // Estimate path length (approximation; SVG getTotalLength only works post-mount)
    const approxLen = points.reduce((acc, p, i) => {
      if (i === 0) return 0;
      const dx = p[0] - points[i - 1][0];
      const dy = p[1] - points[i - 1][1];
      return acc + Math.hypot(dx, dy);
    }, 0);
    line.setAttribute("stroke-dasharray", String(approxLen));
    line.setAttribute("stroke-dashoffset", String(approxLen));
    line.style.animation = "sh-spark-draw 0.9s cubic-bezier(0.2, 0.7, 0.2, 1) forwards";
  } catch (_) { /* noop */ }
  svg.appendChild(line);

  // End-point dot
  const dot = document.createElementNS(svgNS, "circle");
  dot.setAttribute("cx", String(points[points.length - 1][0]));
  dot.setAttribute("cy", String(points[points.length - 1][1]));
  dot.setAttribute("r", "2.4");
  dot.setAttribute("fill", stroke);
  dot.setAttribute("filter", `url(#${filterId})`);
  dot.style.opacity = "0";
  dot.style.animation = "sh-spark-dot 0.4s 0.7s ease-out forwards";
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
