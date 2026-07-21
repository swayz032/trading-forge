// src/server/__tests__/office-payout-panel-render.test.ts
//
// Charter item 12 (2026-07-21) — BEHAVIOURAL cover for the Payout Reality panel.
//
// Why this exists alongside the static guards: `office-payout-panel-guards.test.ts`
// only greps the source. A grep for `esc(...)` proves the call is written, NOT that
// a hostile value comes out inert, and it cannot catch a runtime error at all.
// This file EXECUTES the panel against a minimal DOM stub and asserts on the HTML
// it actually produces.
//
// No jsdom: it is not a dependency of this repo and adding one is a cross-cutting
// change. The stub below is only as large as this panel needs.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const panelSrc = fs.readFileSync(path.resolve("public/slumhouse/office-payout.js"), "utf-8");

interface StubEl {
  id: string;
  innerHTML: string;
  textContent: string;
  className: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  min: string;
  max: string;
  classList: { add(c: string): void; remove(c: string): void; has(c: string): boolean };
  addEventListener(ev: string, fn: (e: unknown) => void): void;
  _handlers: Record<string, ((e: unknown) => void)[]>;
  _classes: Set<string>;
}

function makeEl(id: string): StubEl {
  const classes = new Set<string>();
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  return {
    id,
    innerHTML: "",
    textContent: "",
    className: "",
    value: "",
    checked: false,
    disabled: false,
    min: "",
    max: "",
    _classes: classes,
    _handlers: handlers,
    classList: {
      add: (c: string) => void classes.add(c),
      remove: (c: string) => void classes.delete(c),
      has: (c: string) => classes.has(c),
    },
    addEventListener(ev, fn) {
      (handlers[ev] ||= []).push(fn);
    },
  };
}

/** A payout response shaped exactly like POST /api/prop-firm/payout returns. */
function fixtureResponse(overrides: Record<string, unknown> = {}) {
  return {
    firm: "Topstep",
    accountType: "50k",
    numAccounts: 1,
    avgDailyPnl: 250,
    payoutSplit: 0.8,
    ongoingMonthlyFee: 0,
    evalMonths: 1,
    bufferMonths: 2,
    totalPrePayoutMonths: 3,
    breakEvenMonth: 4,
    totalPayout: 36000,
    totalCosts: 1650,
    totalProfit: 34350,
    payout_cap_applied: {
      cap_per_request: 5000,
      requests_per_month: 1,
      monthly_cap_per_account: 5000,
      account_stage: "xfa",
      payout_path: "standard",
      dll_opted_in: true,
      source: "getPayoutCap",
      simplifications: ["no per-cycle buffer/qualifying-day modeling inside a month"],
    },
    monthlyProjection: [
      { month: 1, phase: "evaluation", grossPnl: 0, netPayout: 0, netPayoutUncapped: 0, payoutCapped: false, costs: 165, cumulativePayout: 0, cumulativeCost: 165, cumulativeProfit: -165 },
      { month: 4, phase: "funded", grossPnl: 5000, netPayout: 4000, netPayoutUncapped: 4000, payoutCapped: false, costs: 0, cumulativePayout: 4000, cumulativeCost: 165, cumulativeProfit: 3835 },
      { month: 5, phase: "funded", grossPnl: 9000, netPayout: 5000, netPayoutUncapped: 7200, payoutCapped: true, costs: 0, cumulativePayout: 9000, cumulativeCost: 165, cumulativeProfit: 8835 },
    ],
    ...overrides,
  };
}

