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
  const esc = sliceBalanced(officeSrc, "function rrEsc(");
  const arena = sliceBalanced(officeSrc, "function rrRlRaceArena(");
  const empty = sliceBalanced(officeSrc, "function rrRlEmpty(");
  return vm.runInNewContext(`${tile}\n${src}\n${esc}\n${arena}\n${empty}\n;rrRlEmpty`, {}) as (
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

  it("ships the wrapped-car race arena while labeling it as decorative", () => {
    const host = { innerHTML: "" };
    rrRlEmpty(host, false);
    expect(host.innerHTML).toContain('class="rl-race-arena"');
    expect(host.innerHTML).toContain("/slumhouse/images/quantum-race-arena.png");
    expect(host.innerHTML).toContain("Quantum RL");
    expect(host.innerHTML).toContain("Classical Baseline");
    expect(host.innerHTML).toMatch(/standby scene|no result is simulated/i);
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

describe("Quantum and Paper own the full Reporting Room viewport", () => {
  it("toggles immersive mode and hides the Reporting Room movie", () => {
    expect(officeSrc).toContain("room.classList.toggle('rr-imm-mode', !ball)");
    expect(officeSrc).toMatch(/\.rr-room\.rr-imm-mode \.rr-bg[^}]*display:\s*none/);
    expect(officeSrc).toMatch(/\.rr-room\.rr-imm-mode \.rr-immersive\s*\{\s*inset:\s*62px 0 0/);
  });

  it("keeps the racing arena when real A/B data arrives", () => {
    const render = sliceBalanced(officeSrc, "function rrRenderRL(");
    expect(render).toContain("rrRlRaceArena(s1, s2, delta, true, false)");
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
      "function rrPaperFightHTML(",
      "function rrPaperFightNightVectorFallbackHTML(",
      "function rrPaperFightNightEmptyHTML(",
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
    const empty = stripComments(
      sliceBalanced(officeSrc, "function rrPaperFightNightVectorFallbackHTML(") +
      sliceBalanced(officeSrc, "function rrPaperFightNightEmptyHTML("),
    );
    expect(empty).toContain("FIGHTERS LOADING");
    expect(empty).toContain("NO SIMULATED SCORES");
    const paint = stripComments(sliceBalanced(officeSrc, "function rrPaperPaint("));
    expect(paint).not.toMatch(RANDOM_RE);
  });
});

const rrPaperFightHTML = (() => {
  const esc = sliceBalanced(officeSrc, "function rrEsc(");
  const money = sliceBalanced(officeSrc, "function rrMoney(");
  const fight = sliceBalanced(officeSrc, "function rrPaperFightHTML(");
  return vm.runInNewContext(`${esc}\n${money}\n${fight}\n;rrPaperFightHTML`, {}) as (
    data: Record<string, unknown>,
  ) => string;
})();

describe("Paper Fight Night — real all-strategy comparison renderer", () => {
  const fighter = (over: Record<string, unknown> = {}) => ({
    rank: 1,
    sessionId: "session-a",
    strategyId: "strategy-a",
    strategyName: "London Sweep",
    symbols: ["MES"],
    timeframe: "5m",
    status: "active",
    netPnl: 1250,
    returnPct: 2.5,
    realizedPnl: 1100,
    unrealizedPnl: 150,
    trades: 12,
    wins: 8,
    losses: 4,
    winRate: 8 / 12,
    positions: [{ symbol: "MES", side: "long", contracts: 2, unrealizedPnl: 150 }],
    feed: { provider: "Massive", connected: true, state: "connected", symbols: ["MES"] },
    ...over,
  });

  it("renders every strategy corner, the real scoring basis, and Massive state", () => {
    const html = rrPaperFightHTML({
      fighters: [
        fighter(),
        fighter({
          rank: 2,
          strategyId: "strategy-b",
          strategyName: "NY Reversal",
          symbols: ["MNQ"],
          netPnl: -250,
          returnPct: -0.5,
          realizedPnl: -250,
          unrealizedPnl: 0,
          wins: 2,
          losses: 3,
          winRate: 0.4,
          positions: [],
          feed: { provider: "Massive", connected: false, state: "disconnected", symbols: ["MNQ"] },
        }),
      ],
      summary: {
        activeStrategies: 2,
        openPositions: 1,
        combinedNetPnl: 1000,
        leaderStrategyIds: ["strategy-a"],
        tiedForLead: false,
      },
    });
    expect(html).toContain("London Sweep");
    expect(html).toContain("NY Reversal");
    expect(html).toContain("NET PAPER P&amp;L");
    expect(html).toContain("Massive connected");
    expect(html).toContain("Massive disconnected");
    expect(html).toContain('class="fight-board live"');
    expect(html).toContain('class="fight-live-arena"');
    expect(html).toContain("The fight card is live");
    expect(html).toContain('class="fighter leader"');
    expect(html).toContain("8–4");
    expect(html).toContain("MES · LONG · 2 ctr");
  });

  it("shows an honest tie and escapes strategy names", () => {
    const html = rrPaperFightHTML({
      fighters: [fighter({ strategyName: "<script>bad</script>" }), fighter({ strategyId: "strategy-b", strategyName: "Twin" })],
      summary: { activeStrategies: 2, openPositions: 0, combinedNetPnl: 2500, leaderStrategyIds: ["strategy-a", "strategy-b"], tiedForLead: true },
    });
    expect(html).toContain("Dead even at the bell");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;");
  });

  it("returns no fight card when no persisted fighters exist", () => {
    expect(rrPaperFightHTML({ fighters: [], summary: {} })).toBe("");
  });
});

describe("Paper Fight Night SSE reconnect display", () => {
  it("uses the session-authenticated stream and recycles a stuck EventSource", () => {
    const connect = stripComments(sliceBalanced(officeSrc, "function rrSSEConnect("));
    expect(connect).toContain("/slumhouse/api/sse/events");
    expect(connect).toContain("rrPaperConn = 'connecting'");
    expect(connect).toMatch(/setTimeout\(function \(\) \{[\s\S]*rrPaperConn = 'error'/);
    expect(connect).toContain("rrES.readyState === 1");
    expect(connect).toContain("}, 5000)");
    expect(connect).toContain("rrSseRecoverTimer");
    expect(connect).toContain("rrES.close()");
    expect(connect).toContain("}, 8000)");
  });
});

// ── Residual 2 (OR-042 F-2): a dropped SSE stream must render DISTINCTLY from a
//    genuinely-quiet floor. rrPaperEmptyHTML is pure, so both states are locked here. ──
const rrPaperEmptyHTML = (() => {
  const fallback = sliceBalanced(officeSrc, "function rrPaperFightNightVectorFallbackHTML(");
  const arena = sliceBalanced(officeSrc, "function rrPaperFightNightEmptyHTML(");
  const fn = sliceBalanced(officeSrc, "function rrPaperEmptyHTML(");
  return vm.runInNewContext(`${fallback}\n${arena}\n${fn}\n;rrPaperEmptyHTML`, {}) as (kind: string) => string;
})();

describe("immersive Paper Floor — disconnected renders distinctly from genuinely quiet", () => {
  const quiet = rrPaperEmptyHTML("quiet");
  const disconnected = rrPaperEmptyHTML("disconnected");

  it("quiet and disconnected are distinct screens (a dropped feed is not a dark floor)", () => {
    expect(quiet).not.toBe(disconnected);
    expect(quiet).toContain("FIGHTERS LOADING");
    expect(disconnected).not.toContain("FIGHTERS LOADING");
    expect(disconnected).toMatch(/interrupted|dropped|reconnect/i);
  });

  it("quiet ships a premium 3D fight-night arena that is explicitly non-simulated", () => {
    expect(quiet).toContain('class="premium-scene"');
    expect(quiet).toContain('class="premium-svg"');
    expect(quiet).toContain("PAPER FIGHT NIGHT");
    expect(quiet).toContain("CORNER 01");
    expect(quiet).toContain("CORNER 02");
    expect(quiet).toContain("/slumhouse/images/paper-fight-night-arena-v2.png");
    expect(fs.existsSync(path.resolve(PUB_DIR, "images/paper-fight-night-arena-v2.png"))).toBe(true);
    expect(quiet).toMatch(/No preview score is fabricated|not a performance reading/i);
    expect(disconnected).not.toContain("PAPER FIGHT NIGHT");
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
