# Payout Dispute — Audit Packet Runbook

**Wave 25 Gap 10 — Additive to Production Hardening**

Real cases that motivated this runbook:
- **OFP Funding Case 2818 (2026-02-07)** — Denied payout at 1.02% drawdown. Operator could not produce timestamped evidence fast enough.
- **Lucid Trading "fraud" ban (2026-05-14)** — Cross-user copy-trading allegation. Evidence of independent strategy origin required.

Trading Forge captures all the necessary data. This runbook explains how to bundle it into a tamper-evident packet.

---

## When to Run

Run the audit packet generator when:
- A prop firm questions a payout or drawdown calculation
- A firm asks for evidence of independent strategy operation
- A compliance dispute requires time-stamped trade records
- You need to verify your own records before a payout request

---

## Command

```bash
tsx scripts/generate-payout-audit-packet.ts \
  --account-id <broker_account_id> \
  --start <ISO-8601> \
  --end <ISO-8601> \
  [--output <directory>]
```

**Example — generate for February 2026:**
```bash
tsx scripts/generate-payout-audit-packet.ts \
  --account-id "acc_topstep_001" \
  --start "2026-02-01T00:00:00Z" \
  --end "2026-02-28T23:59:59Z" \
  --output ./reports/payout-audits
```

**Where to find your account-id:**
```bash
# Query the database
SELECT account_id, broker_type, firm_id FROM broker_accounts;
```

Or check the Trading Forge dashboard under Broker Accounts.

---

## What the Packet Contains

| File | Description |
|------|-------------|
| `trades.jsonl` | All paper trades (entry, exit, P&L, fees, slippage, session link) |
| `audit-log.jsonl` | All `audit_log` rows touching this account in the period |
| `bias-state.jsonl` | Daily regime/bias snapshots (proves independent signal origin) |
| `sizing-audits.jsonl` | Confluence multiplier + risk-derived sizing decisions |
| `kill-switch-events.jsonl` | Kill-switch activations and production-halt events |
| `strategy-dsls.json` | Full strategy DSL configs for active strategies |
| `lifecycle-transitions.jsonl` | Strategy promotion/demotion history |
| `broker-events.jsonl` | All routing attempts, successes, and rejections |
| `README.md` | Human-readable summary: trade counts, P&L, drawdown, compliance attestations |
| `manifest.json` | File inventory with SHA-256 hash of each file |
| `manifest.sha256` | SHA-256 of `manifest.json` itself (tamper-evident root) |

---

## What to Send the Firm

1. The `.tar.gz` archive (e.g., `payout-audit-acc_topstep_001-2026-02-01...tar.gz`)
2. The `manifest.sha256` value in your email/ticket body
3. The README.md summary (copy-paste or attach separately)

**Tell the firm:**
> "The SHA-256 in `manifest.sha256` covers `manifest.json`, which contains the SHA-256 of every other file in the packet. Any modification to any file will produce a mismatched hash."

---

## Verifying Integrity (both sides)

```bash
# On any system with sha256sum (Linux/macOS/WSL):
sha256sum manifest.json
# The output should match the value in manifest.sha256

# On Windows PowerShell:
(Get-FileHash -Algorithm SHA256 manifest.json).Hash.ToLower()
# Compare to: (Get-Content manifest.sha256) | ForEach-Object { $_ -split '\s+' | Select -First 1 }
```

---

## Retention Policy

- **Retain audit packets for a minimum of 2 years** from the date of the trade.
- Store in a location you control — not solely in Trading Forge's database.
- Do NOT modify any file after generation. The SHA-256 chain is tamper-evident.
- If re-generating for the same period, the packet will contain identical trade rows but a different `generated_at` timestamp. Both are valid evidence; use the earliest-generated copy if possible.

---

## Troubleshooting

**"No trades found"** — Verify the account-id matches `broker_accounts.account_id` exactly (UUID format). Check that the start/end window covers the relevant trading days.

**Database connection error** — Ensure `DATABASE_URL` is set in your environment (`.env` file or shell). The script uses the same DB connection as the Trading Forge backend.

**Script times out on large windows** — For periods > 6 months, split into monthly packets and zip them together manually.

---

## Notes for Prop Firm Submission

1. **Drawdown calculation**: The README shows intra-period running drawdown from individual P&L entries. If the firm uses a different drawdown methodology (e.g., end-of-day, peak-to-trough on equity curve), provide this context in your submission.

2. **Strategy independence**: The `bias-state.jsonl` file proves that signal direction came from the Trading Forge bias engine (regime + playbook routing), not from copying another account. Each row is timestamped and signed by the scheduler.

3. **Timestamps**: All timestamps are UTC with timezone offset (`TIMESTAMPTZ`). Convert to the firm's preferred timezone for human-readable exhibits if needed.
