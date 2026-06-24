/**
 * n8n-workflow-deployer.ts — Wave 24 Pass 1 (Item 13).
 *
 * Wraps n8n partial-update calls (REST PATCH or n8n MCP `n8n_update_partial_workflow`)
 * with mandatory webhook route-verification + force-cycle remediation.
 *
 * WHY THIS EXISTS:
 *   n8n 2.10.3 has a known bug: webhook nodes added to an existing workflow via
 *   the partial-update API path don't auto-register their HTTP routes. The
 *   workflow is "updated" successfully and the editor shows the node, but the
 *   public `/webhook/<path>` URL returns 404 until an operator manually toggles
 *   Active OFF → ON in the n8n UI. During a 14-day operator vacation, any
 *   auto-deployed workflow change that adds/renames a webhook node = silent
 *   route 404, every downstream caller broken, no signal to operator.
 *   Pinned in CLAUDE.md §2b "Webhook nodes added via n8n MCP partial-update
 *   API don't auto-register routes".
 *
 * BEHAVIOR:
 *   1. Apply the partial update (caller-supplied function — works with REST PATCH
 *      or with an MCP-tool callback).
 *   2. Fetch the resulting workflow definition; enumerate webhook nodes
 *      (type === "n8n-nodes-base.webhook").
 *   3. For each webhook node, probe its public URL with HEAD/GET.
 *   4. If probe returns 404, force-cycle the workflow (active=false, sleep 2s,
 *      active=true) and re-probe.
 *   5. If still 404, emit CRITICAL audit row + Discord notification.
 *   6. Otherwise, emit one audit row per webhook: either `webhook_route_verified`
 *      (no remediation) or `webhook_auto_reregistered` (force-cycle succeeded).
 *
 * SCOPE:
 *   This is a wrapper for the partial-update path only. Full-create workflows
 *   register routes correctly; full-update (`n8n_update_full_workflow`) is also
 *   known-safe. The bug is partial-update-specific. Use this wrapper any time a
 *   programmatic partial-update touches a workflow that contains webhook nodes.
 */

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { logger } from "../lib/logger.js";
import { notifyCritical } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";

/** Caller-supplied function that performs the underlying partial update. */
export type PartialUpdateFn = (
  workflowId: string,
  partialUpdate: Record<string, unknown>,
) => Promise<unknown>;

/** Caller-supplied function that fetches the current workflow definition. */
export type GetWorkflowFn = (workflowId: string) => Promise<WorkflowDefinition>;

/** Caller-supplied function to flip workflow active state via REST. */
export type SetActiveFn = (workflowId: string, active: boolean) => Promise<void>;

/** Minimal n8n workflow shape we need (subset of full n8n schema). */
export interface WorkflowDefinition {
  id: string;
  name?: string;
  active?: boolean;
  nodes: WorkflowNode[];
}

export interface WorkflowNode {
  id?: string;
  name: string;
  type: string;
  parameters?: {
    path?: string;
    httpMethod?: string;
    [k: string]: unknown;
  };
  webhookId?: string;
}

export interface DeployerOptions {
  /** n8n base URL — falls back to env N8N_BASE_URL. */
  baseUrl?: string;
  /** n8n API key — falls back to env TF_N8N_API_KEY / RAILWAY_N8N_API_KEY. */
  apiKey?: string;
  /** Default partial-update function. Required if not passed per-call. */
  partialUpdate?: PartialUpdateFn;
  /** Default get-workflow function. Required if not passed per-call. */
  getWorkflow?: GetWorkflowFn;
  /** Default set-active function. Required if not passed per-call. */
  setActive?: SetActiveFn;
  /** Probe HTTP timeout (default 5000ms). */
  probeTimeoutMs?: number;
  /** Force-cycle dwell between OFF and ON (default 2000ms). */
  forceCycleDwellMs?: number;
  /** Override sleep for tests. */
  sleepFn?: (ms: number) => Promise<void>;
  /** Override fetch for tests. */
  fetchFn?: typeof fetch;
}

export interface DeployResult {
  correlationId: string;
  workflowId: string;
  webhooksProbed: number;
  webhooksRecycled: number;
  webhooksFailed: number;
  errors: string[];
}

