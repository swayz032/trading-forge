# V4 graph validator — ratify packet

**Class:** autonomous, pre-live instrument hardening. Independent grade remains the gate; this packet grants no scheduling, merge, deployment, or capital authority.

## 1. What and why now

R-545 independently found that graph candidate `337cf11d` marked `P1` and `P2` ready even though their packet and ledger had already shipped and their repair was independently re-censused at band 7. The current graph has no committed validator, so its own `ready_worker_nodes_at_epoch` caption could publish that stale state without a failing command.

Measured current artifacts:

- `P1-P2-TRUTH-FREEZE-PACKET-2026-07-31.md`: blob `1737e74381b47eac8a7abfa67add5240ff2b9301`;
- `P1-P2-TOTAL-MEMBERSHIP-2026-07-31.json`: blob `1551c7e56480caff7d70a580e1f7a2c7ef644203`;
- `GRADE-P1-P2-RECENSUS-2026-08-01.md`: blob `05f8409ce5e76fd7679aa8e5d4ae3c15ba75b754`, verdict `CLAIM NOT REFUTED` with the closeout limitations preserved;
- epoch join available at campaign commit `1fdc6aa045f8ac928b408275f2f8402bd03968a4` (AR-590 plus R-545 plus current advisor state).

## 2. Blast radius

Only the external candidate's scheduling verdict changes. P1/P2 evidence bytes, the campaign blueprint, prototype, engine, DB, runtime, Gate B, and every certification remain unchanged. The candidate is not adopted, so no executing scheduler behavior changes. Downstream effect after eventual adoption: completed P1/P2 nodes satisfy their hard edges but are never scheduled again as worker lanes.

## 3. Exact change, scope locked

**IN:** the external V4 graph JSON; its revision note; a new standalone graph validator and its test; this packet.

**OUT:** campaign files; blueprint requirements; P1/P2 artifacts; prototype; runtime; n8n; engine; database; deployment; live-capital paths; automatic mutation of the graph; graph adoption itself.

The graph refresh will:

1. mark P1/P2 delivered with exact artifact identities and limitations;
2. remove them from the ready worker set and current recommended batch;
3. refresh the report/ruling/state epoch to the committed `1fdc6aa0` join;
4. keep `P0PC` as the only ready worker node and `P3` as advisor-owned work;
5. preserve every hard edge and fan-in predecessor.

## 4. Verification plan

Test-first. Before validator implementation, the test must fail because the module is absent. The validator then must:

- accept the corrected graph and independently recompute readiness from edges and completed predecessors;
- reject duplicate node IDs, missing endpoints, blank hard-edge artifacts, cycles, fan-in/edge disagreement, absent epoch identities, artifact hash mismatch, a node marked ready with unmet predecessors, more than one active money-path implementation or grade, and P1/P2 reintroduced into the ready set;
- use independent literal expectations in the test, never derive expected fan-in or ready nodes from the structure being checked;
- prove each mutation bites and the unmutated control remains green;
- print a machine-readable receipt and exit non-zero on every invalid graph.

The final tree is `[UNVERIFIED]` until an independent `accuracy-validator` hunts for a novel false green. The builder does not grade.

## 5. Rollback

`git revert` the graph/validator commit. Because the candidate is not adopted and no runtime consumes it, rollback removes only the external scheduling proposal and its check. No flag is required; no live default changes.