/** Loads the panel against a stub DOM; returns handles to drive it. */
function loadPanel(firmsPayload: unknown, payoutPayload: unknown, opts: { firmsOk?: boolean; payoutOk?: boolean } = {}) {
  const els = new Map<string, StubEl>();
  const getEl = (id: string) => {
    if (!els.has(id)) els.set(id, makeEl(id));
    return els.get(id)!;
  };
  const docHandlers: Record<string, ((e: unknown) => void)[]> = {};
  const calls: { url: string; init?: Record<string, unknown> }[] = [];

  const document = {
    getElementById: (id: string) => getEl(id),
    createElement: () => ({ textContent: "" }),
    head: { appendChild: () => {} },
    addEventListener: (ev: string, fn: (e: unknown) => void) => void ((docHandlers[ev] ||= []).push(fn)),
  };

  const fetchStub = (url: string, init?: Record<string, unknown>) => {
    calls.push({ url, init });
    const isFirms = url.includes("/firms");
    const ok = isFirms ? opts.firmsOk !== false : opts.payoutOk !== false;
    const body = isFirms ? firmsPayload : payoutPayload;
    return Promise.resolve({ ok, status: ok ? 200 : 400, json: () => Promise.resolve(body) });
  };

  // The panel is a plain IIFE — run it with only the globals it touches.
  //
  // `new Function` is deliberate and safe HERE: the body is `panelSrc`, read
  // verbatim from our own `public/slumhouse/office-payout.js`. No variable is
  // interpolated into it, nothing external reaches it, and this is a test file
  // that never ships. It is the zero-dependency way to execute a plain browser
  // IIFE without adding jsdom. Do NOT generalise this into a helper that takes
  // a caller-supplied string — that would be the injection shape the pattern is
  // usually flagged for.
  // eslint-disable-next-line no-new-func
  new Function("document", "fetch", panelSrc)(document, fetchStub);

  return {
    els,
    calls,
    // Accessor, not `els.get(...)`: several inputs (ofp-pnl, ofp-stage, ofp-path)
    // are resolved lazily inside submit(), so they are absent from the map until
    // then. Going through getEl auto-creates, matching real DOM lookup.
    el: (id: string) => getEl(id),
    set: (id: string, v: string) => { getEl(id).value = v; },
    unlock: () => Promise.all((docHandlers["office:unlocked"] || []).map(f => f(null))),
    lock: () => (docHandlers["office:locked"] || []).forEach(f => f(null)),
    submit: () => {
      const form = getEl("ofp-form");
      const h = form._handlers["submit"]?.[0];
      if (!h) throw new Error("no submit handler registered");
      return h({ preventDefault() {} });
    },
    out: () => getEl("ofp-out").innerHTML,
    msg: () => getEl("ofp-msg").textContent,
    root: () => getEl("of-payout"),
  };
}

const FIRMS = [{ name: "topstep", displayName: "Topstep" }];
const flush = () => new Promise(r => setTimeout(r, 0));

describe("the panel actually runs and renders a real response", () => {
  let p: ReturnType<typeof loadPanel>;

  beforeEach(async () => {
    p = loadPanel(FIRMS, fixtureResponse());
    await p.unlock();
    await flush();
    p.set("ofp-firm", "topstep");
    p.set("ofp-pnl", "250");
    await p.submit();
    await flush();
  });

  it("renders the server-computed split, totals and break-even", () => {
    const html = p.out();
    expect(html).toContain("80%");
    expect(html).toContain("$36,000");
    expect(html).toContain("$34,350");
    expect(html).toContain("month 4");
  });

  it("renders the cap context from payout_cap_applied", () => {
    const html = p.out();
    expect(html).toContain("$5,000");
    expect(html).toContain("XFA");
    // NOT a bare toContain("opted in"): "not opted in" contains it, so the
    // inverted-boolean mutation slipped through. Asserted as a delimited value.
    expect(html).toContain(">DLL opted in<");
    // R-1: `payout_path` is `account_stage`'s sibling in this same tile and was
    // the last uncovered wrong-key read — a rename rendered "XFA · —" silently,
    // hiding WHICH path was projected even though the path feeds getPayoutCap()
    // and therefore changes the numbers above it. Delimited, same shape as the
    // DLL fix.
    expect(html).toContain(">XFA · standard<");
  });

  it("a real monthly ceiling is never rendered as 'uncapped' (wrong-key guard)", () => {
    // Renaming cap.monthly_cap_per_account made this fall into the null branch
    // and render a confident green "uncapped" — worse than blank. The fixture
    // has a $5,000 ceiling, so "uncapped" must not appear for it.
    const html = p.out();
    expect(html).toContain("$5,000");
    // Delimited, not a bare substring: a bare toContain("uncapped") passed only
    // because the static <th>Uncapped</th> header happens to be capitalised, so
    // lowercasing that header would have false-RED'd it (R-3).
    expect(html).not.toMatch(/>uncapped</);
  });

  it("no `String()`-interpolated field renders as `undefined` — smoke alarm", () => {
    // Scope, stated honestly (R-2): this catches renamed keys that reach the
    // output through String() interpolation. It does NOT cover fields with a
    // `== null ? 'X' : 'Y'` fallback — those render 'uncapped' / '—' /
    // 'not opted in' instead of 'undefined' and need their own delimited
    // assertions (see the tests above). Useful, but not the whole family.
    expect(p.out()).not.toMatch(/undefined/);
  });

  it("the eval/buffer month breakdown renders real numbers", () => {
    expect(p.out()).toContain("3 mo");
    expect(p.out()).toContain("1 eval + 2 buffer");
  });

  it("★ renders the projection's simplifications — the OR-149 constraint, proven by output", () => {
    expect(p.out()).toContain("no per-cycle buffer/qualifying-day modeling inside a month");
  });

  it("flags the capped month and shows both capped and uncapped figures", () => {
    const html = p.out();
    // NOT toContain("capped") — that was a tautology satisfied by the static
    // <th>Uncapped</th> header, so deleting the flagging entirely stayed green.
    // Assert the actual row class and the actual marker.
    expect(html).toMatch(/<tr class="capped">/);
    expect(html).toContain("⚑");
    expect(html).toContain("$7,200");   // uncapped figure still visible
  });

  it("does NOT flag months the server did not cap", () => {
    // Pairs with the above: proves the flag tracks payoutCapped rather than
    // being sprayed on every row.
    const rows = p.out().match(/<tr class="capped">/g) || [];
    expect(rows.length).toBe(1); // fixture has exactly one capped month
  });

  it("declares its scope in the rendered output, not only in comments", () => {
    const html = p.out();
    expect(html).toMatch(/50K accounts only/i);
    expect(html).toContain("CL-012");
  });
});

