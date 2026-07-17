/**
 * n8n-audit-api-unreachable.test.ts — fixwave2-scheduler-health-monitoring
 * (2026-07-17), finding MED-2.
 *
 * RED-PROOF for the audit-n8n-workflows.mjs half of the fix: proves
 * fetchWorkflows()/fetchWorkflowDetail() throw N8nApiUnreachableError (not a
 * generic Error) on network failure and on a non-2xx HTTP response, and that
 * EXIT_API_UNREACHABLE matches the classifier's N8N_AUDIT_EXIT_API_UNREACHABLE
 * constant scheduler.ts relies on to tell "couldn't reach n8n" apart from
 * "found real drift".
 */
import { describe, it, expect, vi, afterEach } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — .mjs audit script, no type decls; exported for test coverage.
import { fetchWorkflows, fetchWorkflowDetail, N8nApiUnreachableError, EXIT_API_UNREACHABLE } from "../../../scripts/audit-n8n-workflows.mjs";
import { N8N_AUDIT_EXIT_API_UNREACHABLE } from "../lib/n8n-drift-audit-classifier.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("audit-n8n-workflows.mjs — N8nApiUnreachableError classification", () => {
  it("EXIT_API_UNREACHABLE (script) matches N8N_AUDIT_EXIT_API_UNREACHABLE (scheduler classifier)", () => {
    // These two constants live in different files by necessity (one is a
    // vanilla .mjs script, the other a TS lib module) and must be kept in
    // sync by hand — this test is the tripwire that catches drift.
    expect(EXIT_API_UNREACHABLE).toBe(N8N_AUDIT_EXIT_API_UNREACHABLE);
    expect(EXIT_API_UNREACHABLE).toBe(2);
  });

  it("RED-PROOF: fetchWorkflows throws N8nApiUnreachableError on a network-level fetch failure", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(fetchWorkflows("https://n8n.example", "key")).rejects.toBeInstanceOf(N8nApiUnreachableError);
  });

  it("RED-PROOF: fetchWorkflows throws N8nApiUnreachableError on a non-2xx response (stale key / outage)", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    })) as unknown as typeof fetch;
    await expect(fetchWorkflows("https://n8n.example", "stale-key")).rejects.toBeInstanceOf(N8nApiUnreachableError);
  });

  it("fetchWorkflows succeeds normally when the API is reachable (no regression)", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: "w1", name: "wf-one" }] }),
    })) as unknown as typeof fetch;
    const result = await fetchWorkflows("https://n8n.example", "key");
    expect(result).toEqual([{ id: "w1", name: "wf-one" }]);
  });

  it("RED-PROOF: fetchWorkflowDetail throws N8nApiUnreachableError on a network-level fetch failure", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(fetchWorkflowDetail("https://n8n.example", "key", "wf1")).rejects.toBeInstanceOf(
      N8nApiUnreachableError,
    );
  });

  it("RED-PROOF: fetchWorkflowDetail throws N8nApiUnreachableError on a non-2xx response", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    await expect(fetchWorkflowDetail("https://n8n.example", "key", "wf1")).rejects.toBeInstanceOf(
      N8nApiUnreachableError,
    );
  });
});
