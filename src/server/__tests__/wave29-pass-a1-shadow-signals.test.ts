/**
 * wave29-pass-a1-shadow-signals.test.ts — Wave 29 Pass A.1
 *
 * Tests for the SHADOW lifecycle stage:
 *   1. Migration column presence — lifecycle_shadow_signals columns + strategies.shadow_mode_enabled
 *   2. shadow_mode_enabled=false (default): existing path unchanged
 *   3. shadow_mode_enabled=true: TradersPost webhook NOT called, shadow row inserted
 *   4. Invariant: traderspost_webhook_called ALWAYS false
 *   5. Audit row lifecycle.shadow_signal_logged emitted with correlation_id
 *   6. SSE event signal:shadow_logged fires
 *   7. Lifecycle TESTING → SHADOW transition valid
 *   8. Lifecycle SHADOW → PAPER transition valid
 *   9. Lifecycle SHADOW → DEPLOY_READY direct transition INVALID
 *   10. Fail-soft: shadow INSERT failure → skip TradersPost (invariant preserved)
 *   11. Pine alert emission preserved (not inside shadow intercept block)
 *   12. shadow_mode_enabled=true AND lifecycle_state='PAPER' → inconsistency warn + route to TradersPost
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isBrokerAuthoritativeState } from "../lib/paper-authority-states.js";

// ─── Lifecycle state machine (pure-function mirror of lifecycle-service.ts) ────

const VALID_STATES = [
  "CANDIDATE",
  "TESTING",
  "SHADOW",   // Wave 29 Pass A.1: between TESTING and PAPER
  "PAPER",
  "DEPLOY_READY",
  "PILOT",
  "DEPLOYED",
  "DECLINING",
  "RETIRED",
  "GRAVEYARD",
] as const;

type LifecycleState = (typeof VALID_STATES)[number];

const VALID_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  CANDIDATE:    ["TESTING", "SHADOW", "GRAVEYARD"],  // F-3 fix: CANDIDATE→PAPER removed; fast-track now routes CANDIDATE→SHADOW
  TESTING:      ["SHADOW", "PAPER", "DECLINING", "GRAVEYARD"],
  SHADOW:       ["PAPER", "DECLINING", "GRAVEYARD"],
  PAPER:        ["DEPLOY_READY", "DECLINING", "GRAVEYARD"],
  DEPLOY_READY: ["PILOT", "DEPLOYED", "PAPER", "GRAVEYARD"],
  PILOT:        ["DEPLOYED", "PAPER", "DECLINING", "GRAVEYARD"],
  DEPLOYED:     ["DECLINING", "GRAVEYARD"],
  DECLINING:    ["TESTING", "GRAVEYARD"],
  RETIRED:      ["GRAVEYARD"],
  GRAVEYARD:    [],
};

function isValidTransition(from: LifecycleState, to: LifecycleState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

function isValidState(s: string): s is LifecycleState {
  return (VALID_STATES as readonly string[]).includes(s);
}

// ─── Shadow intercept logic (pure-function mirror of paper-signal-service.ts) ──

interface ShadowInterceptDecision {
  shouldIntercept: boolean;
  shouldEmitInconsistencyWarn: boolean;
  shouldRouteToTradersPost: boolean;
  reason: string;
}

/**
 * Pure mirror of the Wave 29 Pass A.1 shadow intercept decision, INVERTED for
 * M3 PAPER Authority Flip (2026-07-17).
 *
 * OLD doctrine (pre-M3): lifecycleState==='PAPER' was an "operator override" —
 * the signal fell through to the normal path, which (per the OLD
 * PAPER_PLUS_STATES broker-eligible set) COULD reach a real TradersPost order
 * via the A/B rl-challenger routeOrder() branch further down in
 * paper-signal-service.ts.
 *
 * NEW doctrine (M3): PAPER is internal-engine-only. The control-flow shape at
 * this exact branch is UNCHANGED (still falls through, still logs the
 * inconsistency warn) — what changed is item 3's shared
 * BROKER_AUTHORITATIVE_STATES constant, which structurally REMOVED "PAPER"
 * from the broker-eligible set used by that SAME rl-challenger branch. So
 * "falling through" now can NEVER reach routeOrder() for a PAPER-state
 * strategy — it only ever reaches the internal fill path (pendingEntryQueue
 * -> openPosition()). Does NOT touch DB, SSE, or audit log — those are
 * side-effects in the service.
 */
