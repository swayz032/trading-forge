/**
 * pine-export-direct-mode-guard.test.ts — deep-scan #22 Track D, fix D4.
 *
 * Bug context:
 *   pine-export-service.ts routes gateway mode through deriveGatewayOptions()
 *   (pine-gateway-options.ts). An EXPLICIT gatewayOptions={mode:"direct"} is
 *   treated as a deliberate operator opt-in (shouldAuditFallback=false), so the
 *   F-1 fail-closed live-order-gateway guard NEVER fires for it. That reopens the
 *   closed CRITICAL: a future misconfigured caller could pass mode:"direct" for a
 *   live-order context (paper_account_routing set = the operator's own A/B-routed
 *   sub-account) and silently bypass the kill-switch / compliance gate / firm-cap
 *   clamp / circuit breaker.
 *
 * Fix (D4):
 *   When direct is explicitly requested AND paper_account_routing is set, refuse
 *   it — override to tf_gateway and write an audit row. Family / monitor-only
 *   exports (no paper_account_routing) keep their intentional direct path
 *   (CLAUDE.md §7-§9).
 *
 * This mirrors the exact guard condition in pine-export-service.ts as a pure
 * function so it can be unit-tested without the DB (same pattern as
 * pine-export-archetype-placeholder-wiring.test.ts).
 */
import { describe, it, expect } from "vitest";

interface GatewayOptions {
  mode: "tf_gateway" | "direct";
  gatewayUrl?: string;
}

/**
 * Pure mirror of the D4 override branch in pine-export-service.ts:
 *
 *   if (gatewayOptions?.mode === "direct"
 *       && gwPaperRouting != null && gwPaperRouting !== "") {
 *     gwOpts.mode = "tf_gateway"; ... write audit row ...
 *   }
 */
function applyD4DirectModeGuard(
  gatewayOptions: GatewayOptions | undefined,
  paperAccountRouting: string | null | undefined,
): { mode: "tf_gateway" | "direct"; overridden: boolean; auditWritten: boolean } {
  // deriveGatewayOptions: an explicit caller opt-in wins verbatim.
  const resolvedMode: "tf_gateway" | "direct" = gatewayOptions?.mode ?? "tf_gateway";

  if (
    gatewayOptions?.mode === "direct" &&
    paperAccountRouting != null &&
    paperAccountRouting !== ""
  ) {
    return { mode: "tf_gateway", overridden: true, auditWritten: true };
  }
  return { mode: resolvedMode, overridden: false, auditWritten: false };
}

describe("D4 — explicit gatewayOptions={mode:'direct'} escape hatch is guarded", () => {
  it("OVERRIDES direct → tf_gateway for a live-order context (paper_account_routing set) + writes audit", () => {
    const r = applyD4DirectModeGuard({ mode: "direct" }, "slumdawg-rl-challenger");
    expect(r.mode).toBe("tf_gateway");
    expect(r.overridden).toBe(true);
    expect(r.auditWritten).toBe(true);
  });

  it("also overrides for the baseline A/B sub-account routing", () => {
    const r = applyD4DirectModeGuard({ mode: "direct", gatewayUrl: "https://legacy" }, "slumdawg-baseline");
    expect(r.mode).toBe("tf_gateway");
    expect(r.overridden).toBe(true);
  });

  it("PRESERVES explicit direct for family / monitor-only exports (no paper_account_routing)", () => {
    expect(applyD4DirectModeGuard({ mode: "direct" }, null).mode).toBe("direct");
    expect(applyD4DirectModeGuard({ mode: "direct" }, undefined).mode).toBe("direct");
    expect(applyD4DirectModeGuard({ mode: "direct" }, "").mode).toBe("direct");
    expect(applyD4DirectModeGuard({ mode: "direct" }, "").overridden).toBe(false);
    expect(applyD4DirectModeGuard({ mode: "direct" }, "").auditWritten).toBe(false);
  });

  it("leaves an explicit tf_gateway opt-in untouched even with routing set", () => {
    const r = applyD4DirectModeGuard({ mode: "tf_gateway" }, "slumdawg-baseline");
    expect(r.mode).toBe("tf_gateway");
    expect(r.overridden).toBe(false);
    expect(r.auditWritten).toBe(false);
  });

  it("does not fire when no explicit gatewayOptions are passed (env-default path)", () => {
    const r = applyD4DirectModeGuard(undefined, "slumdawg-rl-challenger");
    expect(r.overridden).toBe(false);
    expect(r.auditWritten).toBe(false);
  });
});
