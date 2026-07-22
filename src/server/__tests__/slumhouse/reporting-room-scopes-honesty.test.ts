import { describe, it, expect } from "vitest";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// ops-experience 2026-07-21 — observability-room FRONTEND honesty lock.
//
// The room now toggles five report types. The highest-stakes property is that EVERY
// scope's empty state is honest — a dashboard that invents a reading is the exact
// false-green this campaign exists to prevent. This suite executes the REAL shipped
// functions (sliced out of office.html via vm — no hand-copied mirror) and locks:
//
//   • rrIdleHTML is now scope-aware: night / soak / weekly-A/B each get a DISTINCT,
//     honest quiet screen, and a soak/ab empty never borrows the night "no trades"
//     claim (a false cause on a scope that has nothing to do with trades).
//   • the immersive Quantum-RL empty renders real em-dashes + "goes live on deploy",
//     never a fabricated number/delta; degraded blames the read, not the bot.
//   • the whole upgrade carries no Math.random / Math.sin / synthesizeBell shape
//     driver, and the soak/ab/paper empties route through honest paths (not cards).
// ─────────────────────────────────────────────────────────────────────────────

const PUB_DIR = process.env.SLUMHOUSE_PUBLIC_DIR || path.resolve(process.cwd(), "public/slumhouse");
const officeSrc = fs.readFileSync(path.resolve(PUB_DIR, "office.html"), "utf8").replace(/\r\n/g, "\n");

