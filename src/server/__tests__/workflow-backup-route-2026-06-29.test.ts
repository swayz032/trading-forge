/**
 * workflow-backup-route-2026-06-29.test.ts — Deep-scan #4 backend-DR
 *
 * Tests POST /api/admin/workflow-backup handler directly (repo's supertest-free pattern).
 * Mocks ../db/index.js to control the dedup "latest backup" lookup and capture inserts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted control state for the db mock.
const state = vi.hoisted(() => ({
  latest: [] as Array<{ id: string; contentHash: string }>,
  inserted: [] as Array<Record<string, unknown>>,
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../db/index.js", () => {
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: () => Promise.resolve(state.latest),
  };
  return {
    db: {
      select: () => selectChain,
      insert: (_table: unknown) => ({
        values: (vals: Record<string, unknown>) => {
          state.inserted.push(vals);
          // workflow_backups insert uses .returning(); auditLog insert uses .catch().
          const chain: any = {
            returning: () => Promise.resolve([{ id: "bk-test-001" }]),
            catch: (_fn: (e: unknown) => void) => Promise.resolve(),
          };
          return chain;
        },
      }),
    },
  };
});

vi.mock("../db/schema.js", () => ({
  workflowBackups: { id: "id", contentHash: "content_hash", workflowId: "workflow_id", createdAt: "created_at" },
  auditLog: {},
}));

const { handleWorkflowBackup } = await import("../routes/admin-workflow-backup.js");

function mockRes() {
  const res: any = {
    statusCode: 0,
    body: null,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; return this; },
  };
  return res;
}

function mockReq(body: unknown, headers: Record<string, string> = {}) {
  return { body, header: (n: string) => headers[n] };
}

describe("POST /api/admin/workflow-backup", () => {
  beforeEach(() => {
    state.latest = [];
    state.inserted = [];
    delete process.env.WORKFLOW_BACKUP_SECRET;
  });

  it("400 when workflow id is missing", async () => {
    const res = mockRes();
    await handleWorkflowBackup(mockReq({ name: "no-id" }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("missing_workflow_id");
  });

  it("201 persists a new workflow backup with content hash + node count", async () => {
    const res = mockRes();
    await handleWorkflowBackup(
      mockReq({ id: "wf-1", name: "14A", active: true, nodes: [{ a: 1 }, { b: 2 }] }),
      res,
    );
    expect(res.statusCode).toBe(201);
    expect(res.body.persisted).toBe(true);
    expect(res.body.backupId).toBe("bk-test-001");
    expect(typeof res.body.contentHash).toBe("string");
    // workflow_backups insert captured with full json + node count.
    const wfInsert = state.inserted.find((v) => v.workflowId === "wf-1");
    expect(wfInsert).toBeDefined();
    expect(wfInsert!.nodeCount).toBe(2);
    expect(wfInsert!.fullJson).toBeDefined();
  });

  it("200 unchanged (skip-insert) when latest backup hash matches", async () => {
    // First compute the hash the handler would produce by running once.
    const probe = mockRes();
    await handleWorkflowBackup(mockReq({ id: "wf-2", name: "x", nodes: [] }), probe);
    const hash = probe.body.contentHash as string;
    // Now seed that hash as the latest backup and re-submit the identical body.
    state.latest = [{ id: "prev-row", contentHash: hash }];
    state.inserted = [];
    const res = mockRes();
    await handleWorkflowBackup(mockReq({ id: "wf-2", name: "x", nodes: [] }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.persisted).toBe(false);
    expect(res.body.unchanged).toBe(true);
    expect(res.body.backupId).toBe("prev-row");
    // No new workflow_backups row inserted (only possible audit, which this body has none of).
    expect(state.inserted.find((v) => v.workflowId === "wf-2")).toBeUndefined();
  });

  it("401 when WORKFLOW_BACKUP_SECRET set and header missing/wrong", async () => {
    process.env.WORKFLOW_BACKUP_SECRET = "s3cr3t";
    const res = mockRes();
    await handleWorkflowBackup(mockReq({ id: "wf-3" }, { "X-Workflow-Backup-Secret": "wrong" }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("invalid_workflow_backup_secret");
  });

  it("201 when WORKFLOW_BACKUP_SECRET set and header matches", async () => {
    process.env.WORKFLOW_BACKUP_SECRET = "s3cr3t";
    const res = mockRes();
    await handleWorkflowBackup(mockReq({ id: "wf-4", nodes: [] }, { "X-Workflow-Backup-Secret": "s3cr3t" }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body.persisted).toBe(true);
  });
});
