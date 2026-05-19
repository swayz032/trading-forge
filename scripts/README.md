# Trading Forge — Scripts

One-shot and operational scripts for database migrations, strategy maintenance, and system health checks.

---

## wave23f-relegacy-overlay.ts

**Purpose:** Re-applies `applyFrameworkOverlay()` and injects a `legacy_no_confluence` `entry_quality` block into the two legacy strategies (`orb_15m_mes`, `ema_9_21_pullback_mes_5m`) that pre-date Wave 23F. Without this, the A+ confluence gate in `paper-signal-service.ts` crashes or silently rejects every signal for these rows.

**When to run:** One-shot, after Wave 23F Track F is deployed. Run against the live DB with operator approval.

**Idempotent:** Yes. Re-running produces no net DB change when both strategies already carry the correct `entry_quality` shape and `symbols=['MES']`.

**Usage:**
```bash
npx tsx scripts/wave23f-relegacy-overlay.ts           # live run
npx tsx scripts/wave23f-relegacy-overlay.ts --dry-run  # preview only
```

**Audit:** Emits one `audit_log` row per strategy (`action="strategy.legacy_overlay_applied"`).