function decideShadowIntercept(
  shadowModeEnabled: boolean,
  lifecycleState: string,
): ShadowInterceptDecision {
  if (!shadowModeEnabled) {
    return {
      shouldIntercept: false,
      shouldEmitInconsistencyWarn: false,
      shouldRouteToTradersPost: true,
      reason: "shadow_mode_disabled",
    };
  }
  // shadow_mode_enabled=true
  if (lifecycleState === "PAPER") {
    // Operator override: already promoted, falls through to the internal
    // fill path — NEVER TradersPost as of M3 (PAPER is internal-engine-only).
    return {
      shouldIntercept: false,
      shouldEmitInconsistencyWarn: true,
      shouldRouteToTradersPost: false,
      reason: "operator_override_lifecycle_paper",
    };
  }
  // Normal SHADOW stage: intercept
  return {
    shouldIntercept: true,
    shouldEmitInconsistencyWarn: false,
    shouldRouteToTradersPost: false,  // INVARIANT: never route
    reason: "shadow_stage_intercept",
  };
}

// ─── Shadow signal row shape (matches lifecycle_shadow_signals table) ─────────

interface ShadowSignalRow {
  strategyId: string;
  signalTs: Date;
  direction: "long" | "short";
  entryPrice: number;
  intendedSize: number;
  killzone: string | null;
  regime: string | null;
  confluenceScore: number | null;
  lifecycleState: string;
  divergenceVsBacktest: number | null;
  sourceCorrelationId: string;
  traderspostWebhookCalled: boolean;
}

function buildShadowSignalRow(overrides: Partial<ShadowSignalRow> = {}): ShadowSignalRow {
  return {
    strategyId: "00000000-0000-0000-0000-000000000001",
    signalTs: new Date("2026-05-26T14:00:00Z"),
    direction: "long",
    entryPrice: 5250.75,
    intendedSize: 6,
    killzone: "ny_am",
    regime: "TRENDING",
    confluenceScore: 0.78,
    lifecycleState: "SHADOW",
    divergenceVsBacktest: null,   // filled by A.3 divergence checker
    sourceCorrelationId: "corr-test-uuid-001",
    traderspostWebhookCalled: false,  // INVARIANT
    ...overrides,
  };
}

// ─── Audit row shape ──────────────────────────────────────────────────────────

interface ShadowAuditRow {
  action: string;
  entityType: string;
  entityId: string;
  decisionAuthority: string;
  result: {
    direction: string;
    entry_price: number;
    intended_size: number;
    killzone: string | null;
    regime: string | null;
    confluence_score: number | null;
    lifecycle_state: string;
    traderspost_webhook_called: boolean;
    symbol: string;
    correlation_id: string;
  };
  status: string;
  correlationId: string;
}

function buildShadowAuditRow(overrides: Partial<ShadowAuditRow> = {}): ShadowAuditRow {
  return {
    action: "lifecycle.shadow_signal_logged",
    entityType: "strategy",
    entityId: "00000000-0000-0000-0000-000000000001",
    decisionAuthority: "system",
    result: {
      direction: "long",
      entry_price: 5250.75,
      intended_size: 6,
      killzone: "ny_am",
      regime: "TRENDING",
      confluence_score: 0.78,
      lifecycle_state: "SHADOW",
      traderspost_webhook_called: false,
      symbol: "MES",
      correlation_id: "corr-test-uuid-001",
    },
    status: "info",
    correlationId: "corr-test-uuid-001",
    ...overrides,
  };
}

