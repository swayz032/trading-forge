export const CINEMATIC_DURATION_MS = 7000;
export const STRATEGY_SLIDE_DURATION_MS = 4200;

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
  return "SOURCE SECURED - TRADING RULES AWAITING COMPILATION";
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

const STRATEGY_CARD_GROUPS = Object.freeze([
  { key: "trade_when", label: "Trade When", chambers: ["context", "setup"] },
  { key: "enter", label: "Enter", chambers: ["entry"] },
  { key: "protect", label: "Protect", chambers: ["stop", "sizing"] },
  { key: "manage", label: "Manage", chambers: ["exit"] },
  { key: "avoid", label: "Avoid", chambers: ["filters"] },
]);

export function buildStrategyCardGroups(model) {
  const chambers = Array.isArray(model && model.chambers) ? model.chambers : [];
  return STRATEGY_CARD_GROUPS.map((group) => {
    const rules = group.chambers.flatMap((key) => {
      const chamber = chambers.find((item) => item && item.key === key);
      return Array.isArray(chamber && chamber.rules) ? chamber.rules : [];
    });
    return {
      key: group.key,
      label: group.label,
      direction: group.key === "enter" ? cleanText(model && model.direction) : null,
      rules: rules.slice(0, 2).map(copyRule),
      additionalCount: Math.max(0, rules.length - 2),
    };
  });
}

export function phaseAt(elapsedMs) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  if (elapsed >= CINEMATIC_DURATION_MS) return "settled";
  if (elapsed >= 6000) return "shockwave";
  if (elapsed >= 4900) return "compression";
  if (elapsed >= 2100) return "vortex";
  if (elapsed >= 900) return "rupture";
  return "source";
}

export function chooseRenderProfile(input) {
  if (!input.webgl2 || input.reducedMotion) {
    return { mode: "static", dpr: 1, particles: 0, durationMs: 0 };
  }
  const width = Math.max(0, Number(input.width) || 0);
  const cores = Math.max(1, Number(input.hardwareConcurrency) || 1);
  const particles = width >= 1700 && cores >= 8 ? 14000 : width >= 1100 && cores >= 4 ? 8200 : 3600;
  return {
    mode: "webgl",
    dpr: Math.min(1.75, Math.max(1, Number(input.devicePixelRatio) || 1)),
    particles,
    durationMs: CINEMATIC_DURATION_MS,
  };
}

