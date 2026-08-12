export const CINEMATIC_DURATION_MS = 7000;

const TRUTH_COLORS = Object.freeze({
  verified: "#a3ff12",
  inferred: "#ffb84d",
  refused: "#ff6363",
  unbound: "#7d8791",
});

function hashString(value) {
  let hash = 2166136261;
  const source = String(value || "source-unavailable");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function deriveCompilerIdentity(seed) {
  const hash = hashString(seed);
  const hue = hash % 360;
  const secondaryHue = (hue + 38 + ((hash >>> 9) % 92)) % 360;
  return {
    seed: hash,
    primary: `hsl(${hue} 76% 56%)`,
    secondary: `hsl(${secondaryHue} 84% 64%)`,
    primaryHue: hue,
    secondaryHue,
    semantic: { ...TRUTH_COLORS },
  };
}

function cleanText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function transcriptFragments(transcript) {
  const text = cleanText(transcript);
  if (!text) return [];
  return (text.match(/[^.!?]+(?:[.!?]+|$)/g) || [text])
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 14);
}

function copyRule(rule) {
  return {
    id: cleanText(rule && rule.id) || "receipt-rule",
    label: cleanText(rule && rule.label) || "Unnamed persisted rule",
    type: cleanText(rule && rule.type) || "UNKNOWN",
    role: cleanText(rule && rule.role),
    origin: cleanText(rule && rule.origin) || "unknown",
    evidence: cleanText(rule && rule.evidence),
    span: rule && rule.span && Number.isFinite(Number(rule.span.start)) && Number.isFinite(Number(rule.span.end))
      ? { start: Number(rule.span.start), end: Number(rule.span.end) }
      : null,
    expression: cleanText(rule && rule.expression),
  };
}

function sealFor(state) {
  if (state === "compiled") return "COMPILED BLUEPRINT · RECEIPT SEALED";
  if (state === "refused") return "COMPILER REFUSED · EVIDENCE PRESERVED";
  if (state === "stale") return "LAST RECEIPT STALE · RECOMPILE REQUIRED";
  if (state === "unavailable") return "COMPILER RECEIPT UNAVAILABLE";
  return "SOURCE CAPTURED · BLUEPRINT NOT YET COMPILED";
}

export function buildCompilerSceneModel(input) {
  const strategy = input && input.strategy ? input.strategy : {};
  const source = input && input.source ? input.source : {};
  const receipt = strategy.compilerView && typeof strategy.compilerView === "object"
    ? strategy.compilerView
    : { state: "uncompiled", chambers: [] };
  const status = ["compiled", "refused", "stale", "unavailable"].includes(receipt.state)
    ? receipt.state
    : "uncompiled";
  const identity = deriveCompilerIdentity(source.videoId || strategy.sourceVideoId || strategy.id);
  const sourceModel = {
    videoId: cleanText(source.videoId) || cleanText(strategy.sourceVideoId),
    title: cleanText(source.title) || cleanText(strategy.sourceTitle) || "Source evidence unavailable",
    channel: cleanText(source.channel),
    transcriptStatus: cleanText(source.transcriptStatus) || cleanText(strategy.transcriptStatus) || "unavailable",
    transcriptChars: Math.max(0, Number(source.transcriptChars) || 0),
    transcriptSha256: cleanText(source.transcriptSha256),
    fragments: transcriptFragments(source.transcript),
  };
  const receivedChambers = Array.isArray(receipt.chambers) ? receipt.chambers : [];
  const chamberKeys = ["context", "setup", "entry", "stop", "exit", "sizing", "filters"];
  const chambers = chamberKeys.map((key) => {
    const received = receivedChambers.find((item) => item && item.key === key) || {};
    const rules = status === "uncompiled"
      ? []
      : Array.isArray(received.rules) ? received.rules.map(copyRule) : [];
    const state = rules.length
      ? ["verified", "inferred", "refused"].includes(received.state) ? received.state : "verified"
      : "unbound";
    return {
      key,
      label: cleanText(received.label) || key[0].toUpperCase() + key.slice(1),
      state,
      rules,
    };
  });
  return {
    status,
    seal: sealFor(status),
    identity,
    strategy: {
      id: cleanText(strategy.id),
      name: cleanText(strategy.name) || "Unnamed strategy",
      symbol: cleanText(strategy.symbol),
      timeframe: cleanText(strategy.timeframe),
      lifecycleState: cleanText(strategy.lifecycleState),
    },
    source: sourceModel,
    receiptHash: cleanText(receipt.receiptHash),
    graphHash: cleanText(receipt.graphHash),
    direction: cleanText(receipt.direction),
    binding: receipt.binding && typeof receipt.binding === "object" ? {
      compiled: receipt.binding.compiled === true,
      approximationUsed: receipt.binding.approximationUsed === true,
      spineBound: Number(receipt.binding.spineBound) || 0,
      spineTotal: Number(receipt.binding.spineTotal) || 0,
      triggerBound: receipt.binding.triggerBound === true,
      queueReasons: Array.isArray(receipt.binding.queueReasons)
        ? receipt.binding.queueReasons.map(cleanText).filter(Boolean)
        : [],
    } : null,
    chambers,
  };
}

