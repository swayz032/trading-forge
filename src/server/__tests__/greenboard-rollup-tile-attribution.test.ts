import { describe, it, expect } from "vitest";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// ops-experience 2026-07-20 — ROLL-UP ATTRIBUTION LOCK for the Risk Truth board.
//
// THE DEFECT THIS EXISTS TO PREVENT
// ---------------------------------
// `buildProductionStatus()` computes `overall = worstOf(a, b, c, ...)`. worstOf is
// worst-wins, so EVERY contributing source can single-handedly drive the board to
// yellow or red. The Office panel (`public/slumhouse/office-risk.js`) renders a tile
// per question.
//
// Those two sets had silently diverged. Six severities fed the roll-up; three had a
// tile. `pnlToday`, `alertingStatus` and `autopilotStatus` could each turn Overall to
// "Problem" while every visible tile stayed green — an operator staring at an all-green
// board being told there is a problem, with nothing on screen to attribute it to.
//
// ★ Two of those three were added to the roll-up by THIS campaign (OR-027 §3, OR-031 §2).
// Adding a source to worstOf makes the aggregate MORE honest and the board LESS
// explainable at the same time, and the second half is invisible unless something
// checks for it. This is the honest-signal family seen from the other side: not a
// false calm, but a true alarm with no stated cause.
//
// WHY THIS TEST DERIVES ITS SOURCE LIST INSTEAD OF LISTING IT
// -----------------------------------------------------------
// A hand-copied list of the six sources would be a fabricated safety claim: it would
// keep passing the day someone adds a seventh, which is precisely the day it matters.
// So the roll-up membership is PARSED OUT OF THE REAL `worstOf(...)` CALL, and the
// payload shape is parsed out of the real `sixQuestions` literal and return object.
// Add a source to worstOf without a tile and this test fails on its own, unedited.
//
// The assertion is BEHAVIOURAL, not a grep: for each derived source, the real shipped
// renderData() is executed twice — once all-green, once with ONLY that source red —
// and the output must both CHANGE and carry a `bad`-classed tile. A tile that merely
// mentions the field but never reacts to its severity would not survive that.
// ─────────────────────────────────────────────────────────────────────────────

