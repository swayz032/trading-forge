// Slumhouse shared client helpers.
// Auth: redirects to /login.html on 401 and 403.

async function fetchJSON(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (res.status === 401) { window.location.href = "/slumhouse/login.html"; return null; }
  if (res.status === 403) { window.location.href = "/slumhouse/login.html"; return null; }
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

// ─── potChart — renders a 3D-style SVG pot with bubbling liquid ───────
// Used in the banner "In the Pot" tile. Liquid level scales with `count`
// (capped at 28 strategies = full pot). Includes animated wave + bubbles.
function potChart(count, opts) {
  opts = opts || {};
  const width = opts.width || 320;
  const height = opts.height || 110;
  const tint = opts.color || "#ffb84d"; // amber for the cooking pot

  // Normalize count → fill level (0 to 0.85, never quite full so wave doesn't clip)
  const level = Math.max(0.08, Math.min(0.85, Number(count || 0) / 28));

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 200 100`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.display = "block";

  // ── Defs: liquid gradient + glow filter ──
  const defs = document.createElementNS(svgNS, "defs");
  const gradId = "pg" + Math.random().toString(36).slice(2, 8);
  const grad = document.createElementNS(svgNS, "linearGradient");
  grad.setAttribute("id", gradId);
  grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0");
  grad.setAttribute("x2", "0"); grad.setAttribute("y2", "1");
  const stops = [
    ["0%", tint, 0.55],
    ["50%", tint, 0.28],
    ["100%", tint, 0.08],
  ];
  for (const [offset, color, op] of stops) {
    const s = document.createElementNS(svgNS, "stop");
    s.setAttribute("offset", offset);
    s.setAttribute("stop-color", color);
    s.setAttribute("stop-opacity", String(op));
    grad.appendChild(s);
  }
  defs.appendChild(grad);

  // Glow filter (gives the pot stroke a halo — the "3D" lift)
  const filter = document.createElementNS(svgNS, "filter");
  const filterId = "pf" + Math.random().toString(36).slice(2, 8);
  filter.setAttribute("id", filterId);
  filter.setAttribute("x", "-30%"); filter.setAttribute("y", "-30%");
  filter.setAttribute("width", "160%"); filter.setAttribute("height", "160%");
  const blur = document.createElementNS(svgNS, "feGaussianBlur");
  blur.setAttribute("in", "SourceGraphic");
  blur.setAttribute("stdDeviation", "1.8");
  blur.setAttribute("result", "g");
  const merge = document.createElementNS(svgNS, "feMerge");
  const m1 = document.createElementNS(svgNS, "feMergeNode"); m1.setAttribute("in", "g");
  const m2 = document.createElementNS(svgNS, "feMergeNode"); m2.setAttribute("in", "SourceGraphic");
  merge.appendChild(m1); merge.appendChild(m2);
  filter.appendChild(blur); filter.appendChild(merge);
  defs.appendChild(filter);

  svg.appendChild(defs);

  // ── Pot geometry ──
  // Outer trapezoidal pot body, centered. ViewBox is 200x100.
  // Top rim is wider than bottom (slight taper). Rounded bottom corners.
  const potLeft = 60, potRight = 140;   // rim x-range
  const potTop = 30;                      // rim y
  const potBottom = 88;                   // bottom y
  const potBL = 68, potBR = 132;          // bottom x-range (inset for taper)
  const potRadius = 8;

  // Clip path so liquid stays inside pot shape
  const clipId = "pc" + Math.random().toString(36).slice(2, 8);
  const clipPath = document.createElementNS(svgNS, "clipPath");
  clipPath.setAttribute("id", clipId);
  const clipShape = document.createElementNS(svgNS, "path");
  clipShape.setAttribute("d", `M ${potLeft} ${potTop} L ${potRight} ${potTop} L ${potBR - potRadius} ${potBottom - potRadius} Q ${potBR} ${potBottom} ${potBR - potRadius} ${potBottom} L ${potBL + potRadius} ${potBottom} Q ${potBL} ${potBottom} ${potBL + potRadius} ${potBottom - potRadius} Z`);
  clipPath.appendChild(clipShape);
  defs.appendChild(clipPath);

  // Liquid fill — wavy top with translate animation for "boiling" motion
  const liquidGroup = document.createElementNS(svgNS, "g");
  liquidGroup.setAttribute("clip-path", `url(#${clipId})`);

  const liquidY = potTop + (potBottom - potTop) * (1 - level);
  // Wide wavy path that pans horizontally
  const wave = document.createElementNS(svgNS, "path");
  const waveD = `M 0 ${liquidY}
                 Q 25 ${liquidY - 4}, 50 ${liquidY}
                 T 100 ${liquidY}
                 T 150 ${liquidY}
                 T 200 ${liquidY}
                 T 250 ${liquidY}
                 T 300 ${liquidY}
                 T 350 ${liquidY}
                 T 400 ${liquidY}
                 L 400 100 L 0 100 Z`;
  wave.setAttribute("d", waveD);
  wave.setAttribute("fill", `url(#${gradId})`);
  wave.style.animation = "sh-pot-wave 4s linear infinite";
  liquidGroup.appendChild(wave);

  // Bubbles — 3 circles rising from random spots, staggered
  const bubbles = [
    { cx: 84,  delay: 0.0 },
    { cx: 100, delay: 1.3 },
    { cx: 116, delay: 2.6 },
  ];
  for (const b of bubbles) {
    const bub = document.createElementNS(svgNS, "circle");
    bub.setAttribute("cx", String(b.cx));
    bub.setAttribute("cy", "0");
    bub.setAttribute("r", "1.6");
    bub.setAttribute("fill", tint);
    bub.setAttribute("opacity", "0.7");
    bub.style.animation = `sh-pot-bubble 3.6s ${b.delay}s linear infinite`;
    liquidGroup.appendChild(bub);
  }

  svg.appendChild(liquidGroup);

  // Pot outline (drawn AFTER liquid so it sits on top)
  const outline = document.createElementNS(svgNS, "path");
  // Body + rounded bottom
  outline.setAttribute("d", `
    M ${potLeft} ${potTop}
    L ${potRight} ${potTop}
    L ${potBR} ${potBottom - potRadius}
    Q ${potBR} ${potBottom}, ${potBR - potRadius} ${potBottom}
    L ${potBL + potRadius} ${potBottom}
    Q ${potBL} ${potBottom}, ${potBL} ${potBottom - potRadius}
    L ${potLeft} ${potTop}
    Z
  `);
  outline.setAttribute("fill", "none");
  outline.setAttribute("stroke", tint);
  outline.setAttribute("stroke-width", "1.6");
  outline.setAttribute("stroke-linejoin", "round");
  outline.setAttribute("filter", `url(#${filterId})`);
  svg.appendChild(outline);

  // Rim (top lid edge — slightly wider than pot for the rim look)
  const rim = document.createElementNS(svgNS, "rect");
  rim.setAttribute("x", String(potLeft - 6));
  rim.setAttribute("y", String(potTop - 4));
  rim.setAttribute("width", String((potRight - potLeft) + 12));
  rim.setAttribute("height", "5");
  rim.setAttribute("rx", "1.5");
  rim.setAttribute("fill", "none");
  rim.setAttribute("stroke", tint);
  rim.setAttribute("stroke-width", "1.6");
  rim.setAttribute("filter", `url(#${filterId})`);
  svg.appendChild(rim);

  // Two side handles (small open arcs)
  for (const side of ["left", "right"]) {
    const handle = document.createElementNS(svgNS, "path");
    const x0 = side === "left" ? potLeft - 4 : potRight + 4;
    const x1 = side === "left" ? potLeft - 14 : potRight + 14;
    handle.setAttribute("d", `M ${x0} ${potTop + 8} Q ${x1} ${potTop + 18}, ${x0} ${potTop + 28}`);
    handle.setAttribute("fill", "none");
    handle.setAttribute("stroke", tint);
    handle.setAttribute("stroke-width", "1.5");
    handle.setAttribute("stroke-linecap", "round");
    handle.setAttribute("filter", `url(#${filterId})`);
    svg.appendChild(handle);
  }

  // Fire flames under the pot (3 small flame shapes)
  for (let i = 0; i < 5; i++) {
    const fx = 70 + i * 14;
    const flame = document.createElementNS(svgNS, "path");
    flame.setAttribute("d", `M ${fx} 92 q -3 -6, 0 -10 q 3 4, 0 10 Z`);
    flame.setAttribute("fill", "#ff6363");
    flame.setAttribute("opacity", "0.7");
    flame.style.animation = `sh-pot-flame ${0.7 + (i % 3) * 0.15}s ease-in-out ${i * 0.13}s infinite alternate`;
    svg.appendChild(flame);
  }

  return svg;
}

const identityReady = (async function loadViewerIdentity() {
  if (!document.querySelector(".sh-header")) return null;
  try {
    const res = await fetch("/slumhouse/api/member/scope", { credentials: "same-origin" });
    if (!res.ok) return null;
    const viewer = await res.json();
    if (typeof viewer.officePath === "string") {
      document.querySelectorAll('a[href="/slumhouse/office.html"]').forEach((link) => {
        link.setAttribute("href", viewer.officePath);
      });
    }
    return viewer;
  } catch (_) {
    return null;
  }
}());

window.SH = { fetchJSON, el, sparkline, sparkTrend, potChart, identityReady };

// ─── Inactivity auto-signout ──────────────────────────────────────────
// Default 30 min idle → /slumhouse/auth/logout. Warning modal at 28 min
// (2-min grace period). Override via <body data-idle-timeout-min="N">.
(function initIdleSignout() {
  // Only on authenticated pages (Crib/Kitchen/Recipe — anything that has
  // sh-header is post-login). Login + not-mapped pages don't need it.
  if (!document.querySelector(".sh-header")) return;

  const idleMin = Number(document.body.dataset.idleTimeoutMin || 30);
  const warnMin = Math.max(0.5, idleMin - 2);
  let idleTimer = null;
  let warnTimer = null;
  let warnEl = null;

  function clearTimers() {
    if (idleTimer) clearTimeout(idleTimer);
    if (warnTimer) clearTimeout(warnTimer);
  }

  function logout() {
    window.location.href = "/slumhouse/auth/logout";
  }

  function showWarning() {
    if (warnEl) return;
    warnEl = document.createElement("div");
    warnEl.className = "sw-backdrop";
    warnEl.style.background = "rgba(0,0,0,0.7)";
    warnEl.innerHTML = `
      <div class="sw-card" role="alertdialog" aria-modal="true">
        <div class="sw-body" style="text-align:center;padding:30px 28px">
          <div class="sw-eyebrow" style="color:#ffb84d">Inactive</div>
          <h2 class="sw-title" style="font-size:24px">You still there?</h2>
          <p class="sw-sub" style="margin-bottom:18px">Signing you out in 2 minutes. Tap below to stay.</p>
          <button class="sw-cta" id="sw-stay" type="button">Keep me in</button>
        </div>
      </div>`;
    document.body.appendChild(warnEl);
    warnEl.querySelector("#sw-stay").addEventListener("click", () => {
      warnEl.remove(); warnEl = null;
      reset();
    });
  }

  function reset() {
    clearTimers();
    if (warnEl) { warnEl.remove(); warnEl = null; }
    warnTimer = setTimeout(showWarning, warnMin * 60_000);
    idleTimer = setTimeout(logout, idleMin * 60_000);
  }

  ["mousemove","mousedown","keydown","touchstart","scroll","wheel"].forEach(ev => {
    document.addEventListener(ev, () => { if (!warnEl) reset(); }, { passive: true });
  });
  // Also reset when the page becomes visible again (returning from another tab)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !warnEl) reset();
  });

  reset();
})();
