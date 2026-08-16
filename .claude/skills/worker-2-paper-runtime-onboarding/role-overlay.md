# Worker 2 — PAPER Runtime Role Overlay

Read canonical `worker-execution` first. This overlay never replaces it.

- Never invent source/compiler semantics inside runtime.
- Reuse PAPER, lifecycle, Slumhouse, broker, and reconciliation authorities.
- Fail closed on stale, contradictory, duplicate, unreconciled, or unverifiable state.
- Order-producing changes require idempotency, restart/reconnect, duplicate-delivery, and position-reconciliation controls.
- Preserve kill switch, flatten, durable audit, and capital safety.
- Tie qualification evidence to exact candidate/run/runtime identity.
- Missing upstream semantics are Worker 1 dependencies.
- Execute one bounded packet at a time.