const DEFAULT_PROBE_TIMEOUT_MS = 5000;
const DEFAULT_FORCE_CYCLE_DWELL_MS = 2000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class N8nWorkflowDeployer {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly partialUpdate: PartialUpdateFn;
  private readonly getWorkflow: GetWorkflowFn;
  private readonly setActive: SetActiveFn;
  private readonly probeTimeoutMs: number;
  private readonly forceCycleDwellMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly fetchFn: typeof fetch;

  constructor(opts: DeployerOptions = {}) {
    const baseUrl = opts.baseUrl ?? process.env.N8N_BASE_URL;
    const apiKey =
      opts.apiKey ?? process.env.TF_N8N_API_KEY ?? process.env.RAILWAY_N8N_API_KEY;
    if (!baseUrl) throw new Error("N8nWorkflowDeployer: baseUrl (or N8N_BASE_URL) required");
    if (!apiKey) throw new Error("N8nWorkflowDeployer: apiKey (or TF_N8N_API_KEY) required");
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.probeTimeoutMs = opts.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.forceCycleDwellMs = opts.forceCycleDwellMs ?? DEFAULT_FORCE_CYCLE_DWELL_MS;
    this.sleepFn = opts.sleepFn ?? sleep;
    this.fetchFn = opts.fetchFn ?? fetch;

    this.partialUpdate = opts.partialUpdate ?? this.defaultPartialUpdate.bind(this);
    this.getWorkflow = opts.getWorkflow ?? this.defaultGetWorkflow.bind(this);
    this.setActive = opts.setActive ?? this.defaultSetActive.bind(this);
  }

  /**
   * Apply a partial update and verify that every webhook node still has a live
   * route. Force-cycle the workflow if any webhook returns 404; alert if the
   * force-cycle did not fix it.
   */
  async updatePartialWorkflow(
    workflowId: string,
    partialUpdate: Record<string, unknown>,
    correlationIdIn?: string,
  ): Promise<DeployResult> {
    const correlationId = correlationIdIn ?? randomUUID();
    const result: DeployResult = {
      correlationId,
      workflowId,
      webhooksProbed: 0,
      webhooksRecycled: 0,
      webhooksFailed: 0,
      errors: [],
    };

    // 1) Apply the partial update.
    try {
      await this.partialUpdate(workflowId, partialUpdate);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`partial_update_failed: ${msg}`);
      logger.error({ correlationId, workflowId, err }, "n8n-deployer: partial update failed");
      throw err;
    }

    // 2) Fetch resulting workflow definition; enumerate webhook nodes.
    let workflow: WorkflowDefinition;
    try {
      workflow = await this.getWorkflow(workflowId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`get_workflow_failed: ${msg}`);
      logger.error({ correlationId, workflowId, err }, "n8n-deployer: get workflow failed");
      throw err;
    }

    const webhookNodes = (workflow.nodes ?? []).filter(
      (n) => n.type === "n8n-nodes-base.webhook",
    );

    if (webhookNodes.length === 0) {
      logger.debug(
        { correlationId, workflowId },
        "n8n-deployer: no webhook nodes; skipping route verification",
      );
      return result;
    }

    // 3) For each webhook, probe + remediate as needed.
    for (const node of webhookNodes) {
      const path = node.parameters?.path;
      if (typeof path !== "string" || path.length === 0) {
        result.errors.push(`webhook_no_path: ${node.name}`);
        logger.warn(
          { correlationId, workflowId, nodeName: node.name },
          "n8n-deployer: webhook node missing parameters.path — cannot probe",
        );
        continue;
      }

      result.webhooksProbed += 1;
      const probeUrl = `${this.baseUrl}/webhook/${path.replace(/^\/+/, "")}`;

      const firstStatus = await this.probeWebhook(probeUrl);

      if (firstStatus !== 404) {
        // Route already live — log verification only.
        await this.writeAudit({
          correlationId,
          workflowId,
          action: "n8n.webhook_route_verified",
          metadata: {
            webhookPath: path,
            nodeName: node.name,
            probeStatus: firstStatus,
            probeUrl,
          },
        });
        continue;
      }

      // 4) First probe 404 — force-cycle.
      logger.warn(
        { correlationId, workflowId, probeUrl, nodeName: node.name },
        "n8n-deployer: webhook returned 404 after partial update — force-cycling workflow",
      );
      try {
        await this.setActive(workflowId, false);
        await this.sleepFn(this.forceCycleDwellMs);
        await this.setActive(workflowId, true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`force_cycle_failed: ${msg}`);
        result.webhooksFailed += 1;
        await this.emitCritical({
          correlationId,
          workflowId,
          path,
          nodeName: node.name,
          probeUrl,
          reason: `force_cycle_failed: ${msg}`,
        });
        continue;
      }

      const secondStatus = await this.probeWebhook(probeUrl);

      if (secondStatus === 404) {
        result.webhooksFailed += 1;
        await this.emitCritical({
          correlationId,
          workflowId,
          path,
          nodeName: node.name,
          probeUrl,
          reason: `still_404_after_force_cycle (status=${secondStatus})`,
        });
        continue;
      }

      // Force-cycle succeeded.
      result.webhooksRecycled += 1;
      await this.writeAudit({
        correlationId,
        workflowId,
        action: "n8n.webhook_auto_reregistered",
        metadata: {
          webhookPath: path,
          nodeName: node.name,
          firstProbeStatus: 404,
          secondProbeStatus: secondStatus,
          probeUrl,
        },
      });
    }

    return result;
  }

  // ── Defaults ───────────────────────────────────────────────────────

  private async defaultPartialUpdate(
    workflowId: string,
    partialUpdate: Record<string, unknown>,
  ): Promise<unknown> {
    const res = await this.fetchFn(`${this.baseUrl}/api/v1/workflows/${workflowId}`, {
      method: "PATCH",
      headers: {
        "X-N8N-API-KEY": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(partialUpdate),
      signal: AbortSignal.timeout(this.probeTimeoutMs * 2),
    });
    if (!res.ok) {
      throw new Error(`n8n PATCH /workflows/${workflowId} HTTP ${res.status}`);
    }
    return await res.json();
  }

  private async defaultGetWorkflow(workflowId: string): Promise<WorkflowDefinition> {
    const res = await this.fetchFn(`${this.baseUrl}/api/v1/workflows/${workflowId}`, {
      method: "GET",
      headers: { "X-N8N-API-KEY": this.apiKey },
      signal: AbortSignal.timeout(this.probeTimeoutMs * 2),
    });
    if (!res.ok) throw new Error(`n8n GET /workflows/${workflowId} HTTP ${res.status}`);
    return (await res.json()) as WorkflowDefinition;
  }

  private async defaultSetActive(workflowId: string, active: boolean): Promise<void> {
    const path = active ? "activate" : "deactivate";
    const res = await this.fetchFn(
      `${this.baseUrl}/api/v1/workflows/${workflowId}/${path}`,
      {
        method: "POST",
        headers: { "X-N8N-API-KEY": this.apiKey },
        signal: AbortSignal.timeout(this.probeTimeoutMs * 2),
      },
    );
    if (!res.ok) throw new Error(`n8n POST /workflows/${workflowId}/${path} HTTP ${res.status}`);
  }

  private async probeWebhook(url: string): Promise<number> {
    try {
      const res = await this.fetchFn(url, {
        method: "GET",
        signal: AbortSignal.timeout(this.probeTimeoutMs),
      });
      return res.status;
    } catch (err) {
      // Network error counted as failure but not 404 — we cannot say the route
      // is missing, only that it's unreachable. Treat as non-404 to avoid
      // false-positive remediation.
      logger.warn({ err, url }, "n8n-deployer: webhook probe network error");
      return 0;
    }
  }

  private async writeAudit(opts: {
    correlationId: string;
    workflowId: string;
    action: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await insertAuditRowSafe({
      action: opts.action,
      entityType: "n8n_workflow",
      entityId: null, // n8n workflow IDs are not UUIDs; carry via result.workflowId
      correlationId: opts.correlationId,
      status: "success",
      decisionAuthority: "n8n",
      result: { workflowId: opts.workflowId, ...opts.metadata },
    });
  }

  private async emitCritical(opts: {
    correlationId: string;
    workflowId: string;
    path: string;
    nodeName: string;
    probeUrl: string;
    reason: string;
  }): Promise<void> {
    logger.error(
      {
        correlationId: opts.correlationId,
        workflowId: opts.workflowId,
        probeUrl: opts.probeUrl,
        reason: opts.reason,
      },
      "n8n-deployer: webhook auto-re-register FAILED",
    );
    await insertAuditRowSafe({
      action: "n8n.webhook_auto_reregister_failed",
      entityType: "n8n_workflow",
      entityId: null,
      correlationId: opts.correlationId,
      status: "failure",
      decisionAuthority: "n8n",
      errorMessage: opts.reason,
      result: {
        workflowId: opts.workflowId,
        webhookPath: opts.path,
        nodeName: opts.nodeName,
        probeUrl: opts.probeUrl,
        reason: opts.reason,
      },
    });
    notifyCritical(
      "n8n webhook auto-re-register FAILED",
      appendFamilyGradePostscript(
        `Workflow ${opts.workflowId} webhook "${opts.path}" did not come back online after force-cycle. Operator must manually toggle Active OFF/ON in n8n UI. Reason: ${opts.reason}`,
        "The bot's workflow automation failed to deploy.",
        "No action needed — the bot will retry. Call Tony if automation stays broken for more than an hour.",
      ),
      {
        correlationId: opts.correlationId,
        workflowId: opts.workflowId,
        webhookPath: opts.path,
        probeUrl: opts.probeUrl,
      },
    );
  }
}

/**
 * Singleton convenience accessor. Most call sites should `new N8nWorkflowDeployer()`
 * directly (so tests can inject mocks), but for one-shot operational scripts
 * this helper avoids boilerplate.
 */
let _singleton: N8nWorkflowDeployer | null = null;
export function getN8nWorkflowDeployer(): N8nWorkflowDeployer {
  if (_singleton == null) _singleton = new N8nWorkflowDeployer();
  return _singleton;
}

/** Test-only: reset singleton. */
export function _resetN8nWorkflowDeployerForTests(): void {
  _singleton = null;
}

// Suppress unused-import warning for sql (kept for future query helpers).
void sql;