export function strategySlideAt(elapsedMs, slideCount = 5) {
  const count = Math.max(1, Math.floor(Number(slideCount) || 1));
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  return Math.floor(elapsed / STRATEGY_SLIDE_DURATION_MS) % count;
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

function plainRuleLabel(rule) {
  const label = cleanText(rule && rule.label) || "Persisted rule";
  const expression = cleanText(rule && rule.expression);
  if (!expression) return label;
  try {
    const value = JSON.parse(expression);
    if (label === "Managed stop" && Number.isFinite(Number(value && value.multiplier))) {
      return `${Number(value.multiplier)}x ATR managed stop`;
    }
    if (label === "Position sizing" && Number.isFinite(Number(value && value.max_risk_pct_per_trade))) {
      return `${Number(value.max_risk_pct_per_trade) * 100}% maximum risk per trade`;
    }
    if (label === "Exit parameters" && cleanText(value && value.style)) {
      return `Style ${String(value.style).toUpperCase()} trade management`;
    }
  } catch {
    return label;
  }
  return label;
}

function strategySlideMarkup(group, index, dormant) {
  const rules = group.rules.map((rule) => `<span class="compiler-slide-rule is-${escapeHtml(rule.origin)}"><i></i>${escapeHtml(plainRuleLabel(rule))}</span>`).join("");
  const direction = group.direction ? `<span class="compiler-direction">${escapeHtml(group.direction)}</span>` : "";
  const additional = group.additionalCount ? `<span class="compiler-more">+${group.additionalCount} persisted ${group.additionalCount === 1 ? "rule" : "rules"} in technical receipt</span>` : "";
  return `<article class="compiler-rule-slide${index === 0 ? " is-active" : ""}${dormant ? " is-dormant" : ""}" data-compiler-rule-slide="${index}" aria-hidden="${index === 0 ? "false" : "true"}">
    <div class="compiler-slide-chapter"><span>Chapter 0${index + 1}</span>${direction}</div>
    <h3>${escapeHtml(group.label)}</h3>
    <div class="compiler-slide-rules">${rules || `<span class="compiler-awaiting">Awaiting compiled rule</span>`}</div>
    ${additional}
  </article>`;
}

function technicalRuleMarkup(rule) {
  return `<article class="compiler-rule">
    <div class="compiler-rule-origin is-${escapeHtml(rule.origin)}">${escapeHtml(rule.origin.replaceAll("_", " "))}</div>
    <h4>${escapeHtml(rule.label)}</h4>
    ${rule.evidence ? `<blockquote>${escapeHtml(rule.evidence)}</blockquote>` : ""}
    ${rule.expression ? `<code>${escapeHtml(rule.expression)}</code>` : ""}
    <div class="compiler-rule-meta">${escapeHtml(rule.type)}${rule.role ? ` · ${escapeHtml(rule.role)}` : ""}${rule.span ? ` · source ${rule.span.start}-${rule.span.end}` : ""}</div>
  </article>`;
}

function technicalReceiptMarkup(model) {
  const chambers = model.chambers.map((chamber) => `<section class="compiler-receipt-chamber"><div class="compiler-receipt-chamber-head"><span>${escapeHtml(chamber.state)}</span><h4>${escapeHtml(chamber.label)}</h4></div>${chamber.rules.length ? chamber.rules.map(technicalRuleMarkup).join("") : `<div class="compiler-receipt-empty">No persisted rule in this chamber.</div>`}</section>`).join("");
  return `<div class="compiler-receipt-head"><div><span>Persisted compiler evidence</span><h3>Technical Receipt</h3></div><button type="button" data-compiler-receipt-close aria-label="Close technical receipt">×</button></div>
    <div class="compiler-receipt-truth">${escapeHtml(model.status === "uncompiled" ? "Source evidence only - no executable rule claimed" : model.seal)}</div>
    <div class="compiler-receipt-grid">${chambers}</div>
    <div class="compiler-receipt-hashes">${model.receiptHash ? `Receipt ${escapeHtml(model.receiptHash)}` : "No compiler receipt exists"}${model.graphHash ? ` · Graph ${escapeHtml(model.graphHash)}` : ""}</div>`;
}

export function renderCompilerViewMarkup(model) {
  const sourceImage = thumbnailUrl(model.source.videoId);
  const fragments = model.source.fragments.map((fragment, index) => `<span class="compiler-fragment" style="--fragment-index:${index}">${escapeHtml(fragment)}</span>`).join("");
  const groups = buildStrategyCardGroups(model);
  const dormant = model.status === "uncompiled" || model.status === "unavailable";
  return `<section class="compiler-stage is-${escapeHtml(model.status)}" aria-label="Compiler View for ${escapeHtml(model.strategy.name)}" style="--source-primary:${model.identity.primary};--source-secondary:${model.identity.secondary}">
    <div class="compiler-environment" aria-hidden="true"><img src="/slumhouse/images/compiler-luxury-cinema-v1.webp" alt=""><i></i></div>
    <canvas class="compiler-webgl" aria-hidden="true"></canvas>
    <header class="compiler-head">
      <div class="compiler-head-actions"><span class="compiler-state is-${escapeHtml(model.status)}">${escapeHtml(model.status)}</span><button class="compiler-receipt-open" type="button" data-compiler-receipt-open>Technical Receipt</button><button class="compiler-media-return" type="button" data-compiler-close>Media View</button></div>
    </header>
    <div class="compiler-cinematic" data-compiler-phase="source">
      <div class="compiler-source-plane">
        ${sourceImage ? `<img src="${sourceImage}" alt="Source thumbnail for ${escapeHtml(model.source.title)}">` : `<div class="compiler-source-missing">SOURCE IMAGE<br>UNAVAILABLE</div>`}
        <div class="compiler-source-scan"></div>
        <div class="compiler-source-label"><span>Evidence source</span><b>${escapeHtml(model.source.title)}</b><em>${model.source.transcriptChars.toLocaleString()} transcript characters</em></div>
      </div>
      <div class="compiler-fragments" aria-hidden="true">${fragments}</div>
      <div class="compiler-shockwave" aria-hidden="true"></div>
      <main class="compiler-strategy-card${dormant ? " is-dormant" : ""}">
        <div class="compiler-slide-deck">${groups.map((group, index) => strategySlideMarkup(group, index, dormant)).join("")}</div>
        <nav class="compiler-slide-nav" aria-label="Strategy rule chapters">${groups.map((group, index) => `<button type="button" data-compiler-slide="${index}" aria-label="Show ${escapeHtml(group.label)}"${index === 0 ? ` class="is-active" aria-current="step"` : ""}><i></i><span>${escapeHtml(group.label)}</span></button>`).join("")}</nav>
        <div class="compiler-seal"><b>${escapeHtml(model.seal)}</b><em>${model.receiptHash ? `Receipt ${escapeHtml(model.receiptHash.slice(0, 16))}` : "No compiler receipt exists"}</em></div>
      </main>
    </div>
    <aside class="compiler-receipt" data-compiler-receipt hidden>${technicalReceiptMarkup(model)}</aside>
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
      float rupture=smoothstep(.10,.24,uProgress);
      float vortex=smoothstep(.24,.38,uProgress)*(1.0-smoothstep(.70,.82,uProgress));
      float compression=smoothstep(.70,.86,uProgress)*(1.0-smoothstep(.86,.94,uProgress));
      float shock=smoothstep(.86,.96,uProgress);
      float pulse=.78+.35*sin(uTime*7.0+aParticle.z*3.0);
      float velocity=mix(.30,6.4*pulse,vortex)+compression*8.5;
      float angle=aParticle.x+uTime*velocity*(.45+aParticle.w*.72)+sin(uTime*2.4+aParticle.z)*vortex*.42;
      float baseRadius=aParticle.y*(1.2+rupture*.72);
      float radius=mix(baseRadius,.035,compression);
      radius=mix(radius,.14+aParticle.y*2.2,shock);
      float depth=mod(aParticle.z+uTime*(.22+vortex*(1.35+aParticle.w))+3.0,6.0)-3.0;
      depth=mix(depth,0.0,compression);
      float perspective=1.0/(1.10+max(-.85,depth)*.15);
      float turbulence=sin(angle*3.0+aParticle.z*2.2+uTime*5.0)*.09*vortex;
      float x=(cos(angle)*radius+turbulence)*perspective;
      float y=(sin(angle)*radius*.54+depth*.18+cos(angle*2.0)*.12*vortex)*perspective;
      gl_Position=vec4(x/uAspect,y,depth/8.0,1.0);
      gl_PointSize=(2.6+aParticle.w*13.5)*(1.0+vortex*1.05+compression*1.2)*perspective;
      vAlpha=(.28+aParticle.w*.92)*(1.0-smoothstep(.95,1.0,uProgress)*.82);
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
      float glow=pow(smoothstep(.5,0.0,d),1.08);
      float hot=pow(smoothstep(.20,0.0,d),2.0);
      vec3 color=mix(uPrimary,uSecondary,gl_PointCoord.y);
      color=mix(color,vec3(1.0),hot*.82);
      outColor=vec4(color,glow*min(1.0,vAlpha*1.8));
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
  host.innerHTML = renderCompilerViewMarkup(model);
  const stage = host.querySelector(".compiler-stage");
  const canvas = host.querySelector(".compiler-webgl");
  const cinematic = host.querySelector(".compiler-cinematic");
  const receipt = host.querySelector("[data-compiler-receipt]");
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
  let slideTimer = 0;
  let activeSlide = 0;

  const slides = [...host.querySelectorAll("[data-compiler-rule-slide]")];
  const slideButtons = [...host.querySelectorAll("[data-compiler-slide]")];

  function showSlide(index) {
    if (!slides.length) return;
    activeSlide = ((Number(index) || 0) % slides.length + slides.length) % slides.length;
    slides.forEach((slide, slideIndex) => {
      const active = slideIndex === activeSlide;
      slide.classList.toggle("is-active", active);
      slide.setAttribute("aria-hidden", active ? "false" : "true");
    });
    slideButtons.forEach((button, buttonIndex) => {
      const active = buttonIndex === activeSlide;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
  }

  function stopSlides() {
    window.clearInterval(slideTimer);
    slideTimer = 0;
  }

  function startSlides() {
    stopSlides();
    showSlide(0);
    if (mediaQuery.matches || slides.length < 2) return;
    slideTimer = window.setInterval(() => showSlide(activeSlide + 1), STRATEGY_SLIDE_DURATION_MS);
  }

  function settle() {
    cinematic.dataset.compilerPhase = "settled";
    stage.classList.add("is-settled");
    startSlides();
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
    stopSlides();
    showSlide(0);
    stage.classList.remove("is-settled");
    receipt.hidden = true;
    cinematic.dataset.compilerPhase = "source";
    if (profile.mode === "static") {
      settle();
      return;
    }
    if (!storm && !contextLost) {
      try {
        storm = createStormRenderer(canvas, model.identity, profile);
      } catch (error) {
        console.warn("[compiler-view] WebGL initialization failed; using static strategy stage.", error);
        storm?.destroy();
        storm = null;
        contextLost = true;
      }
    }
    if (!storm) {
      stage.classList.add("is-webgl-fallback");
      settle();
      return;
    }
    start = performance.now();
    frame = window.requestAnimationFrame(animate);
  }

  function closeReceipt() {
    receipt.hidden = true;
  }

  host.querySelector("[data-compiler-receipt-open]")?.addEventListener("click", () => {
    receipt.hidden = false;
    receipt.querySelector("[data-compiler-receipt-close]")?.focus();
  });
  receipt.querySelector("[data-compiler-receipt-close]")?.addEventListener("click", closeReceipt);
  slideButtons.forEach((button) => button.addEventListener("click", () => {
    showSlide(Number(button.dataset.compilerSlide));
    if (!mediaQuery.matches) {
      stopSlides();
      slideTimer = window.setInterval(() => showSlide(activeSlide + 1), STRATEGY_SLIDE_DURATION_MS);
    }
  }));
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
      stopSlides();
      storm?.destroy();
      storm = null;
      host.replaceChildren();
    },
  };
}