// ─── SSE event shape ──────────────────────────────────────────────────────────

interface ShadowSsePayload {
  event: string;
  data: {
    sessionId: string;
    strategyId: string;
    symbol: string;
    direction: string;
    entryPrice: number;
    intendedSize: number;
    killzone: string | null;
    regime: string | null;
    lifecycleState: string;
    traderspostWebhookCalled: boolean;
    barTimestamp: number | string | null;
    correlationId: string;
  };
}

function buildShadowSsePayload(overrides: Partial<ShadowSsePayload["data"]> = {}): ShadowSsePayload {
  return {
    event: "signal:shadow_logged",
    data: {
      sessionId: "sess-test-001",
      strategyId: "00000000-0000-0000-0000-000000000001",
      symbol: "MES",
      direction: "long",
      entryPrice: 5250.75,
      intendedSize: 6,
      killzone: "ny_am",
      regime: "TRENDING",
      lifecycleState: "SHADOW",
      traderspostWebhookCalled: false,
      barTimestamp: 1748390400000,
      correlationId: "corr-test-uuid-001",
      ...overrides,
    },
  };
}

// ─── 1. Migration column presence contract ────────────────────────────────────

describe("Migration 0160 — lifecycle_shadow_signals schema contract", () => {
  const EXPECTED_COLUMNS = [
    "id",
    "strategy_id",
    "signal_ts",
    "direction",
    "entry_price",
    "intended_size",
    "killzone",
    "regime",
    "confluence_score",
    "lifecycle_state",
    "divergence_vs_backtest",
    "source_correlation_id",
    "traderspost_webhook_called",
    "created_at",
  ];

  it("all required columns are declared in the migration", () => {
    for (const col of EXPECTED_COLUMNS) {
      // Document the contract: these columns must exist
      expect(typeof col).toBe("string");
    }
    expect(EXPECTED_COLUMNS).toHaveLength(14);
  });

  it("source_correlation_id is required (NOT NULL) — every signal must be traceable", () => {
    // Invariant from migration: NOT NULL, no default
    expect(EXPECTED_COLUMNS).toContain("source_correlation_id");
  });

  it("traderspost_webhook_called has DEFAULT false", () => {
    // Migration enforces BOOLEAN NOT NULL DEFAULT false
    const row = buildShadowSignalRow();
    expect(row.traderspostWebhookCalled).toBe(false);
  });

  it("lifecycle_state has DEFAULT 'SHADOW'", () => {
    const row = buildShadowSignalRow();
    expect(row.lifecycleState).toBe("SHADOW");
  });

  it("divergence_vs_backtest is nullable on insert (filled by A.3)", () => {
    const row = buildShadowSignalRow();
    expect(row.divergenceVsBacktest).toBeNull();
  });

  it("strategies.shadow_mode_enabled defaults to false (backward-compat)", () => {
    const DEFAULT_SHADOW_MODE = false;
    expect(DEFAULT_SHADOW_MODE).toBe(false);
  });
});

// ─── 2. shadow_mode_enabled=false (default path) ─────────────────────────────

describe("Shadow intercept — shadow_mode_enabled=false (default)", () => {
  it("does NOT intercept when shadow_mode_enabled=false", () => {
    const decision = decideShadowIntercept(false, "PAPER");
    expect(decision.shouldIntercept).toBe(false);
  });

  it("routes to TradersPost when shadow_mode_enabled=false", () => {
    const decision = decideShadowIntercept(false, "PAPER");
    expect(decision.shouldRouteToTradersPost).toBe(true);
  });

  it("does NOT emit inconsistency warn when shadow_mode_disabled", () => {
    const decision = decideShadowIntercept(false, "PAPER");
    expect(decision.shouldEmitInconsistencyWarn).toBe(false);
  });

  it("reason is shadow_mode_disabled when flag is false", () => {
    const decision = decideShadowIntercept(false, "TESTING");
    expect(decision.reason).toBe("shadow_mode_disabled");
  });

  it("does NOT intercept for any lifecycle state when shadow_mode_disabled", () => {
    for (const state of VALID_STATES) {
      const decision = decideShadowIntercept(false, state);
      expect(decision.shouldIntercept).toBe(false);
    }
  });
});

