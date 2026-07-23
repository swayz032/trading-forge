/**
 * kill-switch-crit2-timeout-failclosed.test.ts
 *
 * CRIT-2 (deep-scan 2026-07-09, operator-ratified): force-close-TRIGGERING kill-switch
 * layers (L2 daily-loss/95%-force-close, L3 trailing-DD, L7 firm-suspension) must fail
 * CLOSED on timeout, not fail-OPEN. Under ordinary Railway-Postgres latency (>100ms, not
 * an error) the layer that would DETECT a breach was the one timing out, and it resolved
 * halted:false — approving a new entry on an account that should be force-closed.
 *
 * runLayerWithTimeout now takes failClosedOnTimeout: L2/L3/L7 pass true (HALTED on
 * timeout); advisory layers (4/5/8/9) pass false (fail-open preserved).
 *
 * Directly unit-tests runLayerWithTimeout (via the _runLayerWithTimeoutForTests seam)
 * with a checkFn that never resolves within the 100ms budget. RED-proof: with the fix
 * reverted (failClosedOnTimeout ignored), the fail-closed assertions fail.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../index.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/audit-log-helper.js", () => ({ insertAuditRow: vi.fn().mockResolvedValue(undefined), insertAuditRowSafe: vi.fn().mockResolvedValue(undefined) }));

import { _runLayerWithTimeoutForTests, _setForceCloseInFlightForTests } from "../production/kill-switch.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";

// A check that never resolves within the 100ms LAYER_CHECK_TIMEOUT_MS budget.
const slowCheck = () => new Promise<{ halted: boolean }>(() => { /* never resolves */ });

describe("CRIT-2 — force-close-triggering layers fail CLOSED on timeout", () => {
  it("cancels the losing timeout after a fast check resolves", async () => {
    vi.useFakeTimers();
    vi.mocked(insertAuditRow).mockClear();
    try {
      const d = await _runLayerWithTimeoutForTests(
        5,
        async () => ({ halted: false }),
        "corr-fast",
        undefined,
        false,
      );
      expect(d.halted).toBe(false);

      await vi.advanceTimersByTimeAsync(101);
      expect(insertAuditRow).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: "kill_switch.layer_5_timeout" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("L2 (failClosedOnTimeout=true) times out → HALTED (fail-closed), reason layer_timeout_fail_closed", async () => {
    const d = await _runLayerWithTimeoutForTests(2, slowCheck, "corr", undefined, true);
    expect(d.halted).toBe(true);
    expect((d as any).reason).toBe("layer_timeout_fail_closed");
  }, 3000);

  it("L3 (failClosedOnTimeout=true) times out → HALTED (fail-closed)", async () => {
    const d = await _runLayerWithTimeoutForTests(3, slowCheck, "corr", undefined, true);
    expect(d.halted).toBe(true);
  }, 3000);

  it("L7 (failClosedOnTimeout=true) times out → HALTED (fail-closed)", async () => {
    const d = await _runLayerWithTimeoutForTests(7, slowCheck, "corr", undefined, true);
    expect(d.halted).toBe(true);
  }, 3000);

  it("REGRESSION: advisory layer (failClosedOnTimeout=false) times out → fail-OPEN preserved", async () => {
    const d = await _runLayerWithTimeoutForTests(5, slowCheck, "corr", undefined, false);
    expect(d.halted).toBe(false);
  }, 3000);

  it("a force-close already in flight forces HALTED even on an advisory layer (FIX 1b preserved)", async () => {
    _setForceCloseInFlightForTests(true, "acct-1");
    const d = await _runLayerWithTimeoutForTests(5, slowCheck, "corr", "acct-1", false);
    expect(d.halted).toBe(true);
    expect((d as any).reason).toBe("layer_timeout_force_close_pending");
    _setForceCloseInFlightForTests(false, "acct-1");
  }, 3000);
});
