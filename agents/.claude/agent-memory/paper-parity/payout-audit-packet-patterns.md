---
name: payout-audit-packet-patterns
description: Payout dispute audit packet generation — tamper-evident bundle using Node built-in streams (Wave 25 Gap 10)
metadata:
  type: project
---

## Payout Audit Packet — Key Patterns (Wave 25 Gap 10)

**Fact:** Real payout disputes (OFP Case 2818 2026-02-07, Lucid Trading 2026-05-14) were lost because operators couldn't produce structured evidence fast enough.

**Architecture:**
- Pure library: `src/server/lib/payout-audit-packet.ts` — all data gathering + manifest building
- CLI thin wrapper: `scripts/generate-payout-audit-packet.ts`
- Runbook: `docs/payout-dispute-runbook.md`

**No new deps** — uses `node:zlib` + `node:fs` streams for tar.gz. Built a minimal ustar header builder in `buildUstarHeader()`.

**paper_trades linkage:** The table has no `account_id` column. Must JOIN through `paper_sessions` on `session_id` to filter by account.

**Tamper-evidence chain:**
1. Each file gets SHA-256 in `manifest.json`
2. `manifest.sha256` = SHA-256 of `manifest.json` itself
3. `manifest.json` and `manifest.sha256` are NOT in `manifest.files` (can't self-reference)

**Data sources gathered:**
- `paper_trades` → via paper_sessions JOIN
- `audit_log` → by accountId in input/result JSONB + correlation_id linkage
- `bias_state` → all symbols, by createdAt window
- `sizing.confluence_multiplier_applied` + related sizing actions
- `kill_switch.*` + `production.kill_switch_*` events
- `strategies` config → via paper_sessions.strategy_id
- `lifecycle_transitions` → via paper_sessions.strategy_id
- `broker_router.route_order` + rejection events for account

**How to apply:** When adding new audit events that are evidence of compliance, add the action to the appropriate `gatherX()` function in the library.
