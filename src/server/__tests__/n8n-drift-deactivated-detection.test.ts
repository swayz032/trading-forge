/**
 * F-3 (deep-scan false-green, 2026-07-06) — the n8n drift detector must flag a
 * DEACTIVATED (paused) workflow, not silently drop it.
 *
 * Before the fix, `audit-n8n-workflows.mjs` scanned ONLY active workflows
 * (`list.filter(w => w.active && !w.isArchived)`), so a production workflow that
 * was quietly turned off dropped out of every check and the report read
 * "0 violations" (false-green). `findDeactivatedWorkflows` now surfaces every
 * deactivated-but-not-archived workflow as its own violation. Archiving
 * (isArchived=true) is the explicit "intentionally off" acknowledgement that
 * clears the flag.
 */
import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — .mjs audit script, no type decls; exported for test coverage.
import { findDeactivatedWorkflows } from "../../../scripts/audit-n8n-workflows.mjs";

describe("F-3 — n8n drift detector flags deactivated-but-not-archived workflows", () => {
  it("flags a deactivated (paused) workflow that is not archived", () => {
    const v = findDeactivatedWorkflows([
      { id: "w1", name: "nightly-strategy-research", active: false, isArchived: false },
    ]);
    expect(v).toHaveLength(1);
    expect(v[0].workflowName).toBe("nightly-strategy-research");
    expect(v[0].active).toBe(false);
    expect(String(v[0].note)).toMatch(/deactivated .*not archived/i);
  });

  it("does NOT flag an active workflow", () => {
    const v = findDeactivatedWorkflows([
      { id: "w2", name: "master-orchestration", active: true, isArchived: false },
    ]);
    expect(v).toHaveLength(0);
  });

  it("does NOT flag an archived (acknowledged-off) workflow", () => {
    const v = findDeactivatedWorkflows([
      { id: "w3", name: "retired-legacy-flow", active: false, isArchived: true },
    ]);
    expect(v).toHaveLength(0);
  });

  it("returns ONLY the paused workflow from a mixed fleet (false-green guard)", () => {
    const v = findDeactivatedWorkflows([
      { id: "a", name: "active-a", active: true, isArchived: false },
      { id: "b", name: "paused-b", active: false, isArchived: false },
      { id: "c", name: "archived-c", active: false, isArchived: true },
      { id: "d", name: "active-d", active: true, isArchived: false },
    ]);
    expect(v.map((x: { workflowName: string }) => x.workflowName)).toEqual(["paused-b"]);
  });

  it("tolerates an empty / undefined list without throwing", () => {
    expect(findDeactivatedWorkflows([])).toEqual([]);
    expect(findDeactivatedWorkflows(undefined)).toEqual([]);
  });
});
