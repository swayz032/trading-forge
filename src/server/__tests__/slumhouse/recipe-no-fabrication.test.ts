import { describe, it, expect } from "vitest";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Deep-scan #22 — no-fabrication regression harness for the Slumhouse render layer.
//
// Locks the F-1 / DS22 Track B fix: `public/slumhouse/recipe.html` previously drew
// a Box-Muller `synthesizeBell()` Monte-Carlo histogram that RE-RANDOMIZED on every
// reload (a made-up shape a family member would trust to judge account safety). That
// was deleted and replaced with `mcRenderState(mc)` → 3 honest states:
//   "real"   (>=30 recorded samples) → true histogram (the ONLY state that draws a shape)
//   "bounds" (percentiles only)      → 3 discrete P5/P50/P95 markers, NO interpolated curve
//   "empty"  (no MC yet)             → bare shelf, no bars, nothing fabricated
// And `kitchen.html` gate pills were relabeled from "Gate N cleared ✓" to the honest
// "Step N reached ●".
//
// This suite EXECUTES the REAL functions from the shipped HTML (vm on the extracted
// inline <script>), not a hand-copied mirror — a mirror test would not lock the real
// code. The determinism assertion (two renders byte-identical) is the anti-fabrication
// lock: any re-introduced Math.random() / synthesizeBell() re-randomizes and fails it.
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = process.cwd();
const RECIPE_PATH = path.resolve(REPO_ROOT, "public/slumhouse/recipe.html");
const KITCHEN_PATH = path.resolve(REPO_ROOT, "public/slumhouse/kitchen.html");