const ROUTE = path.resolve(process.cwd(), "src/server/routes/production-status.ts");
const PUB_DIR = process.env.SLUMHOUSE_PUBLIC_DIR || path.resolve(process.cwd(), "public/slumhouse");
const RISK_JS = path.resolve(PUB_DIR, "office-risk.js");

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Brace/paren-match a block starting at `needle`, returning the balanced body. */
function sliceBalanced(src: string, needle: string, open: string, close: string): string {
  const start = src.indexOf(needle);
  if (start < 0) throw new Error(`needle not found: ${needle}`);
  let i = src.indexOf(open, start);
  if (i < 0) throw new Error(`open '${open}' not found after: ${needle}`);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${open}${close} from: ${needle}`);
}

// ── Derive the REAL roll-up membership + payload shape from the route source ──
// Normalise CRLF: these files are checked out with Windows line endings, and a
// needle written with "\n" silently fails to match — which surfaces as a suite that
// fails to COLLECT rather than a red assertion. A guard that cannot load proves
// nothing, so the parser must not be line-ending sensitive.
const routeSrc = fs.readFileSync(ROUTE, "utf8").replace(/\r\n/g, "\n");

/** Local variable names whose `.severity` is passed to worstOf(). */
function deriveRollupSources(): string[] {
  const call = stripComments(sliceBalanced(routeSrc, "const overall = worstOf(", "(", ")"));
  const names = [...call.matchAll(/(\w+)\s*\.\s*severity/g)].map((m) => m[1]);
  return [...new Set(names)];
}

/**
 * Map local var name → the path it occupies in the JSON payload the browser receives.
 * Parsed from the real `sixQuestions` object literal (which uses BOTH shorthand and
 * renamed keys — `lastCleanReconciliation: lastCleanRecon`) plus the return object's
 * `autopilot_status: autopilotStatus`. Nothing here is hand-listed.
 */
function derivePayloadPaths(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const six = stripComments(sliceBalanced(routeSrc, "const sixQuestions: SixQuestions = {", "{", "}"));
  for (const line of six.split("\n")) {
    const renamed = line.match(/^\s*(\w+)\s*:\s*(\w+)\s*,?\s*$/);
    if (renamed) {
      out[renamed[2]] = ["sixQuestions", renamed[1]];
      continue;
    }
    const shorthand = line.match(/^\s*(\w+)\s*,\s*$/);
    if (shorthand) out[shorthand[1]] = ["sixQuestions", shorthand[1]];
  }
  const ret = stripComments(sliceBalanced(routeSrc, "  return {\n    overall,", "{", "}"));
  for (const line of ret.split("\n")) {
    const renamed = line.match(/^\s*(\w+)\s*:\s*(\w+)\s*,?\s*$/);
    if (renamed && !(renamed[2] in out)) out[renamed[2]] = [renamed[1]];
  }
  return out;
}

// ── Load the REAL shipped renderData() (no hand-copied mirror) ────────────────
function loadRenderData() {
  const src = fs.readFileSync(RISK_JS, "utf8").replace(/\r\n/g, "\n");
  const start = src.indexOf("function esc(");
  const rd = sliceBalanced(src, "function renderData", "{", "}");
  const block = src.slice(start, src.indexOf(rd) + rd.length);
  const runner =
    "var lastData = null;\nvar gridEl = { innerHTML: '' };\n" +
    block +
    "\n;({ render: function(d){ lastData = d; renderData(); return gridEl.innerHTML; } })";
  return vm.runInNewContext(runner, { Math, Number, String, Object, Array, JSON, isFinite }, {
    filename: "office-risk.js",
  }) as { render: (d: unknown) => string };
}

function setPath(obj: Record<string, any>, pathParts: string[], value: unknown) {
  let cur = obj;
  for (const p of pathParts.slice(0, -1)) cur = cur[p] ??= {};
  cur[pathParts[pathParts.length - 1]] = value;
}

/** An all-green payload rich enough that every tile takes its populated branch. */
function greenPayload(): Record<string, any> {
  return {
    overall: "green",
    productionMode: "shadow",
    sixQuestions: {
      areWeTrading: { halted: false, answer: "trading normally", reason: null, severity: "green" },
      pnlToday: { todayPnl: 240, expectedPnl: 200, delta: 40, severity: "green" },
      drawdownDistance: { bufferRemaining: 1850, usedPct: 0.075, firmLimit: 2000, severity: "green" },
      lastCleanReconciliation: { ageHours: 3, lastCleanDate: "2026-07-19", severity: "green" },
      killSwitchLayers: { layers: [{ name: "L1", halted: false }, { name: "L2", halted: false }] },
      alertingStatus: {
        lastAlertFiredAt: null,
        minutesSinceLastAlert: null,
        webhookConfigured: true,
        severity: "green",
      },
    },
    autopilot_status: {
      operator_absent_mode_active: false,
      last_heartbeat_at: "2026-07-20T12:00:00.000Z",
      bw_session_expires_at: null,
      cookie_refresh_status: { mffu: "fresh", topstep: "fresh" },
      discord_webhook_health: {},
      severity: "green",
    },
  };
}

describe("Risk Truth board — every roll-up source is individually attributable", () => {
  const sources = deriveRollupSources();
  const paths = derivePayloadPaths();
  const r = loadRenderData();

  it("derives the roll-up membership from the real worstOf() call", () => {
    // Sanity on the PARSER itself — if this ever reads 0 sources the suite would
    // vacuously pass, which is the failure mode that makes a guard worthless.
    expect(sources.length).toBeGreaterThanOrEqual(4);
    for (const s of sources) {
      expect(paths[s], `no payload path derived for roll-up source '${s}'`).toBeDefined();
    }
  });

  it("baseline: an all-green payload renders no 'bad' tile", () => {
    const html = r.render(greenPayload());
    expect(html).not.toContain("ofr-v bad");
  });

  // One case per DERIVED source. Adding a 7th source to worstOf() creates a 7th case
  // here automatically, and it fails until that source gets a tile.
  for (const source of deriveRollupSources()) {
    it(`'${source}' turning red produces a visible, attributable tile`, () => {
      const green = r.render(greenPayload());

      const payload = greenPayload();
      const p = derivePayloadPaths()[source];
      // Flip ONLY this source to red; everything else stays green.
      setPath(payload, [...p, "severity"], "red");
      const red = r.render(payload);

      expect(
        red,
        `'${source}' feeds worstOf() but flipping it to red changed nothing on screen — ` +
          `Overall can read "Problem" with every visible tile green and no stated cause`,
      ).not.toBe(green);

      expect(
        red,
        `'${source}' turning red rendered no 'bad'-classed tile — the operator sees a ` +
          `problem with nothing to attribute it to`,
      ).toContain("ofr-v bad");
    });
  }
});