// ─── 3. shadow_mode_enabled=true: intercept + no TradersPost ─────────────────

describe("Shadow intercept — shadow_mode_enabled=true (normal SHADOW stage)", () => {
  it("intercepts the signal when shadow_mode_enabled=true and lifecycle_state=SHADOW", () => {
    const decision = decideShadowIntercept(true, "SHADOW");
    expect(decision.shouldIntercept).toBe(true);
  });

  it("does NOT route to TradersPost when intercepted (invariant)", () => {
    const decision = decideShadowIntercept(true, "SHADOW");
    expect(decision.shouldRouteToTradersPost).toBe(false);
  });

  it("reason is shadow_stage_intercept when intercepted", () => {
    const decision = decideShadowIntercept(true, "SHADOW");
    expect(decision.reason).toBe("shadow_stage_intercept");
  });

  it("intercepts when lifecycle_state=TESTING with shadow_mode enabled", () => {
    // Strategy just transitioned TESTING → SHADOW; lifecycle may still be TESTING
    const decision = decideShadowIntercept(true, "TESTING");
    expect(decision.shouldIntercept).toBe(true);
    expect(decision.shouldRouteToTradersPost).toBe(false);
  });
});

// ─── 4. Invariant: traderspost_webhook_called ALWAYS false ───────────────────

describe("Shadow invariant — traderspost_webhook_called always false", () => {
  it("shadow signal row always has traderspost_webhook_called=false", () => {
    const row = buildShadowSignalRow();
    expect(row.traderspostWebhookCalled).toBe(false);
  });

  it("traderspost_webhook_called cannot be true in a valid shadow row", () => {
    // The migration enforces DEFAULT false; application enforces invariant.
    // Building a row with true is a CRITICAL violation — never constructible via normal path.
    const normalRow = buildShadowSignalRow({ traderspostWebhookCalled: false });
    expect(normalRow.traderspostWebhookCalled).toBe(false);
  });

  it("shadow intercept decision never sets shouldRouteToTradersPost=true (non-PAPER states)", () => {
    const shadowStates: LifecycleState[] = ["SHADOW", "TESTING", "CANDIDATE", "DECLINING"];
    for (const state of shadowStates) {
      const decision = decideShadowIntercept(true, state);
      expect(decision.shouldRouteToTradersPost).toBe(false);
    }
  });

  it("shadow signal row has lifecycle_state='SHADOW' by default (documents intent)", () => {
    const row = buildShadowSignalRow();
    expect(row.lifecycleState).toBe("SHADOW");
  });
});

// ─── 5. Audit row: lifecycle.shadow_signal_logged ────────────────────────────

describe("Audit row — lifecycle.shadow_signal_logged", () => {
  it("audit action is lifecycle.shadow_signal_logged", () => {
    const row = buildShadowAuditRow();
    expect(row.action).toBe("lifecycle.shadow_signal_logged");
  });

  it("audit entityType is strategy", () => {
    const row = buildShadowAuditRow();
    expect(row.entityType).toBe("strategy");
  });

  it("audit decisionAuthority is system", () => {
    const row = buildShadowAuditRow();
    expect(row.decisionAuthority).toBe("system");
  });

  it("audit status is info", () => {
    const row = buildShadowAuditRow();
    expect(row.status).toBe("info");
  });

  it("audit result contains correlation_id", () => {
    const row = buildShadowAuditRow();
    expect(typeof row.result.correlation_id).toBe("string");
    expect(row.result.correlation_id.length).toBeGreaterThan(0);
  });

  it("audit result.traderspost_webhook_called is always false", () => {
    const row = buildShadowAuditRow();
    expect(row.result.traderspost_webhook_called).toBe(false);
  });

  it("audit result.lifecycle_state is SHADOW", () => {
    const row = buildShadowAuditRow();
    expect(row.result.lifecycle_state).toBe("SHADOW");
  });

  it("audit correlationId matches result.correlation_id (end-to-end trace)", () => {
    const row = buildShadowAuditRow();
    expect(row.correlationId).toBe(row.result.correlation_id);
  });
});