/** Extract the single attribute-less inline `<script>…</script>` blocks (skip `<script src=…>`). */
function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script>\s*([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

/**
 * Strip JS comments so we can assert on EXECUTABLE code only (comments are allowed to
 * mention the banned tokens — the whole point of the fix is documented in comments).
 * Block comments first, then `//` line comments that are not part of a `://` sequence.
 * The render-path function bodies contain no `://` and no `//` inside string literals,
 * so this is exact for our targets.
 */
function stripJsComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Minimal DOM/browser stubs so recipe.html's async bootstrap IIFE early-returns cleanly. */
function makeRecipeSandbox(): Record<string, unknown> {
  const nodeStub = () => ({
    set innerHTML(_v: string) {},
    get innerHTML() {
      return "";
    },
    appendChild() {},
    querySelector() {
      return { innerHTML: "" };
    },
    setAttribute() {},
    addEventListener() {},
    style: {},
    className: "",
    textContent: "",
  });
  const document = {
    getElementById: () => nodeStub(),
    createElement: () => nodeStub(),
  };
  return {
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    Math,
    Number,
    Array,
    Object,
    String,
    JSON,
    URLSearchParams,
    location: { search: "" },
    document,
    SH: { fetchJSON: async () => null, el: () => ({}) },
  };
}

/** Load recipe.html's inline script in a vm and return the hoisted render-path functions. */
function loadRecipeRenderFns() {
  const html = fs.readFileSync(RECIPE_PATH, "utf8");
  const src = inlineScripts(html).find((s) => s.includes("mcRenderState"));
  if (!src) throw new Error("recipe.html inline MC script not found");
  const sandbox = makeRecipeSandbox();
  vm.createContext(sandbox);
  // The bootstrap `(async () => …)()` runs with id=null (location.search="") and returns
  // before touching the network; the render-path functions are hoisted top-level decls.
  vm.runInContext(src, sandbox, { filename: "recipe.html" });
  const s = sandbox as Record<string, unknown>;
  return {
    scriptSrc: src,
    mcRenderState: s.mcRenderState as (mc: unknown) => string,
    buildMCHistogram: s.buildMCHistogram as (mc: unknown, state?: string) => string,
    buildMCPercentileBounds: s.buildMCPercentileBounds as (...a: number[]) => string,
    buildMCEmptyPlaceholder: s.buildMCEmptyPlaceholder as (...a: number[]) => string,
    renderMC: s.renderMC as unknown,
  };
}

/** Extract + execute kitchen.html's gate-journey block (GATE_DEFS/STAGE_FRONTIER/ICON/WORD/journeyForStage). */
function loadKitchenJourney() {
  const html = fs.readFileSync(KITCHEN_PATH, "utf8");
  const src = inlineScripts(html).find((s) => s.includes("journeyForStage"));
  if (!src) throw new Error("kitchen.html journeyForStage script not found");
  const startIdx = src.indexOf("const GATE_DEFS = [");
  const fnIdx = src.indexOf("function journeyForStage", startIdx);
  if (startIdx < 0 || fnIdx < 0) throw new Error("kitchen gate-journey block not found");
  // brace-match the journeyForStage body to find the block end.
  let i = src.indexOf("{", fnIdx);
  let depth = 0;
  let end = -1;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error("kitchen journeyForStage block not brace-balanced");
  const block = src.slice(startIdx, end);
  const runner = `${block}\n;({ journeyForStage, ICON, WORD, GATE_DEFS, STAGE_FRONTIER })`;
  const res = vm.runInNewContext(runner, { String, Object, Array, Number }) as {
    journeyForStage: (state: string) => { label: string; sub: string; status: string }[];
    ICON: Record<string, string>;
    WORD: Record<string, string>;
    GATE_DEFS: { label: string; sub: string }[];
    STAGE_FRONTIER: Record<string, number>;
  };
  return { block, ...res };
}

const RANDOM_RE = /\bMath\s*\.\s*random\s*\(/;
const SYNTH_RE = /\bsynthesizeBell\s*\(/;

describe("recipe.html MC render layer — no fabrication (execution lock)", () => {
  const fns = loadRecipeRenderFns();

  it("exposes the real render-path functions (guards against deletion/rename)", () => {
    expect(typeof fns.mcRenderState).toBe("function");
    expect(typeof fns.buildMCHistogram).toBe("function");
    expect(typeof fns.buildMCPercentileBounds).toBe("function");
    expect(typeof fns.buildMCEmptyPlaceholder).toBe("function");
    expect(typeof fns.renderMC).toBe("function");
  });

  it("INVARIANT 1: no executable synthesizeBell() / Math.random() in the MC render path (comments allowed)", () => {
    // Assert on the .toString() of the ACTUALLY-LOADED functions (execution-grounded),
    // comment-stripped so documented mentions of the banned tokens don't false-fail.
    const renderPath = [
      fns.renderMC,
      fns.mcRenderState,
      fns.buildMCHistogram,
      fns.buildMCPercentileBounds,
      fns.buildMCEmptyPlaceholder,
    ] as Array<() => unknown>;
    for (const fn of renderPath) {
      const exec = stripJsComments(String(fn));
      expect(exec).not.toMatch(SYNTH_RE);
      expect(exec).not.toMatch(RANDOM_RE);
    }
  });

  it("INVARIANT 2a (real): >=30 samples => true histogram bars", () => {
    const mc = {
      distribution: Array.from({ length: 40 }, (_, i) => (i - 20) * 10),
      worstYearRaw: -150,
      medianYearRaw: 20,
      bestYearRaw: 180,
    };
    expect(fns.mcRenderState(mc)).toBe("real");
    const svg = fns.buildMCHistogram(mc, "real");
    expect(svg).toContain("mc-bar-front"); // histogram bars present
    // determinism: the real histogram is a pure function of the recorded samples.
    expect(fns.buildMCHistogram(mc, "real")).toBe(svg);
  });

  it("INVARIANT 2b (bounds): percentiles-only => discrete markers, ZERO interpolated bars, byte-identical on re-render", () => {
    const mc = { worstYearRaw: -150, medianYearRaw: 20, bestYearRaw: 180 };
    expect(fns.mcRenderState(mc)).toBe("bounds");
    const first = fns.buildMCHistogram(mc, "bounds");
    // discrete P5/P50/P95 markers, NOT an interpolated distribution shape.
    expect(first).toContain("<circle");
    expect(first).not.toContain("mc-bar-front");
    // THE ANTI-FABRICATION LOCK: two renders must be byte-identical (no re-randomized shape).
    const second = fns.buildMCHistogram(mc, "bounds");
    expect(second).toBe(first);
    // drive the leaf builder directly too — same determinism contract.
    const a = fns.buildMCPercentileBounds(mc as unknown as number, 540, 200, 8, 10, 524, 160);
    const b = fns.buildMCPercentileBounds(mc as unknown as number, 540, 200, 8, 10, 524, 160);
    expect(b).toBe(a);
    expect(a).not.toContain("mc-bar-front");
  });

  it("INVARIANT 2c (empty): no MC data => bare shelf, no bars, deterministic", () => {
    expect(fns.mcRenderState({})).toBe("empty");
    const svg = fns.buildMCEmptyPlaceholder(540, 200, 8, 10, 524, 160);
    expect(svg).toContain("<rect"); // baseline shelf
    expect(svg).not.toContain("mc-bar-front"); // no fabricated bars
    expect(svg).not.toContain("<circle"); // no markers either
    expect(fns.buildMCEmptyPlaceholder(540, 200, 8, 10, 524, 160)).toBe(svg);
    // empty state routed through the top-level dispatcher also produces no bars.
    const routed = fns.buildMCHistogram({}, "empty");
    expect(routed).not.toContain("mc-bar-front");
  });
});

describe("kitchen.html gate pills — honest stage-inference labels (execution lock)", () => {
  const k = loadKitchenJourney();

  it("INVARIANT 3a: honest label vocabulary (● / reached, never ✓ / cleared)", () => {
    expect(k.ICON.pass).toBe("●");
    expect(k.WORD.pass).toBe("reached");
    // ✓ must not appear in ANY icon; ✗ (fail) is a different glyph and is allowed.
    for (const glyph of Object.values(k.ICON)) expect(glyph).not.toContain("✓");
    for (const word of Object.values(k.WORD)) expect(word.toLowerCase()).not.toContain("cleared");
  });

  it("INVARIANT 3b: rendered pill output across every lifecycle state contains no ✓ and no 'cleared'", () => {
    const states = [...Object.keys(k.STAGE_FRONTIER), "GRAVEYARD", "DECLINING", "UNKNOWN", ""];
    for (const st of states) {
      const pills = k.journeyForStage(st);
      expect(pills).toHaveLength(k.GATE_DEFS.length);
      for (const p of pills) {
        const rendered = `${k.ICON[p.status] ?? ""} ${k.WORD[p.status] ?? ""}`;
        expect(rendered).not.toContain("✓");
        expect(rendered.toLowerCase()).not.toContain("cleared");
      }
    }
  });

  it("INVARIANT 3c: executable journey block has no ✓ / 'cleared' (comments stripped)", () => {
    const exec = stripJsComments(k.block);
    expect(exec).not.toContain("✓");
    expect(exec.toLowerCase()).not.toContain("cleared");
  });
});
