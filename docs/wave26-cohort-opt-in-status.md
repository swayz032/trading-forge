# Wave 26 Cohort Opt-In Status

## Task 1 — silver_bullet adaptive exit opt-in

**Date:** 2026-05-24
**Dispatch:** Wave 26 Group B (paper-parity)
**Operator authorization:** Wave 26 dispatch

### DB Row State (post-apply)

| Field | Value |
|---|---|
| `strategies.name` | `ict_silver_bullet_ny_am_mes_15m` |
| `strategies.lifecycle_state` | `CANDIDATE` |
| `strategies.exit_plan_config.exit_style` | `adaptive` |
| `strategies.exit_plan_config` | `{"exit_style":"adaptive"}` |

### Cohort Discipline

| Strategy | Status |
|---|---|
| `ict_silver_bullet_ny_am_mes_15m` | **OPTED IN** (adaptive) |
| `four_h_crt_timed_mes_15m` | NOT opted in (static_styleC) |
| `ict_power_of_3_mes_15m` | NOT opted in (static_styleC) |

### Audit Row Written

```json
{
  "action": "strategy.wave26_cohort_opt_in",
  "entity_type": "strategy",
  "entity_id": "<silver_bullet_id>",
  "decision_authority": "system",
  "status": "success",
  "result": {
    "name": "ict_silver_bullet_ny_am_mes_15m",
    "lifecycle_state": "CANDIDATE",
    "prior_exit_style": "static_styleC",
    "new_exit_style": "adaptive",
    "cohort": "silver_bullet",
    "applied_by": "wave26_dispatch",
    "wave": "wave26_group_b",
    "fix_ref": "wave26-cohort-opt-in"
  }
}
```

### Idempotency Check

Re-running `wave25-pass7-adaptive-opt-in.ts --strategy silver_bullet` after apply:
- `Already adaptive (skipped): 1`
- `Eligible (would flip): 0`
- Confirmed idempotent.

### Script Changes Made

1. Fixed `.rows` access bug: `db.execute()` with postgres.js driver returns array directly, not `{rows:[]}` wrapper. The column-check was always returning false. Fixed to handle both patterns.
2. Added `--strategy <fragment>` flag for cohort-discipline filtering.
3. Updated `FIX_REF` to `wave26-cohort-opt-in`.
4. Updated audit action to `strategy.wave26_cohort_opt_in` with cohort metadata.

### Live Effect

Wave 25.5 wiring is LIVE as of 2026-05-24:
- `paper-execution-service.ts` opens positions with `computeExitPlan()` (Gap A closed)
- `backtester._apply_trade_management()` routes to adaptive engine (Gap B closed)
- `updatePositionPrices()` executes runner trail by method (Gap C closed)

`ict_silver_bullet_ny_am_mes_15m` will receive real adaptive exit plans at position-open.