function sliceBalanced(src: string, needle: string): string {
  const start = src.indexOf(needle);
  if (start < 0) throw new Error(`needle not found: ${needle}`);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces from: ${needle}`);
}
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const RANDOM_RE = /\bMath\s*\.\s*random\s*\(/;
const SIN_RE = /\bMath\s*\.\s*(sin|cos)\s*\(/;
const SYNTH_RE = /\bsynthesizeBell\s*\(/;
const CLAIMS_NO_TRADES = /no trades yet|hasn.?t traded|nothing to read/i;
const FAULT_TOKENS = /undefined|null|\b5\d\d\b|stack|exception/i;

// ── The REAL scope-aware rrIdleHTML (rrEsc + rrIdleHTML, no mirror) ──
const rrIdleHTML = (() => {
  const esc = sliceBalanced(officeSrc, "function rrEsc(");
  const idle = sliceBalanced(officeSrc, "function rrIdleHTML(");
  return vm.runInNewContext(`${esc}\n${idle}\n;rrIdleHTML`, { String, Object, JSON }) as (
    s?: Record<string, unknown>,
  ) => string;
})();

describe("reporting-room per-scope empty states are honest and distinct", () => {
  const nightQuiet = rrIdleHTML({ scope: "night" });
  const soakQuiet = rrIdleHTML({ scope: "soak" });
  const abQuiet = rrIdleHTML({ scope: "ab" });

  it("each scope's quiet screen is distinct and names its own subject", () => {
    expect(soakQuiet).not.toBe(nightQuiet);
    expect(abQuiet).not.toBe(nightQuiet);
    expect(soakQuiet).not.toBe(abQuiet);
    expect(soakQuiet.toLowerCase()).toContain("soak");
    expect(abQuiet.toLowerCase()).toMatch(/a\/b|challenger/);
  });

  it("★ a soak/ab empty NEVER borrows the night 'no trades' claim (a false cause off-subject)", () => {
    expect(soakQuiet).not.toMatch(CLAIMS_NO_TRADES);
    expect(abQuiet).not.toMatch(CLAIMS_NO_TRADES);
  });

  it("soak/ab quiet screens read calm (no cry-wolf) and leak no fault token", () => {
    for (const html of [soakQuiet, abQuiet]) {
      expect(html).not.toMatch(/problem|can.?t reach|not readable|error/i);
      expect(html).not.toMatch(FAULT_TOKENS);
    }
  });

  it("★ soak/ab quiet screens carry NO number — an empty ball is prose + dashes, never a reading (F-1)", () => {
    // rrRlEmpty guards $-amounts and signed decimals; these pure-prose crystal-ball
    // idles are STRICTER — a genuinely-empty screen has no digit at all, so ANY number
    // (a "$1,240", a "+0.34" Sharpe, a "0 of 40 checks" tally) is by construction a
    // fabricated reading. The first pass shipped this guard on rrRlEmpty only; this
    // closes the same tripwire on the soak + ab idle branches (grade F-1).
    expect(soakQuiet, "soak idle leaked a digit — a fabricated reading on an empty screen").not.toMatch(/\d/);
    expect(abQuiet, "ab idle leaked a digit — a fabricated reading on an empty screen").not.toMatch(/\d/);
  });

  it("degraded/unreachable stay honest for the new scopes too (a read problem, nothing lost)", () => {
    for (const scope of ["soak", "ab"] as const) {
      const degraded = rrIdleHTML({ scope, degraded: true });
      const unreachable = rrIdleHTML({ scope, unreachable: true });
      for (const html of [degraded, unreachable]) {
        expect(html).not.toMatch(CLAIMS_NO_TRADES);
        expect(html).toMatch(/safe|not been lost|nothing has been lost|will appear/i);
        expect(html).not.toMatch(FAULT_TOKENS);
      }
      expect(degraded).not.toBe(unreachable);
    }
  });
});

// ── The REAL immersive Quantum-RL empty renderer (rrTile + rrRlSrc + rrRlEmpty) ──
const rrRlEmpty = (() => {
  const tile = sliceBalanced(officeSrc, "function rrTile(");
  const src = sliceBalanced(officeSrc, "function rrRlSrc(");
  const empty = sliceBalanced(officeSrc, "function rrRlEmpty(");
  return vm.runInNewContext(`${tile}\n${src}\n${empty}\n;rrRlEmpty`, {}) as (
    host: { innerHTML: string },
    degraded: boolean,
  ) => void;
})();

describe("immersive Quantum-RL empty state — honest dashes, no fabrication", () => {
  it("pre-deploy empty renders em-dashes + 'goes live on deploy', never a number/delta", () => {
    const host = { innerHTML: "" };
    rrRlEmpty(host, false);
    expect(host.innerHTML).toContain("—");
    expect(host.innerHTML).toContain("No A/B data yet");
    expect(host.innerHTML).toContain("goes live on deploy");
    expect(host.innerHTML).not.toMatch(/\$\d/); // no fabricated dollar reading
    expect(host.innerHTML).not.toMatch(/[+-]\d+\.\d+/); // no fabricated Sharpe/delta
  });

  it("degraded (feed unreadable) is distinct and blames the read, not the bot", () => {
    const empty = { innerHTML: "" };
    rrRlEmpty(empty, false);
    const degraded = { innerHTML: "" };
    rrRlEmpty(degraded, true);
    expect(degraded.innerHTML).not.toBe(empty.innerHTML);
    expect(degraded.innerHTML).toMatch(/not readable|read problem/i);
    expect(degraded.innerHTML).toContain("—");
  });
});

describe("reporting-room upgrade source — no fabricated data geometry", () => {
  it("the per-scope render fns carry no Math.random / Math.sin / synthesizeBell", () => {
    for (const fn of [
      "function rrPaintSoak(",
      "function rrPaintAb(",
      "function rrRenderRL(",
      "function rrRlEmpty(",
      "function rrPaperPaint(",
      "function rrPaperEmptyHTML(",
      "function rrOnPaperEvent(",
    ]) {
      const exec = stripComments(sliceBalanced(officeSrc, fn));
      expect(exec, `${fn} reached Math.random`).not.toMatch(RANDOM_RE);
      expect(exec, `${fn} reached Math.sin/cos`).not.toMatch(SIN_RE);
      expect(exec, `${fn} reached synthesizeBell`).not.toMatch(SYNTH_RE);
    }
  });

  it("soak & weekly-ab empty branches route through the honest rrIdleHTML (not a fabricated card)", () => {
    const soak = stripComments(sliceBalanced(officeSrc, "function rrPaintSoak("));
    const ab = stripComments(sliceBalanced(officeSrc, "function rrPaintAb("));
    expect(soak).toMatch(/rrIdleHTML\(\{\s*scope:\s*'soak'/);
    expect(ab).toMatch(/rrIdleHTML\(\{\s*scope:\s*'ab'/);
  });

  it("the paper floor stays honest-dark until a REAL sse event streams (no simulated tape)", () => {
    const empty = stripComments(sliceBalanced(officeSrc, "function rrPaperEmptyHTML("));
    expect(empty).toContain("Floor is dark");
    expect(empty).toContain("nothing here is simulated");
    const paint = stripComments(sliceBalanced(officeSrc, "function rrPaperPaint("));
    expect(paint).not.toMatch(RANDOM_RE);
  });
});

// ── Residual 2 (OR-042 F-2): a dropped SSE stream must render DISTINCTLY from a
//    genuinely-quiet floor. rrPaperEmptyHTML is pure, so both states are locked here. ──
const rrPaperEmptyHTML = (() => {
  const fn = sliceBalanced(officeSrc, "function rrPaperEmptyHTML(");
  return vm.runInNewContext(`${fn}\n;rrPaperEmptyHTML`, {}) as (kind: string) => string;
})();

describe("immersive Paper Floor — disconnected renders distinctly from genuinely quiet", () => {
  const quiet = rrPaperEmptyHTML("quiet");
  const disconnected = rrPaperEmptyHTML("disconnected");

  it("quiet and disconnected are distinct screens (a dropped feed is not a dark floor)", () => {
    expect(quiet).not.toBe(disconnected);
    expect(quiet).toContain("Floor is dark");
    expect(disconnected).not.toContain("Floor is dark");
    expect(disconnected).toMatch(/interrupted|dropped|reconnect/i);
  });

  it("★ disconnected blames the connection, says nothing is lost, and invents no reading", () => {
    expect(disconnected).toMatch(/connection problem|not a quiet floor/i);
    expect(disconnected).toMatch(/nothing has been lost/i);
    // No fabricated reading while the stream is down (reading-shaped, like rrRlEmpty —
    // the screen legitimately carries a structural <h2>, so guard $-amounts + deltas):
    expect(disconnected).not.toMatch(/\$\d/);
    expect(disconnected).not.toMatch(/[+-]\d+\.\d+/);
    expect(disconnected).not.toMatch(/undefined|null|\b5\d\d\b/);
  });
});
