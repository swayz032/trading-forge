/**
 * Wave 25 Pass 2 — A-3: Family-grade alert postscript tests.
 *
 * Verifies:
 * 1. appendFamilyGradePostscript helper appends both 'What this means' and 'What to do' blocks.
 * 2. Dead-man's heartbeat CONFIRMED (48h) alert includes the family postscript.
 * 3. Dead-man's heartbeat PENDING (24h) alert includes the family postscript.
 * 4. BW refresh failure alert includes the family postscript.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Test 1: helper unit test ─────────────────────────────────────────────────

describe("Wave 25 Pass 2 A-3 — appendFamilyGradePostscript helper", () => {
  it("appends 'What this means' and 'What to do' blocks to operator body", async () => {
    const { appendFamilyGradePostscript } = await import("../lib/notification-helpers.js");

    const operatorBody = "Technical operator alert body.";
    const plainWhat = "The bot stopped trading.";
    const plainAction = "Wait 15 minutes. If still stopped, call Tony.";

    const result = appendFamilyGradePostscript(operatorBody, plainWhat, plainAction);

    expect(result).toContain(operatorBody);
    expect(result).toContain("--- For family members ---");
    expect(result).toContain("What this means:");
    expect(result).toContain("The bot stopped trading.");
    expect(result).toContain("What to do:");
    expect(result).toContain("Wait 15 minutes. If still stopped, call Tony.");

    // Family section must come AFTER the operator body
    expect(result.indexOf(operatorBody)).toBeLessThan(result.indexOf("--- For family members ---"));
  });

  it("operator body is returned unchanged when empty string", async () => {
    const { appendFamilyGradePostscript } = await import("../lib/notification-helpers.js");

    const result = appendFamilyGradePostscript("", "Something happened.", "Call Tony.");
    expect(result).toContain("--- For family members ---");
    expect(result.startsWith("\n\n---")).toBe(true);
  });

  it("separator line is exactly '--- For family members ---'", async () => {
    const { appendFamilyGradePostscript } = await import("../lib/notification-helpers.js");

    const result = appendFamilyGradePostscript("body", "what", "action");
    expect(result).toContain("--- For family members ---");
  });
});

// ─── Tests 2–4: site-level source verification ────────────────────────────────
//
// We verify the call sites by reading the service source files. This is the
// most direct way to confirm the postscript is wired at the correct locations
// without needing to mock the full database/notification stack.

describe("Wave 25 Pass 2 A-3 — call site verification (source-level)", () => {
  it("dead-mans-heartbeat CONFIRMED alert (48h) includes appendFamilyGradePostscript with family copy", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "src/server/services/dead-mans-heartbeat-service.ts"),
      "utf-8",
    );

    // appendFamilyGradePostscript must be imported
    expect(src).toContain("appendFamilyGradePostscript");
    expect(src).toContain("notification-helpers");

    // The CONFIRMED (48h) postscript must have family-grade copy
    const CONFIRMED_WHAT = "The bot detected the operator has been offline for 48 hours";
    expect(src).toContain(CONFIRMED_WHAT);

    const CONFIRMED_ACTION = "No action needed if Tony's away";
    expect(src).toContain(CONFIRMED_ACTION);

    // Confirm it's wrapped in the helper, not concatenated raw
    const confirmedSection = src.slice(
      src.indexOf("Operator absence auto-detected"),
      src.indexOf("Operator absence auto-detected") + 1200,
    );
    expect(confirmedSection).toContain("appendFamilyGradePostscript(");
  });

  it("dead-mans-heartbeat PENDING alert (24h) includes appendFamilyGradePostscript with family copy", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "src/server/services/dead-mans-heartbeat-service.ts"),
      "utf-8",
    );

    // The PENDING (24h) postscript must have family-grade copy
    const PENDING_WHAT = "The bot hasn't heard from the operator in 24 hours";
    expect(src).toContain(PENDING_WHAT);

    const PENDING_ACTION = "If you can reach Tony";
    expect(src).toContain(PENDING_ACTION);

    // Confirm it's wrapped in the helper
    const pendingSection = src.slice(
      src.indexOf("Operator absence — confirmation window started"),
      src.indexOf("Operator absence — confirmation window started") + 1200,
    );
    expect(pendingSection).toContain("appendFamilyGradePostscript(");
  });

  it("bitwarden-session-refresh failure alert includes appendFamilyGradePostscript with family copy", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "src/server/services/bitwarden-session-refresh-service.ts"),
      "utf-8",
    );

    // appendFamilyGradePostscript must be imported
    expect(src).toContain("appendFamilyGradePostscript");
    expect(src).toContain("notification-helpers");

    // The BW refresh postscript must have family-grade copy
    const BW_WHAT = "The bot's secure password vault needs to be unlocked";
    expect(src).toContain(BW_WHAT);

    const BW_ACTION = "backup credentials will keep the bot running";
    expect(src).toContain(BW_ACTION);

    // Confirm it's wrapped in the helper
    const bwSection = src.slice(
      src.indexOf("bitwarden_refresh_failed"),
      src.indexOf("bitwarden_refresh_failed") + 1200,
    );
    expect(bwSection).toContain("appendFamilyGradePostscript(");
  });
});
