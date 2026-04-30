# Quantum Blueprint Calendar-Driven Wave Schedule

These scripts execute the calendar-driven graduation tiers (W7a, W7b, W7c, W8)
that cannot be run during initial engineering. They live in git, survive any
Claude session close, and can be run from any terminal.

## Schedule

| Wave | Target Date | Script | Trigger |
|---|---|---|---|
| **W7a** | 2026-05-30 (~30 days post W2) | `w7a-qae-graduation.mjs` | Calendar |
| **W8** | 2026-05-31 (after W7a commit) | `w8-graveyard-qubo.mjs` | After W7a |
| **W7b** | 2026-06-21 (~30 days post W3b) | `w7b-grover-graduation.mjs` | Calendar |
| **W7c** | 2026-07-29 (~90 days post W2) | `w7c-full-graduation.mjs` | Calendar |

## Usage Pattern

Every script supports dry-run by default. Add `--execute` to apply graduations.

```bash
# 1. Set DATABASE_URL (use the production Railway PostgreSQL connection string)
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"

# 2. Dry run first to see the evidence + decision
node scripts/w7a-qae-graduation.mjs

# 3. If decision is GRADUATE and you agree, execute
node scripts/w7a-qae-graduation.mjs --execute

# 4. After --execute, manually flip env flag + restart server (see script output)
```

## Windows Task Scheduler Setup (optional automation)

If you want the scripts to fire automatically without manual intervention:

```powershell
# Open PowerShell as Administrator, then:

# W7a Day 30
$action = New-ScheduledTaskAction -Execute "node" `
  -Argument "C:\Users\tonio\Projects\trading-forge\trading-forge\scripts\w7a-qae-graduation.mjs --execute" `
  -WorkingDirectory "C:\Users\tonio\Projects\trading-forge\trading-forge"
$trigger = New-ScheduledTaskTrigger -Once -At "2026-05-30 09:07"
Register-ScheduledTask -TaskName "TradingForge-W7a-Graduation" `
  -Action $action -Trigger $trigger -RunLevel Highest

# W8 Day 31 (next day after W7a)
$action = New-ScheduledTaskAction -Execute "node" `
  -Argument "C:\Users\tonio\Projects\trading-forge\trading-forge\scripts\w8-graveyard-qubo.mjs --execute" `
  -WorkingDirectory "C:\Users\tonio\Projects\trading-forge\trading-forge"
$trigger = New-ScheduledTaskTrigger -Once -At "2026-05-31 09:13"
Register-ScheduledTask -TaskName "TradingForge-W8-GraveyardQUBO" `
  -Action $action -Trigger $trigger -RunLevel Highest

# W7b Day 52
$action = New-ScheduledTaskAction -Execute "node" `
  -Argument "C:\Users\tonio\Projects\trading-forge\trading-forge\scripts\w7b-grover-graduation.mjs --execute" `
  -WorkingDirectory "C:\Users\tonio\Projects\trading-forge\trading-forge"
$trigger = New-ScheduledTaskTrigger -Once -At "2026-06-21 09:17"
Register-ScheduledTask -TaskName "TradingForge-W7b-GroverGraduation" `
  -Action $action -Trigger $trigger -RunLevel Highest

# W7c Day 90
$action = New-ScheduledTaskAction -Execute "node" `
  -Argument "C:\Users\tonio\Projects\trading-forge\trading-forge\scripts\w7c-full-graduation.mjs --execute" `
  -WorkingDirectory "C:\Users\tonio\Projects\trading-forge\trading-forge"
$trigger = New-ScheduledTaskTrigger -Once -At "2026-07-29 09:23"
Register-ScheduledTask -TaskName "TradingForge-W7c-FullGraduation" `
  -Action $action -Trigger $trigger -RunLevel Highest

# Verify all 4 scheduled
Get-ScheduledTask -TaskName "TradingForge-*"
```

**IMPORTANT:** The Windows Task Scheduler approach requires:
1. `DATABASE_URL` set as a SYSTEM environment variable (not just user)
2. `node` on system PATH
3. Computer must be ON or set to wake from sleep at trigger time

## Decision Logic Summary

### W7a — QAE Graduation
- **GRADUATE if:** `paired_runs >= 20 AND median_agreement > 0.70 AND fallback_rate < 20%`
- **Action:** `governance_state.qae_weight = 0.05`, set `QUANTUM_QAE_GATE_PHASE=1`
- **Effect:** Phase 1 = advisory disagreement alerts (still no gate authority)

### W8 — Graveyard QUBO
- **Precondition:** W7a graduation audit log entry exists
- **Action:** Verify code readiness then set `QUANTUM_GRAVEYARD_QUBO_ENABLED=true`
- **Effect:** SQA optimizer respects graveyard centroid penalty

### W7b — Grover Graduation
- **GRADUATE if:** `paired_runs >= 10 AND true_positives > false_positives`
- **Action:** `governance_state.grover_weight = 0.05`, modify lifecycle gate to enforce Grover block
- **Effect:** Phase 1 = strategies with `worst_case_breach_prob > 0.5 AND breach_minimal_n_trades < 4` are BLOCKED

### W7c — Full Phase 1→2 Graduation
- **GRADUATE per module if:** `correlation > 0.30` with paper outcomes
- **Action per graduating module:** `governance_state.{module}_weight = 0.10`
- **Manual follow-up:** Update CLAUDE.md gate authority section via `/claude-md-management:claude-md-improver`
- **Effect:** Quantum becomes co-decider with classical (was: challenger-only)

## What Happens If You Skip a Graduation?

Each script defaults to dry-run + decision report. Skipping means:
- W7a skipped → QAE stays at Phase 0 (shadow only) → W8 cannot proceed
- W7b skipped → Grover stays at Phase 0 (shadow only) → no behavior change
- W7c skipped → All modules stay at Phase 1 (or 0) → no authority promotion

No data is lost. Re-run scripts on a later date when more evidence accumulates.

## Cleanup After Graduations

After all 4 waves fire, delete the corresponding Windows Task Scheduler entries:

```powershell
Get-ScheduledTask -TaskName "TradingForge-*" | Unregister-ScheduledTask -Confirm:$false
```