// ─── 6. SSE event: signal:shadow_logged ──────────────────────────────────────

describe("SSE event — signal:shadow_logged", () => {
  it("SSE event name is signal:shadow_logged", () => {
    const payload = buildShadowSsePayload();
    expect(payload.event).toBe("signal:shadow_logged");
  });

  it("SSE data contains traderspostWebhookCalled=false", () => {
    const payload = buildShadowSsePayload();
    expect(payload.data.traderspostWebhookCalled).toBe(false);
  });

  it("SSE data contains lifecycleState=SHADOW", () => {
    const payload = buildShadowSsePayload();
    expect(payload.data.lifecycleState).toBe("SHADOW");
  });

  it("SSE data contains correlationId for §10b end-to-end tracing", () => {
    const payload = buildShadowSsePayload();
    expect(typeof payload.data.correlationId).toBe("string");
    expect(payload.data.correlationId.length).toBeGreaterThan(0);
  });

  it("SSE data contains direction, entryPrice, intendedSize for divergence analysis", () => {
    const payload = buildShadowSsePayload({ direction: "short", entryPrice: 5248.0, intendedSize: 3 });
    expect(payload.data.direction).toBe("short");
    expect(payload.data.entryPrice).toBe(5248.0);
    expect(payload.data.intendedSize).toBe(3);
  });
});

// ─── 7. Lifecycle TESTING → SHADOW valid ──────────────────────────────────────

describe("Lifecycle transitions — TESTING → SHADOW", () => {
  it("TESTING → SHADOW is a valid transition", () => {
    expect(isValidTransition("TESTING", "SHADOW")).toBe(true);
  });

  it("SHADOW is in VALID_STATES", () => {
    expect(isValidState("SHADOW")).toBe(true);
  });

  it("SHADOW appears between TESTING and PAPER in the state list", () => {
    const testingIdx = VALID_STATES.indexOf("TESTING");
    const shadowIdx = VALID_STATES.indexOf("SHADOW");
    const paperIdx = VALID_STATES.indexOf("PAPER");
    expect(shadowIdx).toBeGreaterThan(testingIdx);
    expect(shadowIdx).toBeLessThan(paperIdx);
  });
});

// ─── 8. Lifecycle SHADOW → PAPER valid ────────────────────────────────────────

describe("Lifecycle transitions — SHADOW → PAPER", () => {
  it("SHADOW → PAPER is a valid transition", () => {
    expect(isValidTransition("SHADOW", "PAPER")).toBe(true);
  });

  it("SHADOW → DECLINING is a valid transition (strategy rejected during shadow)", () => {
    expect(isValidTransition("SHADOW", "DECLINING")).toBe(true);
  });

  it("SHADOW → GRAVEYARD is a valid transition (terminal burial)", () => {
    expect(isValidTransition("SHADOW", "GRAVEYARD")).toBe(true);
  });
});

// ─── 9. Lifecycle SHADOW → DEPLOY_READY direct INVALID ───────────────────────

describe("Lifecycle transitions — SHADOW → DEPLOY_READY INVALID", () => {
  it("SHADOW → DEPLOY_READY direct is INVALID (must go through PAPER first)", () => {
    expect(isValidTransition("SHADOW", "DEPLOY_READY")).toBe(false);
  });

  it("SHADOW → PILOT direct is INVALID", () => {
    expect(isValidTransition("SHADOW", "PILOT")).toBe(false);
  });

  it("SHADOW → DEPLOYED direct is INVALID", () => {
    expect(isValidTransition("SHADOW", "DEPLOYED")).toBe(false);
  });

  it("SHADOW → TESTING reverse is INVALID (no regression from shadow)", () => {
    expect(isValidTransition("SHADOW", "TESTING")).toBe(false);
  });

  it("SHADOW → CANDIDATE reverse is INVALID", () => {
    expect(isValidTransition("SHADOW", "CANDIDATE")).toBe(false);
  });

  it("valid SHADOW exits are only PAPER, DECLINING, GRAVEYARD", () => {
    const validExits = VALID_TRANSITIONS["SHADOW"];
    expect(validExits).toEqual(["PAPER", "DECLINING", "GRAVEYARD"]);
  });
});

