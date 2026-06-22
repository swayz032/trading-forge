/**
 * Wave hardening 2026-06-22: agent-job lifecycle uses agent_jobs (mutable),
 * not audit_log (append-only).
 *
 * Tests:
 *   1. Static assert: agent.ts contains NO db.update(auditLog) or
 *      db.delete(auditLog) — the append-only trigger would throw.
 *   2. Static assert: agent.ts imports agentJobs from schema.
 *   3. Static assert: agent.ts uses db.update(agentJobs) and
 *      db.delete(agentJobs) for job-lifecycle mutations.
 *   4. Migration 0166_agent_jobs.sql exists and is idempotent (CREATE IF NOT EXISTS).
 *   5. Migration is in the drizzle journal.
 *   6. schema.ts exports agentJobs table.
 *
 * These are file-content invariants — no DB required, run everywhere.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const AGENT_TS_PATH = resolve(process.cwd(), "src/server/routes/agent.ts");
const SCHEMA_TS_PATH = resolve(process.cwd(), "src/server/db/schema.ts");
const MIGRATION_PATH = resolve(
  process.cwd(),
  "src/server/db/migrations/0166_agent_jobs.sql"
);
const JOURNAL_PATH = resolve(
  process.cwd(),
  "src/server/db/migrations/meta/_journal.json"
);

const agentTs = readFileSync(AGENT_TS_PATH, "utf8");
const schemaTs = readFileSync(SCHEMA_TS_PATH, "utf8");

describe("Wave hardening 2026-06-22: agent_jobs replaces audit_log as mutable job-state store", () => {

  // ── 1. No UPDATE on audit_log ────────────────────────────────────────────
  it("agent.ts has NO db.update(auditLog) calls", () => {
    // The migration-0058 trigger raises 'audit_log is append-only' on UPDATE.
    expect(agentTs).not.toMatch(/db\.update\s*\(\s*auditLog\s*\)/);
  });

  // ── 2. No DELETE on audit_log ────────────────────────────────────────────
  it("agent.ts has NO db.delete(auditLog) calls", () => {
    // The migration-0058 trigger raises 'audit_log is append-only' on DELETE.
    expect(agentTs).not.toMatch(/db\.delete\s*\(\s*auditLog\s*\)/);
  });

  // ── 3. agentJobs is imported ─────────────────────────────────────────────
  it("agent.ts imports agentJobs from schema", () => {
    expect(agentTs).toMatch(/agentJobs/);
    expect(agentTs).toMatch(/from ["']\.\.\/db\/schema\.js["']/);
  });

  // ── 4. Job lifecycle uses agentJobs ──────────────────────────────────────
  it("agent.ts uses db.update(agentJobs) for job completion", () => {
    expect(agentTs).toMatch(/db\.update\s*\(\s*agentJobs\s*\)/);
  });

  it("agent.ts uses db.delete(agentJobs) for job purge", () => {
    expect(agentTs).toMatch(/db\.delete\s*\(\s*agentJobs\s*\)/);
  });

  // ── 5. audit_log still gets immutable submission events ──────────────────
  it("agent.ts still inserts into auditLog for immutable event rows", () => {
    // audit_log is the immutable event record; agent_jobs is the mutable
    // job-state store. Both must exist — audit_log for the audit trail,
    // agent_jobs for queryable terminal status.
    expect(agentTs).toMatch(/db\.insert\s*\(\s*auditLog\s*\)/);
  });

  it("agent.ts inserts into agentJobs for mutable job state", () => {
    expect(agentTs).toMatch(/db\.insert\s*\(\s*agentJobs\s*\)/);
  });

  // ── 6. Migration file exists and is idempotent ───────────────────────────
  it("migration 0166_agent_jobs.sql exists", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it("migration uses CREATE TABLE IF NOT EXISTS (idempotent)", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+agent_jobs/i);
  });

  it("migration declares all required columns", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(/\bid\b.*UUID/i);
    expect(sql).toMatch(/\baction\b.*TEXT/i);
    expect(sql).toMatch(/\bstatus\b.*TEXT/i);
    expect(sql).toMatch(/\binput\b.*JSONB/i);
    expect(sql).toMatch(/\bresult\b.*JSONB/i);
    expect(sql).toMatch(/\berror_message\b/i);
    expect(sql).toMatch(/\bcorrelation_id\b/i);
    expect(sql).toMatch(/\bcreated_at\b.*TIMESTAMPTZ/i);
    expect(sql).toMatch(/\bupdated_at\b.*TIMESTAMPTZ/i);
  });

  it("migration uses CREATE INDEX IF NOT EXISTS (idempotent indexes)", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    const matches = sql.match(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/gi);
    // Expect at least 3 indexes (action, status, created_at DESC)
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  // ── 7. Journal entry ─────────────────────────────────────────────────────
  it("migration 0166_agent_jobs is registered in drizzle journal", () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));
    const tags: string[] = journal.entries.map((e: { tag: string }) => e.tag);
    expect(tags).toContain("0166_agent_jobs");
  });

  // ── 8. schema.ts declares agentJobs ─────────────────────────────────────
  it("schema.ts exports agentJobs table", () => {
    expect(schemaTs).toMatch(/export\s+const\s+agentJobs\s*=/);
  });

  it("schema.ts exports AgentJob type", () => {
    expect(schemaTs).toMatch(/export\s+type\s+AgentJob\s*=/);
  });

  it("schema.ts agentJobs table has expected columns", () => {
    // Verify key columns declared in the schema definition
    const block = schemaTs.slice(schemaTs.indexOf("agentJobs"));
    expect(block).toMatch(/action/);
    expect(block).toMatch(/strategyId/);
    expect(block).toMatch(/status/);
    expect(block).toMatch(/input/);
    expect(block).toMatch(/result/);
    expect(block).toMatch(/errorMessage/);
    expect(block).toMatch(/correlationId/);
    expect(block).toMatch(/createdAt/);
    expect(block).toMatch(/updatedAt/);
  });
});
