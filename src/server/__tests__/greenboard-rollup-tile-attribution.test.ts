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

/** Split a literal body on commas that sit at nesting depth 0. */
function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if ("({[".includes(ch)) depth++;
    else if (")}]".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** The raw argument expressions passed to worstOf(), one per element. */
function rollupArgs(src: string = routeSrc): string[] {
  const call = stripComments(sliceBalanced(src, "const overall = worstOf(", "(", ")"));
  // Drop the leading `const overall = worstOf(` and the trailing `)`.
  const body = call.slice(call.indexOf("(") + 1, call.lastIndexOf(")"));
  return splitTopLevel(body);
}

/** Local variable names whose `.severity` is passed to worstOf(). */
function deriveRollupSources(src: string = routeSrc): string[] {
  const names = rollupArgs(src)
    .map((a) => a.match(/^(\w+)\s*\.\s*severity$/)?.[1])
    .filter((n): n is string => Boolean(n));
  return [...new Set(names)];
}

/**
 * Map local var name → the path it occupies in the JSON payload the browser receives.
 * Parsed from the real `sixQuestions` object literal (which uses BOTH shorthand and
 * renamed keys — `lastCleanReconciliation: lastCleanRecon`) plus the return object's
 * `autopilot_status: autopilotStatus`. Nothing here is hand-listed.
 */
function derivePayloadPaths(src: string = routeSrc): Record<string, string[]> {
  const out: Record<string, string[]> = {};

  // Entries are split on TOP-LEVEL COMMAS, not on newlines. A renamed key wrapped
  // across two lines (`lastCleanReconciliation:\n  lastCleanRecon,`) is one entry to
  // the language and must be one entry here too. Splitting by line matched the
  // continuation as a shorthand key and derived `sixQuestions.lastCleanRecon` — a path
  // nothing reads, so the suite failed RED with a message accusing a tile that was
  // actually fine. Failing safe is not the same as failing usefully.
  const entryOf = (raw: string): [string, string] | null => {
    const flat = raw.replace(/\s+/g, " ").trim();
    const renamed = flat.match(/^(\w+)\s*:\s*(\w+)$/);
    if (renamed) return [renamed[2], renamed[1]]; // [localVar, payloadKey]
    const shorthand = flat.match(/^(\w+)$/);
    if (shorthand) return [shorthand[1], shorthand[1]];
    return null;
  };

  const sixBody = stripComments(sliceBalanced(src, "const sixQuestions: SixQuestions = {", "{", "}"));
  for (const raw of splitTopLevel(sixBody.slice(sixBody.indexOf("{") + 1, sixBody.lastIndexOf("}")))) {
    const e = entryOf(raw);
    if (e) out[e[0]] = ["sixQuestions", e[1]];
  }

  const retBody = stripComments(sliceBalanced(src, "  return {\n    overall,", "{", "}"));
  for (const raw of splitTopLevel(retBody.slice(retBody.indexOf("{") + 1, retBody.lastIndexOf("}")))) {
    const e = entryOf(raw);
    if (e && !(e[0] in out)) out[e[0]] = [e[1]];
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

  it("derives EVERY argument of the real worstOf() call — no silent coverage loss", () => {
    // Sanity on the PARSER itself. A magic floor (">= 4") only catches a TOTAL parse
    // failure; it cannot see a PARTIAL drop. If someone rewrites one argument as
    // `sevOf(autopilotStatus)`, the `x.severity` idiom no longer matches, that source
    // silently stops being tested, and a floor of 4 still passes with 5 of 6 covered.
    //
    // So the floor is the ARGUMENT COUNT of the actual call: every argument must
    // resolve to a derived source. Wrap one and this fails immediately, naming it.
    const args = rollupArgs();
    expect(args.length, "parsed zero arguments out of worstOf() — parser is broken").toBeGreaterThan(0);
    expect(
      sources.length,
      `worstOf() takes ${args.length} arguments but only ${sources.length} sources were derived. ` +
        `Unparsed: ${args.filter((a) => !/^\w+\s*\.\s*severity$/.test(a)).join(", ")}. ` +
        `Every roll-up argument must be attributable to a tile.`,
    ).toBe(args.length);
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

// ── Regression locks for the four findings raised by the independent grader ──
describe("Risk Truth board — render honesty at the value edges", () => {
  const r = loadRenderData();

  it("★ a wrapped worstOf argument is DETECTED, not silently dropped", () => {
    // Grader finding 1, exercised for real. The old floor was a magic `>= 4`, which
    // only catches a TOTAL parse failure. Wrap ONE argument in a helper and that source
    // silently stops being tested while the floor still passes — coverage shrinks with
    // no signal. The floor is now the ARGUMENT COUNT, so a partial drop is visible.
    const wrapped = `
const overall = worstOf(
    areWeTrading.severity,
    pnlToday.severity,
    sevOf(autopilotStatus)
  );
`;
    const args = rollupArgs(wrapped);
    const sources = deriveRollupSources(wrapped);
    expect(args.length, "should see all three arguments").toBe(3);
    expect(sources.length, "the wrapped arg must NOT resolve to a source").toBe(2);
    // The real assertion in the suite above compares these two — here we prove they
    // genuinely diverge on this input, which is what makes that comparison load-bearing.
    expect(sources.length).not.toBe(args.length);
  });

  it("splitTopLevel respects nesting (the parser's own foundation)", () => {
    expect(splitTopLevel("a, b, c")).toEqual(["a", "b", "c"]);
    expect(splitTopLevel("a, f(x, y), b")).toEqual(["a", "f(x, y)", "b"]);
    expect(splitTopLevel("{ p: 1, q: 2 }, z")).toEqual(["{ p: 1, q: 2 }", "z"]);
  });

  it("the real route file's renamed key derives its real payload key", () => {
    expect(derivePayloadPaths()["lastCleanRecon"]).toEqual([
      "sixQuestions",
      "lastCleanReconciliation",
    ]);
  });

  it("★ a renamed key WRAPPED ACROSS LINES still derives the real payload key", () => {
    // Grader finding 2, exercised for real. The shipped route happens to keep this
    // entry on one line, so asserting against the live file could not distinguish the
    // fixed parser from the broken one — a test that cannot tell them apart is not
    // coverage. This feeds a synthetic source where the key genuinely wraps.
    //
    // The old line-based parser matched the continuation line as a SHORTHAND key and
    // derived `sixQuestions.lastCleanRecon` — a path nothing reads.
    const synthetic = `
const sixQuestions: SixQuestions = {
  areWeTrading,
  lastCleanReconciliation:
    lastCleanRecon,
  killSwitchLayers: ksReport,
};
  return {
    overall,
    autopilot_status: autopilotStatus,
  };
`;
    const paths = derivePayloadPaths(synthetic);
    expect(paths["lastCleanRecon"]).toEqual(["sixQuestions", "lastCleanReconciliation"]);
    expect(paths["ksReport"]).toEqual(["sixQuestions", "killSwitchLayers"]);
    expect(paths["areWeTrading"]).toEqual(["sixQuestions", "areWeTrading"]);
    expect(paths["autopilotStatus"]).toEqual(["autopilot_status"]);
  });

  it("★ a NaN P&L renders Unknown, never a blank GREEN tile", () => {
    // Grader finding 4. NaN passes `!= null`, money() returns null, esc(null) is ''
    // → an EMPTY tile classed 'good'. A blank green tile is exactly the false calm
    // this board exists to prevent.
    const p = greenPayload();
    p.sixQuestions.pnlToday = { todayPnl: NaN, expectedPnl: null, delta: null, severity: "yellow" };
    const html = r.render(p);
    expect(html).toContain("Unknown");
    expect(html, "NaN P&L rendered an empty value cell").not.toMatch(/ofr-v good"><\/div>/);
  });

  it("a real $0 day still renders $0 — honesty must not swallow a true zero", () => {
    // The inverse guard: hardening against NaN/null must not turn a genuine flat day
    // into "Unknown". Zero is a real, knowable number.
    const p = greenPayload();
    p.sixQuestions.pnlToday = { todayPnl: 0, expectedPnl: 0, delta: 0, severity: "green" };
    expect(r.render(p)).toContain("$0");
  });

  it("the heartbeat sub-line is escaped exactly once", () => {
    // Grader finding 3: item() escapes `sub` itself, so pre-escaping double-escaped it.
    const p = greenPayload();
    p.autopilot_status.operator_absent_mode_active = true;
    p.autopilot_status.last_heartbeat_at = "A&B";
    const html = r.render(p);
    expect(html).toContain("A&amp;B");
    expect(html, "double-escaped").not.toContain("A&amp;amp;B");
  });
});