export function phaseAt(elapsedMs) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  if (elapsed >= CINEMATIC_DURATION_MS) return "settled";
  if (elapsed >= 6100) return "seal";
  if (elapsed >= 4800) return "assembly";
  if (elapsed >= 2800) return "storm";
  if (elapsed >= 1400) return "transcript";
  return "source";
}

export function chooseRenderProfile(input) {
  if (!input.webgl2 || input.reducedMotion) {
    return { mode: "static", dpr: 1, particles: 0, durationMs: 0 };
  }
  const width = Math.max(0, Number(input.width) || 0);
  const cores = Math.max(1, Number(input.hardwareConcurrency) || 1);
  const particles = width >= 1700 && cores >= 8 ? 4200 : width >= 1100 && cores >= 4 ? 2800 : 1600;
  return {
    mode: "webgl",
    dpr: Math.min(1.75, Math.max(1, Number(input.devicePixelRatio) || 1)),
    particles,
    durationMs: CINEMATIC_DURATION_MS,
  };
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function thumbnailUrl(videoId) {
  return videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/maxresdefault.jpg` : "";
}

function chamberMarkup(chamber, index) {
  const angle = -90 + (360 / 7) * index;
  const counterAngle = angle * -1;
  const ruleCount = chamber.rules.length;
  return `<button class="compiler-chamber is-${escapeHtml(chamber.state)}" type="button" data-compiler-chamber="${escapeHtml(chamber.key)}" style="--chamber-angle:${angle}deg;--chamber-counter-angle:${counterAngle}deg" aria-label="${escapeHtml(chamber.label)}, ${ruleCount ? `${ruleCount} persisted rules` : "unbound"}">
    <span class="compiler-chamber-index">0${index + 1}</span>
    <span class="compiler-chamber-name">${escapeHtml(chamber.label)}</span>
    <span class="compiler-chamber-state">${ruleCount ? `${ruleCount} bound` : "UNBOUND"}</span>
  </button>`;
}

function detailMarkup(model, chamber) {
  const rules = chamber.rules.length ? chamber.rules.map((rule) => `<article class="compiler-rule">
    <div class="compiler-rule-origin is-${escapeHtml(rule.origin)}">${escapeHtml(rule.origin.replaceAll("_", " "))}</div>
    <h4>${escapeHtml(rule.label)}</h4>
    ${rule.evidence ? `<blockquote>${escapeHtml(rule.evidence)}</blockquote>` : ""}
    ${rule.expression ? `<code>${escapeHtml(rule.expression)}</code>` : ""}
    <div class="compiler-rule-meta">${escapeHtml(rule.type)}${rule.role ? ` · ${escapeHtml(rule.role)}` : ""}${rule.span ? ` · source ${rule.span.start}–${rule.span.end}` : ""}</div>
  </article>`).join("") : `<div class="compiler-unbound-copy"><b>UNBOUND</b><span>No persisted compiler rule exists in this chamber.</span></div>`;
  return `<div class="compiler-detail-head"><div><span>Rule chamber</span><h3>${escapeHtml(chamber.label)}</h3></div><button type="button" data-compiler-detail-close aria-label="Close rule chamber">×</button></div>
    <div class="compiler-detail-truth">${escapeHtml(model.status === "uncompiled" ? "Source evidence only · no executable rule claimed" : "Persisted compiler receipt")}</div>
    <div class="compiler-rule-list">${rules}</div>`;
}

function sceneMarkup(model) {
  const meta = [model.strategy.symbol, model.strategy.timeframe, model.strategy.lifecycleState].filter(Boolean).join(" · ");
  const sourceImage = thumbnailUrl(model.source.videoId);
  const fragments = model.source.fragments.map((fragment, index) => `<span class="compiler-fragment" style="--fragment-index:${index}">${escapeHtml(fragment)}</span>`).join("");
  return `<section class="compiler-stage is-${escapeHtml(model.status)}" aria-label="Compiler View for ${escapeHtml(model.strategy.name)}" style="--source-primary:${model.identity.primary};--source-secondary:${model.identity.secondary}">
    <canvas class="compiler-webgl" aria-hidden="true"></canvas>
    <div class="compiler-atmosphere" aria-hidden="true"><i></i><i></i><i></i></div>
    <header class="compiler-head">
      <div><div class="compiler-kicker">Source-to-engine transformation</div><h2>${escapeHtml(model.strategy.name)}</h2><p>${escapeHtml(meta)}</p></div>
      <button class="compiler-media-return" type="button" data-compiler-close>Media View</button>
    </header>
    <div class="compiler-cinematic" data-compiler-phase="source">
      <div class="compiler-source-plane">
        ${sourceImage ? `<img src="${sourceImage}" alt="Source thumbnail for ${escapeHtml(model.source.title)}">` : `<div class="compiler-source-missing">SOURCE IMAGE<br>UNAVAILABLE</div>`}
        <div class="compiler-source-scan"></div>
        <div class="compiler-source-label"><span>Evidence source</span><b>${escapeHtml(model.source.title)}</b><em>${model.source.transcriptChars.toLocaleString()} transcript characters</em></div>
      </div>
      <div class="compiler-fragments" aria-hidden="true">${fragments}</div>
      <div class="compiler-machine">
        <div class="compiler-orbit orbit-a" aria-hidden="true"></div><div class="compiler-orbit orbit-b" aria-hidden="true"></div>
        <div class="compiler-core" aria-hidden="true"><span></span><i></i><b>TF</b></div>
        <div class="compiler-chambers">${model.chambers.map(chamberMarkup).join("")}</div>
      </div>
      <div class="compiler-status-seal" role="status" aria-live="polite"><span>${escapeHtml(model.status)}</span><b>${escapeHtml(model.seal)}</b><em>${model.receiptHash ? `Receipt ${escapeHtml(model.receiptHash.slice(0, 18))}` : "No compiler receipt exists"}</em></div>
      <div class="compiler-timeline" aria-hidden="true"><i></i><span>Source</span><span>Transcript</span><span>Storm</span><span>Assembly</span><span>Seal</span></div>
    </div>
    <aside class="compiler-detail" data-compiler-detail hidden></aside>
  </section>`;
}

function hslToRgb(hue, saturation, lightness) {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const section = hue / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  let red = 0, green = 0, blue = 0;
  if (section < 1) [red, green] = [chroma, x];
  else if (section < 2) [red, green] = [x, chroma];
  else if (section < 3) [green, blue] = [chroma, x];
  else if (section < 4) [green, blue] = [x, chroma];
  else if (section < 5) [red, blue] = [x, chroma];
  else [red, blue] = [chroma, x];
  const match = l - chroma / 2;
  return [red + match, green + match, blue + match];
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(error || "Compiler View shader compilation failed");
  }
  return shader;
}

function createStormRenderer(canvas, identity, profile) {
  const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, powerPreference: "high-performance" });
  if (!gl) return null;
  const vertex = compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
    precision highp float;
    in vec4 aParticle;
    uniform float uTime;
    uniform float uProgress;
    uniform float uAspect;
    out float vAlpha;
    void main(){
      float angle=aParticle.x+uTime*(.34+aParticle.w*.22);
      float storm=smoothstep(.14,.72,uProgress);
      float radius=mix(aParticle.y*1.65,aParticle.y*(.28+.72*(1.0-uProgress)),storm);
      float depth=mod(aParticle.z+uTime*(.18+aParticle.w*.12)+3.0,6.0)-3.0;
      float perspective=1.0/(1.25+max(-.8,depth)*.13);
      float x=cos(angle)*radius*perspective;
      float y=(depth*.24+sin(angle*.7)*.22)*perspective;
      gl_Position=vec4(x/uAspect,y,depth/8.0,1.0);
      gl_PointSize=(1.4+aParticle.w*3.4)*perspective;
      vAlpha=(.18+aParticle.w*.62)*(uProgress<.88?1.0:.58);
    }`);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;
    uniform vec3 uPrimary;
    uniform vec3 uSecondary;
    in float vAlpha;
    out vec4 outColor;
    void main(){
      vec2 p=gl_PointCoord-vec2(.5);
      float d=length(p);
      if(d>.5)discard;
      float glow=smoothstep(.5,0.0,d);
      vec3 color=mix(uPrimary,uSecondary,gl_PointCoord.y);
      outColor=vec4(color,glow*vAlpha);
    }`);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Compiler View shader link failed");
  const random = mulberry32(identity.seed);
  const particles = new Float32Array(profile.particles * 4);
  for (let index = 0; index < profile.particles; index += 1) {
    particles[index * 4] = random() * Math.PI * 2;
    particles[index * 4 + 1] = .12 + Math.pow(random(), .72) * 1.24;
    particles[index * 4 + 2] = random() * 6 - 3;
    particles[index * 4 + 3] = random();
  }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, particles, gl.STATIC_DRAW);
  const location = gl.getAttribLocation(program, "aParticle");
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 0, 0);
  const uniforms = {
    time: gl.getUniformLocation(program, "uTime"),
    progress: gl.getUniformLocation(program, "uProgress"),
    aspect: gl.getUniformLocation(program, "uAspect"),
    primary: gl.getUniformLocation(program, "uPrimary"),
    secondary: gl.getUniformLocation(program, "uSecondary"),
  };
  const primary = hslToRgb(identity.primaryHue, 76, 56);
  const secondary = hslToRgb(identity.secondaryHue, 84, 64);
  gl.useProgram(program);
  gl.uniform3fv(uniforms.primary, primary);
  gl.uniform3fv(uniforms.secondary, secondary);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.disable(gl.DEPTH_TEST);
  function resize() {
    const width = Math.max(1, Math.floor(canvas.clientWidth * profile.dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * profile.dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  }
  return {
    render(elapsedMs) {
      resize();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform1f(uniforms.time, elapsedMs / 1000);
      gl.uniform1f(uniforms.progress, Math.min(1, elapsedMs / CINEMATIC_DURATION_MS));
      gl.uniform1f(uniforms.aspect, canvas.width / canvas.height);
      gl.drawArrays(gl.POINTS, 0, profile.particles);
    },
    destroy() {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    },
  };
}

export function mountCompilerView(host, input, options = {}) {
  if (!host || typeof host.replaceChildren !== "function") throw new TypeError("Compiler View requires a host element");
  const model = buildCompilerSceneModel(input);
  host.innerHTML = sceneMarkup(model);
  const stage = host.querySelector(".compiler-stage");
  const canvas = host.querySelector(".compiler-webgl");
  const cinematic = host.querySelector(".compiler-cinematic");
  const detail = host.querySelector("[data-compiler-detail]");
  const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const testContext = canvas.getContext("webgl2");
  const profile = chooseRenderProfile({
    webgl2: Boolean(testContext),
    reducedMotion: mediaQuery.matches,
    devicePixelRatio: window.devicePixelRatio,
    width: host.clientWidth,
    hardwareConcurrency: navigator.hardwareConcurrency,
  });
  let storm = null;
  let frame = 0;
  let start = 0;
  let destroyed = false;
  let contextLost = false;

  function settle() {
    cinematic.dataset.compilerPhase = "settled";
    stage.classList.add("is-settled");
  }

  function animate(now) {
    if (destroyed) return;
    const elapsed = Math.max(0, now - start);
    cinematic.dataset.compilerPhase = phaseAt(elapsed);
    if (storm && !contextLost) storm.render(elapsed);
    if (elapsed < profile.durationMs) frame = window.requestAnimationFrame(animate);
    else settle();
  }

  function replay() {
    window.cancelAnimationFrame(frame);
    stage.classList.remove("is-settled");
    cinematic.dataset.compilerPhase = "source";
    if (profile.mode === "static") {
      settle();
      return;
    }
    if (!storm && !contextLost) storm = createStormRenderer(canvas, model.identity, profile);
    if (!storm) {
      stage.classList.add("is-webgl-fallback");
      settle();
      return;
    }
    start = performance.now();
    frame = window.requestAnimationFrame(animate);
  }

  function closeDetail() {
    detail.hidden = true;
    detail.innerHTML = "";
  }

  host.querySelectorAll("[data-compiler-chamber]").forEach((button) => {
    button.addEventListener("click", () => {
      const chamber = model.chambers.find((item) => item.key === button.dataset.compilerChamber);
      if (!chamber) return;
      detail.innerHTML = detailMarkup(model, chamber);
      detail.hidden = false;
      detail.querySelector("[data-compiler-detail-close]")?.addEventListener("click", closeDetail, { once: true });
      detail.querySelector("[data-compiler-detail-close]")?.focus();
    });
  });
  host.querySelector("[data-compiler-close]")?.addEventListener("click", () => options.onClose?.());
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    contextLost = true;
    window.cancelAnimationFrame(frame);
    stage.classList.add("is-webgl-fallback");
    settle();
  });
  replay();
  return {
    model,
    replay,
    destroy() {
      destroyed = true;
      window.cancelAnimationFrame(frame);
      storm?.destroy();
      storm = null;
      host.replaceChildren();
    },
  };
}
