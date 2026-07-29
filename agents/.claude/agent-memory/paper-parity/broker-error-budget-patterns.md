---
name: broker-error-budget-patterns
description: How broker rejection events are emitted and aggregated in Wave 25 Gap 8
metadata:
  type: project
---

## Broker Error Budget — Key Patterns (Wave 25 Gap 8)

**Fact:** `broker-router.ts` emits two rejection action names into `audit_log`:
- Line 180: `broker_router.route_rejected` — kill-switch halt / pipeline-paused / account-not-found gates. No broker metadata when kill-switch fires before account lookup (broker = "unknown").
- Line 420: `broker_router.compliance_rejected` — compliance gate violation. Has `firmId` in input JSONB, `message` in result.

Success routing is written by `writeAuditLog()` as `broker_router.route_order` (not `broker:order_routed`).

**Why:** No one was aggregating them before Wave 25. Operators could not see spiking rejection classes before they cost a payout.

**Broker identity extraction priority** (in `extractBroker()`):
1. `result.brokerType` (set on compliance rejections + successful routes)
2. `input.brokerType` (set when account was resolved before the gate)
3. `result.firmId` (compliance rejections)
4. `input.firmId` (fallback)
5. `"unknown"` sentinel (kill-switch fires before account lookup)

**Alarm threshold:** 5% (strictly >) of attempts for any (broker, rejectionClass) pair over rolling 24h.

**Cron:** Registered as `broker-error-budget-check`, fires hourly, pipeline-gated.

**SSE event:** `alert:broker_error_budget`
**Audit action:** `broker.error_budget_breach`
**Discord:** `notifyWarning` (batched, not immediate)

**How to apply:** When adding new rejection paths to broker-router.ts, ensure they write an action in `REJECTION_ACTIONS` list and include broker identity in input/result JSONB.
