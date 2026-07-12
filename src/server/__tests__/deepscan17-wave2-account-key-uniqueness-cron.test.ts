/**
 * deepscan17-wave2-account-key-uniqueness-cron.test.ts — deepscan17 Wave 2, A-2
 * (observability-reliability)
 *
 * Wave 1 shipped `runAccountKeyUniquenessSanityCheck()` /
 * `checkAccountKeyUniquenessSanity()` in cross-symbol-pnl.ts but explicitly did
 * NOT wire it to a scheduler ("NOT wired to a scheduler in this fix wave" per
 * that file's own docstring at the time). Wave 2 registers the daily cron.
 *
 * This test suite covers two layers:
 *   1. The pure comparison function `checkAccountKeyUniquenessSanity()` — unit
 *      tests confirming the WARN condition (>=2 broker accounts, <2 distinct
 *      active account_key values) fires correctly and stays silent otherwise.
 *   2. A static source-text contract test verifying scheduler.ts registers the
 *      job with the established conventions (registerJob + cron.schedule +
 *      _tryAcquireJobLock / _releaseJobLock + _scheduledJobs.add), mirroring
 *      the pattern used by wave28-pass-a-digest-cron.test.ts and
 *      wave29-pass-b3-regime-drift.test.ts for prior scheduler-wiring findings.
 *      This job intentionally mirrors "regime-coverage-check" (a sibling
 *      DB-backed daily sanity WARN, never a trading gate) rather than the
 *      _PIPELINE_GATE_EXEMPT-registered safety crons — it is NOT added to
 *      _PIPELINE_GATE_EXEMPT, consistent with that sibling.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  checkAccountKeyUniquenessSanity,
  type AccountKeyUniquenessWarning,
} from "../services/cross-symbol-pnl.js";

describe("deepscan17 Wave 2 A-2 — checkAccountKeyUniquenessSanity() pure function", () => {
  it("WARNs when a firm has >=2 broker accounts but <2 distinct active account_key values", () => {
    const warnings = checkAccountKeyUniquenessSanity(
      { topstep: 2 },
      { topstep: new Set(["topstep"]) }, // both sessions fell back to the same firmId key
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual<AccountKeyUniquenessWarning>({
      firmId: "topstep",
      distinctBrokerAccounts: 2,
      distinctActiveAccountKeys: 1,
    });
  });

  it("WARNs when distinct active account_key count is zero (no active sessions at all)", () => {
    const warnings = checkAccountKeyUniquenessSanity({ mffu: 3 }, {});
    expect(warnings).toHaveLength(1);
    expect(warnings[0].distinctActiveAccountKeys).toBe(0);
  });

  it("does NOT warn when distinct account_key values match or exceed broker account count", () => {
    const warnings = checkAccountKeyUniquenessSanity(
      { topstep: 2 },
      { topstep: new Set(["topstep-acct-a", "topstep-acct-b"]) },
    );
    expect(warnings).toHaveLength(0);
  });

  it("does NOT warn for a firm with only 1 broker account regardless of key count", () => {
    const warnings = checkAccountKeyUniquenessSanity({ mffu: 1 }, { mffu: new Set(["mffu"]) });
    expect(warnings).toHaveLength(0);
  });

  it("evaluates each firm independently — one firm can warn while another is clean", () => {
    const warnings = checkAccountKeyUniquenessSanity(
      { topstep: 2, mffu: 2 },
      {
        topstep: new Set(["topstep"]), // collapsed — WARN
        mffu: new Set(["mffu-a", "mffu-b"]), // isolated — clean
      },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].firmId).toBe("topstep");
  });
});

describe("deepscan17 Wave 2 A-2 — scheduler.ts cron registration (static contract)", () => {
  const schedulerPath = path.resolve(process.cwd(), "src/server/scheduler.ts");
  const src = fs.readFileSync(schedulerPath, "utf-8");

  it("registers the account-key-uniqueness-sanity job", () => {
    expect(src).toContain('registerJob("account-key-uniqueness-sanity"');
  });

  it("registerJob body imports and calls runAccountKeyUniquenessSanityCheck from cross-symbol-pnl.js", () => {
    const idx = src.indexOf('registerJob("account-key-uniqueness-sanity"');
    const region = src.slice(idx, idx + 700);
    expect(region).toContain("cross-symbol-pnl.js");
    expect(region).toContain("runAccountKeyUniquenessSanityCheck");
  });

  it("has a DST-safe double-fire cron pattern for the job", () => {
    const idx = src.indexOf('registerJob("account-key-uniqueness-sanity"');
    const region = src.slice(idx, idx + 2500);
    // Accept both the raw cron.schedule(...) and the UTC-pinned scheduleUtc(...) wrapper — scheduler.ts
    // migrated all crons to scheduleUtc(). The job now reads scheduleUtc("37 11,12 * * *") (7 AM ET
    // double-fire: 11 UTC=EDT, 12 UTC=EST) with an etHour DST guard.
    expect(region).toMatch(/(?:cron\.schedule|scheduleUtc)\("\d+ \d+,\d+ \* \* \*"/);
  });

  it("uses the overlap guard (_tryAcquireJobLock / _releaseJobLock) around the tick", () => {
    const idx = src.indexOf('registerJob("account-key-uniqueness-sanity"');
    const region = src.slice(idx, idx + 2500);
    expect(region).toContain('_tryAcquireJobLock("account-key-uniqueness-sanity")');
    expect(region).toContain('_releaseJobLock("account-key-uniqueness-sanity")');
  });

  it("emits job-complete telemetry via withRetry + markJobRun + emitJobComplete", () => {
    const idx = src.indexOf('registerJob("account-key-uniqueness-sanity"');
    const region = src.slice(idx, idx + 2500);
    expect(region).toContain('withRetry("account-key-uniqueness-sanity"');
    expect(region).toContain('markJobRun("account-key-uniqueness-sanity")');
    expect(region).toContain('emitJobComplete("account-key-uniqueness-sanity"');
  });

  it("registers the job in _scheduledJobs", () => {
    const idx = src.indexOf('registerJob("account-key-uniqueness-sanity"');
    const region = src.slice(idx, idx + 2500);
    expect(region).toContain('_scheduledJobs.add("account-key-uniqueness-sanity")');
  });

  it("is a daily-cadence job (24h registerJob interval)", () => {
    expect(src).toContain('registerJob("account-key-uniqueness-sanity", 24 * 60 * 60 * 1000');
  });

  it("is NOT added to _PIPELINE_GATE_EXEMPT (matches sibling regime-coverage-check convention)", () => {
    const exemptIdx = src.indexOf("const _PIPELINE_GATE_EXEMPT = new Set<string>([");
    const exemptBlock = src.slice(exemptIdx, src.indexOf("]);", exemptIdx) + 3);
    expect(exemptBlock).not.toContain('"account-key-uniqueness-sanity"');
    expect(src).not.toContain('_PIPELINE_GATE_EXEMPT.add("account-key-uniqueness-sanity")');
  });
});
