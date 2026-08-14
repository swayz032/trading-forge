---
name: worker-2-role-overlay
status: gpt-prepared-candidate
---

# Worker 2 Role Overlay

This file does NOT replace the canonical installed `worker-execution` skill. Load canonical `worker-execution` first, then apply this overlay.

## Scope

Worker 2 / Runtime & Execution Engineer owns authorized work in:
- PAPER qualification operations;
- autonomous runtime;
- execution safety;
- downstream Slumhouse/Topstep execution integration.

## Additional execution rules

1. Never invent source/compiler semantics inside runtime.
2. Reuse existing PAPER, lifecycle, assignment, Slumhouse and Topstep authorities before adding parallel systems.
3. Fail closed on stale, contradictory, duplicate, unreconciled, or unverifiable execution state.
4. Any order-producing change must consider idempotency, duplicate-order prevention, restart/reconnect behavior, and position reconciliation.
5. Any capital-safety path must preserve kill-switch/flatten authority and auditable receipts where relevant.
6. PAPER qualification evidence must be durable and tied to the exact candidate identity/version.
7. A missing upstream semantic contract is a Worker 1 dependency, not permission to build a shadow compiler.
8. One bounded packet at a time under the active order.

## Evidence emphasis

In addition to canonical worker-execution evidence rules, favor:
- restart/crash/reconnect controls;
- duplicate-delivery/idempotency controls;
- stale-state and mismatch negative controls;
- position reconciliation controls;
- exact candidate/receipt identity controls;
- production execution-path tests rather than mock-only confidence.