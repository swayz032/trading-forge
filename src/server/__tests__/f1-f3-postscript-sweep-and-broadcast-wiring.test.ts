/**
 * F1+F3 Tests — Global Postscript Sweep and Broadcast Wiring Verification
 *
 * F1: Verifies the CI lint script exits 0 (all notify calls are family-grade wrapped)
 * F3: Verifies broadcastSSE is called after each of the 3 catalog-event audit inserts
 */

import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// __dirname = src/server/__tests__
// SERVER_DIR = src/server/
// ROOT_DIR   = trading-forge/ (project root, contains scripts/ and package.json)
const SERVER_DIR = path.resolve(__dirname, "../");
const ROOT_DIR = path.resolve(__dirname, "../../..");

describe("F1 — Family-Grade Postscript Sweep", () => {
  it("check:family-grade-postscript exits 0 against the post-F1 codebase", () => {
    const scriptPath = path.join(ROOT_DIR, "scripts/check-family-grade-postscript.ts");
    let result: { status: number | null; stdout: string; stderr: string };
    try {
      const stdout = execSync(`npx tsx "${scriptPath}"`, {
        cwd: ROOT_DIR,
        encoding: "utf8",
        timeout: 30000,
      });
      result = { status: 0, stdout, stderr: "" };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      result = { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }

    // Should exit 0
    expect(result.status, `Lint script failed:\n${result.stdout}\n${result.stderr}`).toBe(0);
    // Stderr should not contain offender lines
    expect(result.stderr, "Lint script reported offenders").not.toMatch(/FAIL/);
  });

  it("admin.ts dangerous-action alerts include family-grade postscripts", () => {
    const filePath = path.join(SERVER_DIR, "routes/admin.ts");
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");

    const notifyLines: number[] = [];
    lines.forEach((line, idx) => {
      if (/\bnotifyCritical\s*\(/.test(line) || /\bnotifyWarning\s*\(/.test(line)) {
        if (!line.trimStart().startsWith("//") && !line.trimStart().startsWith("*")) {
          notifyLines.push(idx);
        }
      }
    });

    for (const lineIdx of notifyLines) {
      const windowStart = Math.max(0, lineIdx - 10);
      const windowEnd = Math.min(lines.length, lineIdx + 11);
      const window = lines.slice(windowStart, windowEnd).join("\n");
      expect(window, `admin.ts line ${lineIdx + 1} is missing appendFamilyGradePostscript`).toMatch(/appendFamilyGradePostscript|--- For family members ---/);
    }
  });

  it("lifecycle-service.ts demotion alerts include family-grade postscripts", () => {
    const filePath = path.join(SERVER_DIR, "services/lifecycle-service.ts");
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");

    const notifyLines: number[] = [];
    lines.forEach((line, idx) => {
      if (/\bnotifyCritical\s*\(/.test(line) || /\bnotifyWarning\s*\(/.test(line)) {
        if (!line.trimStart().startsWith("//") && !line.trimStart().startsWith("*")) {
          notifyLines.push(idx);
        }
      }
    });

    for (const lineIdx of notifyLines) {
      const windowStart = Math.max(0, lineIdx - 10);
      const windowEnd = Math.min(lines.length, lineIdx + 11);
      const window = lines.slice(windowStart, windowEnd).join("\n");
      expect(window, `lifecycle-service.ts line ${lineIdx + 1} is missing appendFamilyGradePostscript`).toMatch(/appendFamilyGradePostscript|--- For family members ---/);
    }
  });
});

describe("F3 — lifecycle-service.ts broadcastSSE Wiring", () => {
  const lifecycleServicePath = path.join(SERVER_DIR, "services/lifecycle-service.ts");

  it("FROZEN_POLICY_DRIFT_BLOCKED audit insert is followed by broadcastSSE", () => {
    const content = fs.readFileSync(lifecycleServicePath, "utf8");
    const lines = content.split("\n");

    const auditLineIdx = lines.findIndex(l => l.includes('"lifecycle.frozen_policy_drift_blocked"'));
    expect(auditLineIdx, "Could not find lifecycle.frozen_policy_drift_blocked audit action").toBeGreaterThan(-1);

    // Look forward 20 lines for broadcastSSE
    const forwardWindow = lines.slice(auditLineIdx, auditLineIdx + 20).join("\n");
    expect(forwardWindow, "broadcastSSE not found after frozen_policy_drift_blocked audit insert").toMatch(/broadcastSSE.*FROZEN_POLICY_DRIFT_BLOCKED|LIFECYCLE_GATE_EVENTS\.FROZEN_POLICY_DRIFT_BLOCKED/);
  });

  it("COMPLIANCE_DRIFT_BLOCKED audit insert is followed by broadcastSSE", () => {
    const content = fs.readFileSync(lifecycleServicePath, "utf8");
    const lines = content.split("\n");

    const auditLines = lines.reduce<number[]>((acc, l, idx) => {
      if (l.includes('"lifecycle.promotion_blocked_compliance_drift"')) acc.push(idx);
      return acc;
    }, []);
    expect(auditLines.length, "Expected at least 1 compliance_drift audit action").toBeGreaterThanOrEqual(1);

    for (const auditLineIdx of auditLines) {
      const forwardWindow = lines.slice(auditLineIdx, auditLineIdx + 20).join("\n");
      expect(forwardWindow, `broadcastSSE not found after compliance_drift audit at line ${auditLineIdx + 1}`).toMatch(/broadcastSSE.*COMPLIANCE_DRIFT_BLOCKED|LIFECYCLE_GATE_EVENTS\.COMPLIANCE_DRIFT_BLOCKED/);
    }
  });

  it("BACKTEST_STALE audit insert is followed by broadcastSSE", () => {
    const content = fs.readFileSync(lifecycleServicePath, "utf8");
    const lines = content.split("\n");

    const auditLines = lines.reduce<number[]>((acc, l, idx) => {
      if (l.includes('"lifecycle.backtest_stale"')) acc.push(idx);
      return acc;
    }, []);
    expect(auditLines.length, "Expected at least 1 backtest_stale audit action").toBeGreaterThanOrEqual(1);

    for (const auditLineIdx of auditLines) {
      const forwardWindow = lines.slice(auditLineIdx, auditLineIdx + 20).join("\n");
      expect(forwardWindow, `broadcastSSE not found after backtest_stale audit at line ${auditLineIdx + 1}`).toMatch(/broadcastSSE.*BACKTEST_STALE|LIFECYCLE_GATE_EVENTS\.BACKTEST_STALE/);
    }
  });
});
