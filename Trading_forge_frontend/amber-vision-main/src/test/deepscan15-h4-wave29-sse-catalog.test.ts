/**
 * deepscan15-h4-wave29-sse-catalog.test.ts
 *
 * Verification suite for Trading Forge deep-scan #15 FIX-3 (H4): 5 backend
 * `WAVE29_EVENTS` members (`src/server/routes/sse.ts:383-396`) had real
 * `broadcastSSE()` call sites in the backend but were type-unreachable on the
 * frontend — no member in the `SSEEvent` discriminated union
 * (`@/types/sse-events`) and no case in `dispatchSideEffects`
 * (`@/hooks/useSSE.ts`). `quantum_rl:kill_switch_engaged` (the 6th WAVE29_EVENTS
 * member) was already wired before this pass and is NOT re-tested here.
 *
 * Test strategy mirrors deepscan12-track-r.test.ts:
 *   - Catalog completeness: `as const satisfies SSEEventType[]` fails to
 *     compile if any literal is missing from the union — TypeScript itself
 *     enforces this, the runtime assertions are a belt-and-suspenders check.
 *   - Payload shape round-trip: construct each payload type from real field
 *     names copied off the actual broadcastSSE() call sites (not guessed).
 *   - Handler coverage: `dispatchSideEffects`'s `default: { const _exhaustive:
 *     never = event; ... }` block means tsc itself refuses to compile if a
 *     union member has no switch case — so `npx tsc --noEmit` passing is the
 *     authoritative coverage check; this suite pins the event-name list so a
 *     future rename/removal is caught at the type level here too.
 */

import { describe, it, expect } from "vitest";
import type {
  SSEEventType,
  SignalShadowLoggedData,
  LifecyclePboEvaluatedData,
  LifecycleShadowDivergenceEvaluatedData,
  SignalRlAbRoutedData,
  QuantumRlTrainingCompletedData,
} from "@/types/sse-events";

// ─── Catalog completeness ─────────────────────────────────────────────────────

describe("deepscan15 H4 — Wave 29 SSE catalog completeness", () => {
  const WAVE29_NEWLY_TYPED_EVENTS = [
    "signal:shadow_logged",
    "lifecycle:pbo_evaluated",
    "lifecycle:shadow_divergence_evaluated",
    "signal:rl_ab_routed",
    "quantum_rl:training_completed",
  ] as const satisfies SSEEventType[];

  it("all 5 previously-dead Wave 29 events are valid SSEEventType members", () => {
    expect(WAVE29_NEWLY_TYPED_EVENTS).toHaveLength(5);
    for (const e of WAVE29_NEWLY_TYPED_EVENTS) {
      expect(typeof e).toBe("string");
      expect(e).toMatch(/^[a-z0-9_]+:[a-z0-9_]+$/);
    }
  });

  it("quantum_rl:kill_switch_engaged (the 6th WAVE29_EVENTS member) was already typed pre-pass", () => {
    // Sanity companion — confirms this pass didn't need to touch the one
    // member that was already wired (see QuantumRlKillSwitchEngagedData).
    const already: SSEEventType = "quantum_rl:kill_switch_engaged";
    expect(already).toBe("quantum_rl:kill_switch_engaged");
  });
});

// ─── Payload shape round-trip compatibility ──────────────────────────────────
// Field names copied from the real broadcastSSE() call sites, not guessed:
//   signal:shadow_logged                 — paper-signal-service.ts (~5640)
//   lifecycle:pbo_evaluated               — lifecycle-service.ts (~1541, ~1604)
//   lifecycle:shadow_divergence_evaluated — lifecycle-service.ts (~4254, ~4319)
//   signal:rl_ab_routed                   — paper-signal-service.ts (~5912)
//   quantum_rl:training_completed         — backtest-service.ts (~2365)

describe("deepscan15 H4 — payload shape round-trip compatibility", () => {
  it("SignalShadowLoggedData matches the paper-signal-service.ts shadow-intercept payload", () => {
    const payload: SignalShadowLoggedData = {
      sessionId: "sess-1",
      strategyId: 42,
      symbol: "MES",
      direction: "long",
      entryPrice: 5123.25,
      intendedSize: 9,
      killzone: "ny_am",
      regime: "TRENDING_UP",
      lifecycleState: "SHADOW",
      traderspostWebhookCalled: false,
      barTimestamp: "2026-07-03T13:31:00Z",
      correlationId: "corr-1",
    };
    expect(payload.lifecycleState).toBe("SHADOW");
    expect(payload.traderspostWebhookCalled).toBe(false);
  });

  it("LifecyclePboEvaluatedData matches the lifecycle-service.ts PBO gate (blocked case)", () => {
    const payload: LifecyclePboEvaluatedData = {
      strategyId: "strat-1",
      fromState: "TESTING",
      toState: "SHADOW",
      pbo: 0.22,
      threshold: 0.15,
      blocked: true,
    };
    expect(payload.blocked).toBe(true);
    expect(payload.pbo).toBeGreaterThan(payload.threshold);
  });

  it("LifecyclePboEvaluatedData supports the legacy_null grandfather case", () => {
    const payload: LifecyclePboEvaluatedData = {
      strategyId: "strat-2",
      fromState: "TESTING",
      toState: "PAPER",
      pbo: null,
      threshold: 0.15,
      blocked: false,
      legacy_null: true,
    };
    expect(payload.pbo).toBeNull();
    expect(payload.legacy_null).toBe(true);
  });

  it("LifecycleShadowDivergenceEvaluatedData matches the SHADOW→PAPER divergence gate", () => {
    const blocked: LifecycleShadowDivergenceEvaluatedData = {
      strategyId: "strat-1",
      ok: false,
      divergence_pct: 0.08,
      sample_size: 25,
      reason: "divergence_exceeds_threshold",
    };
    const passed: LifecycleShadowDivergenceEvaluatedData = {
      strategyId: "strat-1",
      ok: true,
      divergence_pct: 0.02,
      sample_size: 30,
    };
    expect(blocked.ok).toBe(false);
    expect(passed.ok).toBe(true);
  });

  it("SignalRlAbRoutedData matches the A/B paper-routing broadcast", () => {
    const payload: SignalRlAbRoutedData = {
      sessionId: "sess-2",
      strategyId: 99,
      symbol: "MNQ",
      routing: "rl-challenger",
      targetSubAccount: "slumdawg-rl-challenger",
      resolvedAccountId: "acct-2",
      routingCalled: true,
      routingSuccess: true,
      side: "short",
      contracts: 6,
      signalBar: "2026-07-03T14:05:00Z",
    };
    expect(payload.routing).toBe("rl-challenger");
    expect(payload.targetSubAccount).toBe("slumdawg-rl-challenger");
  });

  it("QuantumRlTrainingCompletedData matches the backtest-service.ts RL training completion broadcast", () => {
    const payload: QuantumRlTrainingCompletedData = {
      strategy_id: 7,
      regimes_trained: 4,
      duration_ms: 120_000,
      correlation_id: "corr-7",
    };
    expect(payload.regimes_trained).toBe(4);
  });
});
