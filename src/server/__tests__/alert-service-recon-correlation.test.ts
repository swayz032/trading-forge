/**
 * alert-service-recon-correlation.test.ts — deep-scan Observability #5 (re-cert carry-forward).
 *
 * Permanent regression guard that AlertFactory.criticalReconciliationMismatch forwards its
 * correlationId (the recon run id) into the Discord alert payload — the last hop of the
 * bar→handler→DB→SSE→audit_log→alert correlation chain. The re-cert supplied a throwaway probe;
 * this lands it as a committed test. Mocks db/SSE/notification/metrics + intercepts global.fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db/index.js", () => ({
  db: { insert: () => ({ values: () => ({ returning: async () => [{ id: 1 }] }) }) },
}));
vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../services/notification-service.js", () => ({ notifyWarning: vi.fn(), notifyInfo: vi.fn() }));
vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: vi.fn((s: string) => s),
  applyFamilyFallback: vi.fn((s: string) => s),
}));
vi.mock("../lib/metrics-registry.js", () => ({ warningSeverityDiscordRoutedTotal: { inc: vi.fn() } }));

import { AlertFactory } from "../services/alert-service.js";

const details = [{ source: "production_trades_vs_traderspost_confirmed", expected: 3, actual: 2, delta: -1 }];
let capturedBody: Record<string, unknown> | undefined;
const origFetch = global.fetch;

beforeEach(() => {
  capturedBody = undefined;
  process.env.DISCORD_ALERT_PORT = "4100";
  global.fetch = vi.fn(async (_url: unknown, opts: { body?: string }) => {
    capturedBody = JSON.parse(opts?.body ?? "{}");
    return { ok: true } as Response;
  }) as unknown as typeof fetch;
});
afterEach(() => { global.fetch = origFetch; });

describe("criticalReconciliationMismatch → Discord payload correlation_id", () => {
  it("forwards the recon run correlationId into the Discord alert body (traceable to audit_log)", async () => {
    await AlertFactory.criticalReconciliationMismatch("2026-07-06", 3, details, "recon-run-abc-123");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(capturedBody?.correlationId).toBe("recon-run-abc-123");
    expect(capturedBody?.severity).toBe("critical");
  });

  it("omitted correlationId → null in the payload (no crash, still delivers)", async () => {
    await AlertFactory.criticalReconciliationMismatch("2026-07-06", 3, details);
    expect(capturedBody?.correlationId).toBeNull();
  });
});
