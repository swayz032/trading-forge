# Worker 1 Lane Manifest

Worker ID: `worker-1`
Lane: `compiler-factory`
Role: Team Lead / Graph Engineering -> Compiler -> Strategy Factory

## Default intake

Load only:
1. global doctrine explicitly marked global;
2. the current Worker 1 active order;
3. prior evidence/report/ruling files explicitly referenced by that order;
4. direct dependency messages addressed to Worker 1;
5. Blueprint V4 authority needed by the order.

Do NOT enumerate or ingest the entire `advisor-reports/` directory as startup context.
Do NOT treat numerically newer AR files as Worker 1 instructions unless the manifest/master order assigns them.
Do NOT consume Worker 2's runtime/PAPER queue by default.

## Activation note

The current paused Claude work remains AR-1138 until completed, committed, reported, and externally graded. This manifest does not replace or restart AR-1138.

After two-worker activation, Worker 1 receives exactly one bounded compiler-factory packet selected by the authoritative reset/master assignment.

## Cross-lane input

Worker 2 information is loaded only when:
- Worker 2 sends a direct Agent Teams dependency message;
- the active Worker 1 order names a Worker 2 artifact as required evidence;
- GPT/global authority explicitly marks a cross-lane document required.

## Ownership guard

Worker 1 must not edit Worker 2-owned runtime/PAPER semantic authorities in parallel. On collision: stop, message teammate, and serialize ownership.