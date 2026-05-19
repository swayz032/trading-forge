/**
 * Wave 12 — Graduator silent INSERT-failure regression test
 *
 * Guards the fix for the production bug where `runGraduation()` in agent.ts:
 *   1. Called `graduateBucketDirectly()` — INSERT failed silently
 *   2. Unconditionally set bucket.status = 'graduated' (with null strategy id)
 *   3. Unconditionally fired `strategy.cross_validated` with status='success'
 *
 * Result: 6 leaked buckets per 24h cycle with graduated_strategy_id=NULL and
 * no corresponding strategy row in the `strategies` table.
 *
 * Test structure:
 *   Suite A (static guards) — read source files, pin the conditional paths
 *   Suite B (behavioral) — test the DirectGraduationResult.insertFailed contract
 *     via source-code inspection of the catch block (avoid brittle DB mock chains)
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readSrc(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relPath), "utf8");
}

// ─── Suite A: agent.ts caller contract (static guard) ────────────────────────
// These tests guard that the Wave 12 fix is present in source — they do NOT
// test runtime behavior so they don't need DB mocks. They are immune to module
// caching and mock chain complexity.

describe("Wave 12 — agent.ts caller contract (static guard)", () => {
  const src = readSrc("../routes/agent.ts");

  it("DirectGraduationResult interface includes insertFailed field in graduator", () => {
    const graduatorSrc = readSrc("../services/direct-bucket-graduator.ts");
    expect(graduatorSrc).toContain("insertFailed?: boolean");
  });

  it("bucket.status=graduated only inside if (graduatedStrategyId !== null) branch", () => {
    // Must find the pattern: if (graduatedStrategyId !== null) { ... status: 'graduated' }
    const successBranchMatch = src.match(
      /if\s*\(\s*graduatedStrategyId\s*!==\s*null\s*\)[\s\S]*?status:\s*["']graduated["']/
    );
    expect(
      successBranchMatch,
      "bucket.status=graduated must only appear inside if (graduatedStrategyId !== null)"
    ).toBeTruthy();
  });

  it("insertFailed branch reverts bucket to pending", () => {
    // grad.insertFailed block must set status='pending'
    const revertMatch = src.match(
      /grad\.insertFailed[\s\S]*?status:\s*["']pending["']/
    );
    expect(
      revertMatch,
      "insertFailed branch must revert bucket to status=pending"
    ).toBeTruthy();
  });

  it("insertFailed branch fires strategy.cross_validated audit with status=failure", () => {
    const insertFailedAudit = src.match(
      /grad\.insertFailed[\s\S]*?status:\s*["']failure["']/
    );
    expect(
      insertFailedAudit,
      "insertFailed branch must fire strategy.cross_validated audit with status=failure"
    ).toBeTruthy();
  });

  it("gate rejection path fires strategy.cross_validated audit with status=rejected", () => {
    const rejectedAudit = src.match(
      /graduation: gate rejected[\s\S]*?status:\s*["']rejected["']/
    );
    expect(
      rejectedAudit,
      "Gate rejection else-branch must fire audit with status=rejected"
    ).toBeTruthy();
  });

  it("gate rejection path reverts bucket to pending", () => {
    const gateRevertMatch = src.match(
      /graduation: gate rejected[\s\S]*?status:\s*["']pending["']/
    );
    expect(
      gateRevertMatch,
      "Gate rejection path must revert bucket to status=pending"
    ).toBeTruthy();
  });

  it("early-return exists for insertFailed path before SSE/Discord broadcast", () => {
    // The insertFailed path must `return;` before reaching SSE broadcast so the
    // factory does not fire graduation events on failed INSERTs.
    const insertFailedComment = src.indexOf("Return early — do not fire SSE graduation event");
    expect(
      insertFailedComment,
      "insertFailed path must have an early-return comment before SSE broadcast"
    ).toBeGreaterThan(-1);
    // Verify return; follows within 100 chars of the comment
    const snippet = src.slice(insertFailedComment, insertFailedComment + 100);
    expect(snippet).toMatch(/return;/);
  });
});

// ─── Suite B: direct-bucket-graduator.ts catch-block contract (static guard) ─
// Pins the exact shape of the catch block added by Wave 12:
//   - Sets insertFailed: true on the returned object
//   - Writes a DLQ row
//   - Writes a failure audit row
//   - Does NOT silently swallow the error

describe("Wave 12 — graduateBucketDirectly() catch-block contract (static guard)", () => {
  const src = readSrc("../services/direct-bucket-graduator.ts");

  it("catch block sets insertFailed: true on returned object", () => {
    expect(src).toContain("insertFailed: true");
  });

  it("catch block sets reason to insert_failed: <message>", () => {
    // The returned reason must start with `insert_failed:`
    const reasonMatch = src.match(/insertFailed:\s*true[\s\S]*?reason:\s*`insert_failed:/);
    expect(reasonMatch, "catch block must set reason starting with 'insert_failed:'").toBeTruthy();
  });

  it("catch block writes to deadLetterQueue", () => {
    // DLQ write must appear in the catch block
    const dlqMatch = src.match(/catch\s*\(err\)[\s\S]*?deadLetterQueue/);
    expect(dlqMatch, "catch block must write to deadLetterQueue").toBeTruthy();
  });

  it("catch block writes graduation.rejected_insert_failed audit row", () => {
    const auditMatch = src.match(
      /catch\s*\(err\)[\s\S]*?graduation\.rejected_insert_failed/
    );
    expect(
      auditMatch,
      "catch block must write graduation.rejected_insert_failed audit"
    ).toBeTruthy();
  });

  it("catch block writes graduation.rejected_constraint_collision for UNIQUE violations", () => {
    const collisionMatch = src.match(
      /isConstraintCollision[\s\S]*?graduation\.rejected_constraint_collision/
    );
    expect(
      collisionMatch,
      "catch block must distinguish constraint collisions from generic INSERT failures"
    ).toBeTruthy();
  });

  it("deadLetterQueue is imported in direct-bucket-graduator.ts", () => {
    expect(src).toContain("deadLetterQueue");
    // Must be imported from schema, not just referenced as a string
    const importLine = src.match(/import.*deadLetterQueue.*from.*schema/);
    expect(importLine, "deadLetterQueue must be imported from schema").toBeTruthy();
  });

  it("original silent catch is replaced (no bare log+return pattern without insertFailed)", () => {
    // The OLD bug pattern was: catch { logger.error(...); return { strategyId: null, skipped: true } }
    // The new pattern must include insertFailed: true. Verify the old pattern is gone.
    const oldPattern = src.match(
      /catch\s*\(err\)[\s\S]{0,300}return\s*\{\s*strategyId:\s*null[\s\S]{0,100}skipped:\s*true(?![\s\S]*insertFailed)/
    );
    expect(
      oldPattern,
      "old silent-swallow catch pattern (no insertFailed) must not exist"
    ).toBeNull();
  });
});

// ─── Suite C: Integration shape — DirectGraduationResult type ────────────────

describe("Wave 12 — DirectGraduationResult interface shape", () => {
  it("interface has all required Wave 12 fields", () => {
    const src = readSrc("../services/direct-bucket-graduator.ts");
    expect(src).toContain("strategyId: string | null");
    expect(src).toContain("strategyName: string");
    expect(src).toContain("skipped?: boolean");
    expect(src).toContain("insertFailed?: boolean");
    expect(src).toContain("reason?: string");
  });

  it("exported function signature includes all required opts", () => {
    const src = readSrc("../services/direct-bucket-graduator.ts");
    expect(src).toContain("export async function graduateBucketDirectly");
    expect(src).toContain("bucketId:");
    expect(src).toContain("bestMention:");
    expect(src).toContain("bucketMeta:");
  });
});
