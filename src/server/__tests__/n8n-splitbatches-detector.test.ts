/**
 * n8n F-2 (deep-scan re-verify 2026-07-06) — SplitInBatches v3 mis-wiring detector is now durable.
 *
 * findSplitBatchesMisWired originally only caught index 1 (loop) being EMPTY. The F-2 fix added a graph-walk
 * (reachesNode) that also catches the SWAPPED case (both indices populated but reversed) — the loop branch
 * MUST loop back to the SplitInBatches node; the done branch must NOT. n8n's index 0 = "done" (terminal),
 * index 1 = "loop" (per-batch body): wiring the body to index 0 silently does ZERO work. These fixtures pin
 * the contract the grader verified against a real historically-broken workflow.
 */
import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — .mjs audit script, no type decls; exported for test coverage.
import { findSplitBatchesMisWired, reachesNode } from "../../../scripts/audit-n8n-workflows.mjs";

const SPLIT = "n8n-nodes-base.splitInBatches";

function wf(connections: Record<string, unknown>) {
  return {
    nodes: [
      { name: "Split", type: SPLIT, typeVersion: 3 },
      { name: "Loop", type: "n8n-nodes-base.noOp", typeVersion: 1 },
      { name: "Done", type: "n8n-nodes-base.noOp", typeVersion: 1 },
    ],
    connections,
  };
}

describe("n8n F-2 — SplitInBatches v3 mis-wiring detector", () => {
  it("CLEAN: idx0→Done (terminal), idx1→Loop→back to Split → NO violation", () => {
    const v = findSplitBatchesMisWired(
      wf({
        Split: { main: [[{ node: "Done" }], [{ node: "Loop" }]] }, // idx0=Done, idx1=Loop
        Loop: { main: [[{ node: "Split" }]] }, // loop body re-invokes Split
      }),
    );
    expect(v).toHaveLength(0);
  });

  it("SWAPPED: idx0→Loop(loops back), idx1→Done(terminal) → violation (idx1 does not loop back)", () => {
    const v = findSplitBatchesMisWired(
      wf({
        Split: { main: [[{ node: "Loop" }], [{ node: "Done" }]] }, // SWAPPED
        Loop: { main: [[{ node: "Split" }]] },
      }),
    );
    expect(v).toHaveLength(1);
    expect(v[0].nodeName).toBe("Split");
    expect(String(v[0].reason)).toMatch(/does NOT loop back|swapped/i);
  });

  it("EMPTY loop branch: idx1 empty (loop body on idx0 only) → violation", () => {
    const v = findSplitBatchesMisWired(
      wf({
        Split: { main: [[{ node: "Loop" }]] }, // only idx0 populated
        Loop: { main: [[{ node: "Split" }]] },
      }),
    );
    expect(v).toHaveLength(1);
    expect(String(v[0].reason)).toMatch(/index 0 \(done\)/i);
  });

  it("reachesNode: BFS follows the connection graph back to the target (and returns false when it can't)", () => {
    const conns = { Loop: { main: [[{ node: "Split" }]] } };
    expect(reachesNode(conns, [{ node: "Loop" }], "Split")).toBe(true);
    expect(reachesNode(conns, [{ node: "Done" }], "Split")).toBe(false);
  });
});