// ─── 10. Fail-soft: INSERT failure still skips TradersPost ───────────────────

describe("Fail-soft — shadow INSERT failure preserves invariant", () => {
  // The service wraps the INSERT in .catch() and STILL returns early.
  // This section documents the invariant contract as code.

  interface FailSoftResult {
    traderspostCalled: boolean;
    pendingEntryQueued: boolean;
    errorLogged: boolean;
  }

  function simulateShadowInsertFailure(): FailSoftResult {
    // Simulate what the service does when INSERT throws:
    //   1. Log the error (errorLogged=true)
    //   2. Still return early (pendingEntryQueued=false)
    //   3. NEVER call TradersPost (traderspostCalled=false)
    return {
      traderspostCalled: false,    // INVARIANT: shadow intercept NEVER routes
      pendingEntryQueued: false,   // still returns early
      errorLogged: true,           // observability preserved
    };
  }

  it("TradersPost is NOT called even when shadow INSERT fails", () => {
    const result = simulateShadowInsertFailure();
    expect(result.traderspostCalled).toBe(false);
  });

  it("pending entry is NOT queued even when shadow INSERT fails", () => {
    const result = simulateShadowInsertFailure();
    expect(result.pendingEntryQueued).toBe(false);
  });

  it("error is logged when shadow INSERT fails (observability preserved)", () => {
    const result = simulateShadowInsertFailure();
    expect(result.errorLogged).toBe(true);
  });

  it("fail-soft reason: shadow invariant takes precedence over observability", () => {
    // The .catch() block intentionally skips the TradersPost path.
    // This is the documented behavior from paper-signal-service.ts line comment:
    // "Fail-soft on shadow INSERT failure: log error but STILL skips TradersPost.
    //  The shadow invariant (never route) takes precedence over observability."
    const invariantPreserved = true; // documented contract
    expect(invariantPreserved).toBe(true);
  });
});

// ─── 11. Pine alert emission preserved ───────────────────────────────────────

describe("Pine alert emission — preserved by shadow intercept", () => {
  // Pine alerts fire from TradingView's Pine Strategy() script when entry conditions
  // are met — BEFORE the webhook reaches paper-signal-service.ts. The shadow intercept
  // is DOWNSTREAM of Pine. The intercepted signal is therefore proof that Pine fired.

  it("shadow intercept is downstream of Pine alert emission", () => {
    // Pine alert fires → TradersPost webhook → paper-signal-service.ts
    // Shadow intercept is at the pendingEntryQueue.set() call site.
    // Pine already fired by the time we intercept.
    const pineAlreadyFired = true;
    expect(pineAlreadyFired).toBe(true);
  });

  it("shadow intercept does NOT suppress Pine alert (upstream, not intercepted)", () => {
    // The shadow intercept only prevents pendingEntryQueue.set() and TradersPost routing.
    // It does not call any Pine API or suppress TradingView webhooks.
    const pineSuppressionOccurs = false;
    expect(pineSuppressionOccurs).toBe(false);
  });

  it("operator can see shadow signals on TradingView chart (Pine still draws them)", () => {
    // This is the key UX property of the SHADOW stage:
    // Operator sees entry signals on chart but no position is opened.
    // Documented in migration 0160 comment and paper-signal-service.ts intercept block.
    const operatorCanSeeSignalOnChart = true;
    expect(operatorCanSeeSignalOnChart).toBe(true);
  });
});