describe("hostile values come out inert (escaping proven by execution, not by grep)", () => {
  it("a script payload in `simplifications` is escaped, not injected", async () => {
    const evil = '<script>alert("xss")</script>';
    const p = loadPanel(FIRMS, fixtureResponse({
      payout_cap_applied: { ...fixtureResponse().payout_cap_applied, simplifications: [evil] },
    }));
    await p.unlock();
    await flush();
    p.set("ofp-firm", "topstep");
    await p.submit();
    await flush();

    const html = p.out();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("a script payload in a projection phase is escaped", async () => {
    const fx = fixtureResponse();
    (fx.monthlyProjection as Record<string, unknown>[])[0].phase = '<img src=x onerror=alert(1)>';
    const p = loadPanel(FIRMS, fx);
    await p.unlock();
    await flush();
    p.set("ofp-firm", "topstep");
    await p.submit();
    await flush();

    expect(p.out()).not.toContain("<img src=x");
    expect(p.out()).toContain("&lt;img src=x");
  });

  it("a hostile firm displayName is escaped into the dropdown", async () => {
    const p = loadPanel([{ name: "x", displayName: '<b>bad</b>' }], fixtureResponse());
    await p.unlock();
    await flush();
    expect(p.el("ofp-firm").innerHTML).not.toContain("<b>bad</b>");
    expect(p.el("ofp-firm").innerHTML).toContain("&lt;b&gt;bad&lt;/b&gt;");
  });
});

describe("schema bounds actually reach the DOM (declaration != wiring)", () => {
  // The static guard proves the constants match the zod schema. It does NOT
  // prove they are ever applied — replacing the assignments with `void` left
  // the suite green while the inputs carried min=""/max="".
  it("numAccounts input carries the schema bounds", async () => {
    const p = loadPanel(FIRMS, fixtureResponse());
    await p.unlock();
    await flush();
    expect(p.el("ofp-accts").min).toBe("1");
    expect(p.el("ofp-accts").max).toBe("20");
  });

  it("months input carries the schema bounds", async () => {
    const p = loadPanel(FIRMS, fixtureResponse());
    await p.unlock();
    await flush();
    expect(p.el("ofp-months").min).toBe("1");
    expect(p.el("ofp-months").max).toBe("36");
  });
});

describe("the uncapped tier (Topstep LFA) renders honestly", () => {
  // cap_per_request === null is a REAL tier, previously unexercised by any
  // fixture — so a fabricated cap default would have shipped green.
  const uncapped = () => {
    const base = fixtureResponse();
    return fixtureResponse({
      payout_cap_applied: {
        ...base.payout_cap_applied,
        cap_per_request: null,
        monthly_cap_per_account: null,
        account_stage: "lfa",
      },
    });
  };

  it("shows 'uncapped' only when the server actually returned null", async () => {
    const p = loadPanel(FIRMS, uncapped());
    await p.unlock();
    await flush();
    p.set("ofp-firm", "topstep");
    await p.submit();
    await flush();

    const html = p.out();
    expect(html).toContain("LFA");
    // BOTH null cap fields must render as the delimited value 'uncapped' — the
    // per-request tile and the monthly-ceiling tile. Counting them is what makes
    // this catch a fabricated cap: inventing one turns a tile into a dollar
    // figure and the count drops to 1.
    //
    // Deliberately NOT a windowed regex around "Per request" (R-3): that pinned
    // ~120 chars of fixture-shaped markup and would drift on unrelated edits.
    // Cannot assert absence of "$5,000" either — the fixture's month-5 payout is
    // legitimately $5,000.
    expect((html.match(/>uncapped</g) || []).length).toBe(2);
  });
});

describe("panel fixes from the independent grade", () => {
  it("does not state the firm's share — only the server's own payoutSplit", async () => {
    const p = loadPanel(FIRMS, fixtureResponse());
    await p.unlock();
    await flush();
    p.set("ofp-firm", "topstep");
    await p.submit();
    await flush();
    expect(p.out()).toContain("80%");
    expect(p.out()).not.toMatch(/firm keeps/i);
    expect(p.out()).not.toContain("20%");
  });

  it("states explicitly when the tower declared NO simplifications", async () => {
    const base = fixtureResponse();
    const p = loadPanel(FIRMS, fixtureResponse({
      payout_cap_applied: { ...base.payout_cap_applied, simplifications: [] },
    }));
    await p.unlock();
    await flush();
    p.set("ofp-firm", "topstep");
    await p.submit();
    await flush();
    // The honest-limits section must still exist and say so in words.
    expect(p.out()).toMatch(/What this projection does NOT model/i);
    expect(p.out()).toMatch(/declared no simplifications/i);
  });

  it("surfaces the zod `details`, not just the generic error string", async () => {
    const p = loadPanel(
      FIRMS,
      { error: "Invalid request", details: [{ path: ["avgDailyPnl"], message: "Number must be greater than 0" }] },
      { payoutOk: false },
    );
    await p.unlock();
    await flush();
    p.set("ofp-firm", "topstep");
    await p.submit();
    await flush();
    expect(p.msg()).toContain("Invalid request");
    expect(p.msg()).toContain("avgDailyPnl");
    expect(p.msg()).toContain("Number must be greater than 0");
  });
});

describe("failure paths degrade visibly instead of showing stale or fake numbers", () => {
  it("a failed projection surfaces the server's own error and hides output", async () => {
    const p = loadPanel(FIRMS, { error: "Unknown firm: bogus" }, { payoutOk: false });
    await p.unlock();
    await flush();
    p.set("ofp-firm", "topstep");
    await p.submit();
    await flush();

    expect(p.msg()).toContain("Unknown firm: bogus");
    expect(p.el("ofp-out").className).not.toContain("on");
  });

  it("a failed firm list explains itself rather than silently emptying the dropdown", async () => {
    const p = loadPanel(null, fixtureResponse(), { firmsOk: false });
    await p.unlock();
    await flush();
    expect(p.msg()).toMatch(/could not load the firm list/i);
  });

  it("submitting with no firm loaded does not fire a request", async () => {
    const p = loadPanel(null, fixtureResponse(), { firmsOk: false });
    await p.unlock();
    await flush();
    const before = p.calls.length;
    await p.submit();
    expect(p.calls.length).toBe(before);
    expect(p.msg()).toMatch(/no firm selected/i);
  });

  it("locking the Office hides the panel", async () => {
    const p = loadPanel(FIRMS, fixtureResponse());
    await p.unlock();
    await flush();
    expect(p.root()._classes.has("of-hide")).toBe(false);
    p.lock();
    expect(p.root()._classes.has("of-hide")).toBe(true);
  });
});
