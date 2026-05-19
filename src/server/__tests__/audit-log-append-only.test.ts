/**
 * Tests for audit_log append-only enforcement (migration 0058).
 *
 * Two layers:
 *   1. Migration-text invariants — verify the migration file declares the
 *      trigger function, the BEFORE UPDATE OR DELETE trigger, and the
 *      recency index. Runs everywhere; no DB needed.
 *   2. Live DB enforcement — when DATABASE_URL is set, attempt an UPDATE on
 *      a freshly inserted audit_log row and assert the trigger raises
 *      `audit_log is append-only`. Skipped when DATABASE_URL is not set
 *      (e.g. in unit-test CI).
 *
 * The migration-text test ensures the constraint can never silently
 * regress in source even if the live test is skipped.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION_PATH = resolve(
  process.cwd(),
  "src/server/db/migrations/0058_audit_log_append_only.sql"
);

describe("Migration 0058: audit_log append-only", () => {
  it("migration file exists", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it("declares the prevent_audit_log_mutation function", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+prevent_audit_log_mutation/i
    );
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'audit_log is append-only'/i);
  });

  it("attaches a BEFORE UPDATE OR DELETE trigger on audit_log", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+audit_log_append_only_trigger/i);
    expect(sql).toMatch(/BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+audit_log/i);
    expect(sql).toMatch(/EXECUTE\s+FUNCTION\s+prevent_audit_log_mutation/i);
  });

  it("creates the created_at recency index", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_audit_log_created_at_desc/i
    );
    expect(sql).toMatch(/created_at\s+DESC/i);
  });

  it("provides a reversible DOWN migration", () => {
    const downPath = resolve(
      process.cwd(),
      "src/server/db/migrations/0058_audit_log_append_only.down.sql"
    );
    expect(existsSync(downPath)).toBe(true);
    const sql = readFileSync(downPath, "utf8");
    expect(sql).toMatch(/DROP\s+TRIGGER.*audit_log_append_only_trigger/i);
    expect(sql).toMatch(/DROP\s+FUNCTION.*prevent_audit_log_mutation/i);
    expect(sql).toMatch(/DROP\s+INDEX.*idx_audit_log_created_at_desc/i);
  });

  it("registered in drizzle journal", () => {
    const journalPath = resolve(
      process.cwd(),
      "src/server/db/migrations/meta/_journal.json"
    );
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const tags: string[] = journal.entries.map((e: { tag: string }) => e.tag);
    expect(tags).toContain("0058_audit_log_append_only");
  });
});

// ─── Live DB enforcement (only when DATABASE_URL is set) ────────────────────
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)(
  "audit_log append-only — live DB",
  () => {
    it("UPDATE on audit_log row raises 'audit_log is append-only'", async () => {
      const { db, client } = await import("../db/index.js");
      const { auditLog } = await import("../db/schema.js");
      const { sql, eq } = await import("drizzle-orm");

      // Insert a fresh row we own
      const inserted = await db
        .insert(auditLog)
        .values({
          action: "test.append_only_guard",
          status: "success",
          input: { probe: true },
          result: { probe: true },
        })
        .returning({ id: auditLog.id });

      const rowId = inserted[0]?.id;
      expect(rowId).toBeTruthy();

      // Attempt UPDATE — must throw
      let threw = false;
      let errMsg = "";
      try {
        await db
          .update(auditLog)
          .set({ status: "tampered" })
          .where(eq(auditLog.id, rowId!));
      } catch (e: unknown) {
        threw = true;
        errMsg = e instanceof Error ? e.message : String(e);
      }
      expect(threw).toBe(true);
      expect(errMsg).toMatch(/audit_log is append-only/i);

      // Attempt DELETE — must also throw
      let delThrew = false;
      let delMsg = "";
      try {
        await db.delete(auditLog).where(eq(auditLog.id, rowId!));
      } catch (e: unknown) {
        delThrew = true;
        delMsg = e instanceof Error ? e.message : String(e);
      }
      expect(delThrew).toBe(true);
      expect(delMsg).toMatch(/audit_log is append-only/i);

      // Best-effort cleanup is impossible (DELETE blocked) — leave the row.
      // It's a single test marker row tagged action='test.append_only_guard'.

      // Close pool so vitest doesn't hang
      await client.end({ timeout: 1 }).catch(() => undefined);
      // Suppress sql-helper unused-import warning at runtime
      void sql;
    });
  }
);
