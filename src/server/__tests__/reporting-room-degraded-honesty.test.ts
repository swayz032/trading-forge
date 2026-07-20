import { describe, it, expect } from "vitest";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// ops-experience 2026-07-20 — REPORTING-ROOM EMPTY-STATE HONESTY LOCK.
//
// THE DEFECT
// ----------
// `GET /slumhouse/api/reports` was fixed earlier in this campaign (OR-029 §2) to stop
// answering a failed query with HTTP 200 + empty arrays — byte-identical to a quiet
// night. It now carries `degraded: true`.
//
// Nothing rendered that field. Three genuinely different states still collapsed into
// one screen in `office.html`:
//   (a) genuinely no trades      (b) `degraded:true` — the query failed
//   (c) the request never landed / non-2xx
//
// And the shared screen did not merely lose the distinction — it ASSERTED A CAUSE:
//   "No trades yet, so there's nothing to read."
// On a failed query that sentence is false, and it is the most reassuring possible
// false sentence: the operator is told the machine is fine and idle at the moment the
// reporting path is broken. Adding `degraded` to the payload without rendering it was
// a fix that stopped one layer short of the human.
//
// WHAT THIS LOCKS
// ---------------
// The REAL shipped `rrIdleHTML()` is executed (sliced out of office.html via vm — no
// hand-copied mirror) for all three states, and each must be DISTINGUISHABLE from the
// other two. Critically, neither failure state may claim the bot did not trade.
// ─────────────────────────────────────────────────────────────────────────────

const PUB_DIR = process.env.SLUMHOUSE_PUBLIC_DIR || path.resolve(process.cwd(), "public/slumhouse");

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

function loadIdleHTML() {
  // CRLF-normalised: these files check out with Windows line endings and a needle
  // written with "\n" fails to match, which surfaces as a suite that cannot COLLECT.
  const src = fs.readFileSync(path.resolve(PUB_DIR, "office.html"), "utf8").replace(/\r\n/g, "\n");
  const esc = sliceBalanced(src, "function rrEsc(");
  const idle = sliceBalanced(src, "function rrIdleHTML(");
  return vm.runInNewContext(`${esc}\n${idle}\n;rrIdleHTML`, { String, Object, JSON }, {
    filename: "office.html",
  }) as (state?: Record<string, unknown>) => string;
}

/** The claim that must never appear on a state we cannot vouch for. */
const CLAIMS_NO_TRADES = /no trades yet|hasn.?t traded|nothing to read/i;

describe("Reporting room empty state — a failure never renders as a quiet night", () => {
  const rrIdleHTML = loadIdleHTML();

  const quiet = rrIdleHTML({ degraded: false, unreachable: false });
  const degraded = rrIdleHTML({ degraded: true, unreachable: false });
  const unreachable = rrIdleHTML({ degraded: false, unreachable: true });

  it("all three states render, and no two are identical", () => {
    for (const [label, html] of [["quiet", quiet], ["degraded", degraded], ["unreachable", unreachable]] as const) {
      expect(html.length, `${label} rendered nothing`).toBeGreaterThan(0);
    }
    expect(degraded, "degraded is indistinguishable from a quiet night").not.toBe(quiet);
    expect(unreachable, "unreachable is indistinguishable from a quiet night").not.toBe(quiet);
    expect(degraded, "degraded is indistinguishable from unreachable").not.toBe(unreachable);
  });

  it("★ neither failure state claims the bot did not trade", () => {
    // The whole point. On a failed read we do not know whether it traded, so the UI
    // must not say it didn't — that is a false statement that reads as reassurance.
    expect(
      degraded,
      "the degraded screen asserts 'no trades' — a false cause on a failed query",
    ).not.toMatch(CLAIMS_NO_TRADES);
    expect(
      unreachable,
      "the unreachable screen asserts 'no trades' — a false cause on a failed request",
    ).not.toMatch(CLAIMS_NO_TRADES);
  });

  it("the genuinely-quiet screen still explains itself (no cry-wolf on a real quiet night)", () => {
    // The inverse guard: making failures honest must not make the NORMAL case alarming.
    // A pre-live system is quiet nearly every night; that screen has to stay calm.
    expect(quiet).toMatch(CLAIMS_NO_TRADES);
    expect(quiet).not.toMatch(/problem|can.?t reach|not readable|error/i);
  });

  it("both failure screens say the trades/reports are not lost (family-grade wording)", () => {
    // Operator rule: a non-technical reader must get a plain-English state AND an
    // action-or-reassurance, never a raw fault string.
    for (const [label, html] of [["degraded", degraded], ["unreachable", unreachable]] as const) {
      expect(html, `${label}: no reassurance that nothing was lost`).toMatch(
        /safe|not been lost|nothing has been lost|will appear/i,
      );
      expect(html, `${label}: leaked a raw fault token to a non-technical reader`).not.toMatch(
        /undefined|null|\b5\d\d\b|stack|exception/i,
      );
    }
  });

  it("renders no fabricated report content in any failure state", () => {
    // The idle screen must never carry an example/sample report while claiming to be
    // a real state — fabricated data presented as real is the standing operator rule.
    for (const html of [degraded, unreachable]) {
      expect(html).not.toMatch(/Example report|rr-example-tag/i);
      expect(html).not.toMatch(/Math\.random/);
    }
  });
});
