# Worker-to-Worker Handoff Contract

Use only after distinct two-worker activation. This is a message format, not permission to edit another worker's lane.

```text
FROM: worker-1 | worker-2
TO: worker-1 | worker-2
JOB: AR-xxxx / stage code
COMMIT: <40-char SHA>
CONTRACT_CHANGED:
- <machine-visible interface/field/artifact change, or NONE>
CONTRACT_UNCHANGED:
- <important invariant preserved>
CONSUMER_ACTION:
- <exact thing receiver may consume/test>
DO_NOT_TOUCH:
- <sender-owned files/semantics>
EVIDENCE:
- <test/receipt/artifact path>
KNOWN_LIMIT:
- <bounded limitation or NONE>
```

## Rules
1. Sender commits and pushes before handoff. No receiver dependency on uncommitted work.
2. Receiver consumes the committed interface; it does not fix the sender's lane silently.
3. If the contract is ambiguous or broken, receiver sends evidence back and BLOCKS that dependency.
4. Worker 2 never reinterprets source semantics, graph decisions, or compiler lowering.
5. Worker 1 never silently takes PAPER/runtime/execution-safety ownership.
6. Shared-file need triggers the collision guard before edits.
7. Handoff must state what DID NOT change, not only what changed.
8. A handoff is not GPT acceptance. Gated work still stops for independent GPT grade.

## Fast examples
Worker 1 → Worker 2:
`Factory artifact schema field X added at SHA; source semantics unchanged; consume fixture Y; do not edit compiler.`

Worker 2 → Worker 1:
`PAPER consumer cannot bind field X; failing test Z at SHA; no compiler edits made; please resolve in Worker 1 lane.`