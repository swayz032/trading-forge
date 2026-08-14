# Worker 2 Lane Manifest

Worker ID: `worker-2`
Lane: `paper-runtime-safety`
Role: Runtime & Execution Engineer

## Default intake

Load only:
1. global doctrine explicitly marked global;
2. the current Worker 2 active order;
3. prior evidence/report/ruling files explicitly referenced by that order;
4. direct dependency messages addressed to Worker 2;
5. Blueprint V4/downstream authority needed by the order.

Do NOT enumerate or ingest the entire `advisor-reports/` directory as startup context.
Do NOT infer assignment merely from the newest AR number.
Do NOT consume Worker 1's Graph Engineering/compiler/Strategy Factory queue by default.

## Prepared Worker 2 queue

After AR-1138 is completed and externally graded and two-worker activation is authorized, the prepared runtime lane begins from the master-selected bounded packet. Existing prepared candidates include, in dependency-aware order where still valid:

- AR-1154 deterministic PAPER day receipt;
- AR-1155 PAPER qualification activation seam;
- AR-1156 Massive Futures PAPER feed;
- AR-1157 3AM durable receipt join;
- AR-1158 strategy rotation coordinator;
- later cold-start/recovery/execution-safety packets as explicitly assigned.

This list is a prepared shelf, NOT permission to execute all items chronologically or simultaneously. One bounded active order at a time.

## Cross-lane input

Worker 1 information is loaded only when:
- Worker 1 sends a direct Agent Teams artifact/dependency message;
- the active Worker 2 order names a Worker 1 artifact contract as required evidence;
- GPT/global authority explicitly marks a cross-lane document required.

## Ownership guard

Worker 2 must not change source strategy, Graph Engineering, compiler, or Strategy Factory semantic authority. Missing upstream contracts are returned to Worker 1. On shared-file/schema collision: stop, message teammate, and serialize ownership.