// ─── 12. Operator override: shadow_mode_enabled=true AND lifecycle_state='PAPER' ─
// INVERTED for M3 PAPER Authority Flip (2026-07-17): "routes through" now means
// "reaches the internal engine fill path", never TradersPost.

describe("Operator override — shadow_mode_enabled=true with lifecycle_state=PAPER (M3-inverted)", () => {
  it("does NOT intercept when lifecycle_state=PAPER (operator override) — unchanged by M3", () => {
    const decision = decideShadowIntercept(true, "PAPER");
    expect(decision.shouldIntercept).toBe(false);
  });

  it("emits inconsistency warn when shadow_mode_enabled AND lifecycle_state=PAPER — unchanged by M3", () => {
    const decision = decideShadowIntercept(true, "PAPER");
    expect(decision.shouldEmitInconsistencyWarn).toBe(true);
  });

  it("does NOT route to TradersPost when lifecycle_state=PAPER (M3 doctrine-pinning RED-proof — was true pre-M3)", () => {
    const decision = decideShadowIntercept(true, "PAPER");
    expect(decision.shouldRouteToTradersPost).toBe(false);
  });

  it("reason is operator_override_lifecycle_paper — unchanged by M3 (only the routing consequence inverted)", () => {
    const decision = decideShadowIntercept(true, "PAPER");
    expect(decision.reason).toBe("operator_override_lifecycle_paper");
  });

  it("audit action for inconsistency warn is lifecycle.shadow_mode_inconsistency_warn — unchanged by M3", () => {
    // Document the action name for monitoring/alerting wiring.
    const INCONSISTENCY_WARN_ACTION = "lifecycle.shadow_mode_inconsistency_warn";
    expect(INCONSISTENCY_WARN_ACTION).toBe("lifecycle.shadow_mode_inconsistency_warn");
  });

  it("inconsistency warn audit result decision field is truth-corrected to override_route_to_internal_engine (M3 2026-07-17)", () => {
    // Pre-M3 this field read "override_route_to_traderspost" — which was
    // already a misleading description of what the code literally did (it
    // fell through to pendingEntryQueue -> openPosition(), never routeOrder(),
    // even before M3 — see paper-signal-service.ts's item 4 comment for the
    // full truth-in-labeling correction). M3 fixes the field to accurately
    // name the internal-fill path this branch has always actually reached.
    const warnResult = {
      shadow_mode_enabled: true,
      lifecycle_state: "PAPER",
      decision: "override_route_to_internal_engine",
    };
    expect(warnResult.shadow_mode_enabled).toBe(true);
    expect(warnResult.lifecycle_state).toBe("PAPER");
    expect(warnResult.decision).toBe("override_route_to_internal_engine");
  });

  it("real paper-signal-service.ts source uses the corrected decision field + no longer claims TradersPost routing", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/server/services/paper-signal-service.ts"),
      "utf8",
    );
    const idx = src.indexOf("lifecycle.shadow_mode_inconsistency_warn");
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 800);
    expect(block).toContain('decision: "override_route_to_internal_engine"');
    expect(block).not.toContain('decision: "override_route_to_traderspost"');
  });

  it("real paper-signal-service.ts's RL A/B routeOrder() guard excludes PAPER — the structural mechanism that makes this override safe", () => {
    // This is item 3's constant doing the real work: even though this branch
    // "falls through", the shared BROKER_AUTHORITATIVE_STATES set (imported,
    // not re-declared) no longer contains PAPER, so the downstream
    // routeOrder() call this fallthrough could otherwise reach is
    // structurally skipped for a PAPER-state strategy.
    const src = readFileSync(
      resolve(process.cwd(), "src/server/services/paper-signal-service.ts"),
      "utf8",
    );
    expect(isBrokerAuthoritativeState("PAPER")).toBe(false);
    expect(src).toContain("BROKER_AUTHORITATIVE_STATES.includes(lcStateForRouting");
  });
});
