/**
 * Wave 24 Pass 1 (Item 13) — n8n webhook auto-re-register after MCP partial-update.
 *
 * Pins the behavior of N8nWorkflowDeployer.updatePartialWorkflow():
 *   1. First probe 200 → no force-cycle, one `webhook_route_verified` audit row.
 *   2. First probe 404 → force-cycle → second probe 200 → one `webhook_auto_reregistered`
 *      audit row + workflow active toggled OFF then ON.
 *   3. First probe 404 → force-cycle → still 404 → CRITICAL audit row + Discord notify.
 *   4. Workflow without webhook nodes → zero probes, zero remediation, zero audit rows.
 *   5. Multiple webhook nodes are each probed independently.
 *
 * The bug being pinned: n8n 2.10.3 partial-update API leaves webhook routes
 * unregistered until an operator manually toggles Active OFF/ON. This wrapper
 * automates the cycle so a 14-day operator vacation cannot silently break
 * autonomously-deployed webhook routes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn(async () => true),
  insertAuditRow: vi.fn(async () => undefined),
}));

vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn(),
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
  notify: vi.fn(),
}));

// Minimal logger mock — avoid pino bootstrap pulling extra deps.
vi.mock("../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { N8nWorkflowDeployer, type WorkflowDefinition } from "../services/n8n-workflow-deployer.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { notifyCritical } from "../services/notification-service.js";

function buildWorkflow(webhookPaths: string[]): WorkflowDefinition {
  return {
    id: "wf-test-123",
    name: "test-workflow",
    active: true,
    nodes: webhookPaths.map((path, i) => ({
      id: `node-${i}`,
      name: `Webhook ${i}`,
      type: "n8n-nodes-base.webhook",
      parameters: { path, httpMethod: "POST" },
    })),
  };
}

function makeDeployer(opts: {
  workflow: WorkflowDefinition;
  probeStatuses: number[]; // sequence of statuses to return from probe URLs (in order)
  partialUpdate?: ReturnType<typeof vi.fn>;
  setActive?: ReturnType<typeof vi.fn>;
}) {
  const partialUpdate = opts.partialUpdate ?? vi.fn(async () => ({ ok: true }));
  const getWorkflow = vi.fn(async () => opts.workflow);
  const setActive = opts.setActive ?? vi.fn(async () => undefined);

  const probeStatuses = [...opts.probeStatuses];
  const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const status = probeStatuses.shift() ?? 500;
    return new Response(null, { status });
  }) as unknown as typeof fetch;

  const deployer = new N8nWorkflowDeployer({
    baseUrl: "https://n8n-test.example.com",
    apiKey: "test-key",
    partialUpdate,
    getWorkflow,
    setActive,
    forceCycleDwellMs: 1, // tiny dwell — no real wait
    probeTimeoutMs: 100,
    sleepFn: vi.fn(async () => undefined),
    fetchFn,
  });

  return { deployer, partialUpdate, getWorkflow, setActive, fetchFn };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Wave 24 — N8nWorkflowDeployer.updatePartialWorkflow", () => {
  it("first probe 200 → no force-cycle, emits webhook_route_verified audit", async () => {
    const { deployer, partialUpdate, setActive } = makeDeployer({
      workflow: buildWorkflow(["my-hook"]),
      probeStatuses: [200],
    });

    const result = await deployer.updatePartialWorkflow("wf-test-123", { name: "renamed" });

    expect(partialUpdate).toHaveBeenCalledOnce();
    expect(partialUpdate).toHaveBeenCalledWith("wf-test-123", { name: "renamed" });
    expect(setActive).not.toHaveBeenCalled();
    expect(result.webhooksProbed).toBe(1);
    expect(result.webhooksRecycled).toBe(0);
    expect(result.webhooksFailed).toBe(0);

    expect(insertAuditRowSafe).toHaveBeenCalledOnce();
    const auditCall = vi.mocked(insertAuditRowSafe).mock.calls[0][0];
    expect(auditCall.action).toBe("n8n.webhook_route_verified");
    expect(auditCall.correlationId).toBe(result.correlationId);
    expect(notifyCritical).not.toHaveBeenCalled();
  });

  it("first probe 404 → force-cycle → second probe 200 → emits webhook_auto_reregistered audit", async () => {
    const { deployer, partialUpdate, setActive } = makeDeployer({
      workflow: buildWorkflow(["my-hook"]),
      probeStatuses: [404, 200],
    });

    const result = await deployer.updatePartialWorkflow("wf-test-123", {});

    expect(partialUpdate).toHaveBeenCalledOnce();
    expect(setActive).toHaveBeenCalledTimes(2);
    expect(setActive).toHaveBeenNthCalledWith(1, "wf-test-123", false);
    expect(setActive).toHaveBeenNthCalledWith(2, "wf-test-123", true);

    expect(result.webhooksProbed).toBe(1);
    expect(result.webhooksRecycled).toBe(1);
    expect(result.webhooksFailed).toBe(0);

    expect(insertAuditRowSafe).toHaveBeenCalledOnce();
    const auditCall = vi.mocked(insertAuditRowSafe).mock.calls[0][0];
    expect(auditCall.action).toBe("n8n.webhook_auto_reregistered");
    expect(auditCall.status).toBe("success");
    expect(notifyCritical).not.toHaveBeenCalled();
  });

  it("first probe 404 → force-cycle → still 404 → emits CRITICAL audit + Discord notify", async () => {
    const { deployer, setActive } = makeDeployer({
      workflow: buildWorkflow(["dead-hook"]),
      probeStatuses: [404, 404],
    });

    const result = await deployer.updatePartialWorkflow("wf-test-123", {});

    expect(setActive).toHaveBeenCalledTimes(2);
    expect(result.webhooksProbed).toBe(1);
    expect(result.webhooksRecycled).toBe(0);
    expect(result.webhooksFailed).toBe(1);

    expect(insertAuditRowSafe).toHaveBeenCalledOnce();
    const auditCall = vi.mocked(insertAuditRowSafe).mock.calls[0][0];
    expect(auditCall.action).toBe("n8n.webhook_auto_reregister_failed");
    expect(auditCall.status).toBe("failure");
    expect(auditCall.errorMessage).toContain("still_404_after_force_cycle");

    expect(notifyCritical).toHaveBeenCalledOnce();
    const notifyArgs = vi.mocked(notifyCritical).mock.calls[0];
    expect(notifyArgs[0]).toMatch(/auto-re-register FAILED/i);
    expect(notifyArgs[1]).toContain("dead-hook");
  });

  it("workflow without webhook nodes → no probes, no audit rows", async () => {
    const workflowNoWebhooks: WorkflowDefinition = {
      id: "wf-test-123",
      active: true,
      nodes: [
        { id: "n1", name: "Schedule", type: "n8n-nodes-base.scheduleTrigger" },
        { id: "n2", name: "HTTP", type: "n8n-nodes-base.httpRequest" },
      ],
    };
    const { deployer, setActive, fetchFn } = makeDeployer({
      workflow: workflowNoWebhooks,
      probeStatuses: [],
    });

    const result = await deployer.updatePartialWorkflow("wf-test-123", {});

    expect(setActive).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled(); // no probes issued
    expect(result.webhooksProbed).toBe(0);
    expect(insertAuditRowSafe).not.toHaveBeenCalled();
    expect(notifyCritical).not.toHaveBeenCalled();
  });

  it("multiple webhook nodes are each probed independently", async () => {
    const { deployer, setActive } = makeDeployer({
      workflow: buildWorkflow(["hook-a", "hook-b"]),
      // hook-a 200 (verified), hook-b 404 then 200 (recycled)
      probeStatuses: [200, 404, 200],
    });

    const result = await deployer.updatePartialWorkflow("wf-test-123", {});

    expect(result.webhooksProbed).toBe(2);
    expect(result.webhooksRecycled).toBe(1);
    expect(result.webhooksFailed).toBe(0);
    expect(setActive).toHaveBeenCalledTimes(2); // one force-cycle for hook-b
    expect(insertAuditRowSafe).toHaveBeenCalledTimes(2);
    const actions = vi
      .mocked(insertAuditRowSafe)
      .mock.calls.map((c) => c[0].action);
    expect(actions).toContain("n8n.webhook_route_verified");
    expect(actions).toContain("n8n.webhook_auto_reregistered");
  });

  it("webhook node missing parameters.path is skipped with error logged in result", async () => {
    const workflow: WorkflowDefinition = {
      id: "wf-test-123",
      active: true,
      nodes: [
        {
          id: "n1",
          name: "Broken Webhook",
          type: "n8n-nodes-base.webhook",
          parameters: {}, // no path
        },
      ],
    };
    const { deployer, fetchFn } = makeDeployer({ workflow, probeStatuses: [] });

    const result = await deployer.updatePartialWorkflow("wf-test-123", {});

    expect(result.webhooksProbed).toBe(0);
    expect(result.errors.some((e) => e.startsWith("webhook_no_path"))).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
