# Prop Firm Compliance — Three-Layer Architecture

> Compliance beats profit. No strategy runs if current rules are stale, ambiguous, or violated.

This document describes Trading Forge's live prop firm rule enforcement system. The system ensures every strategy deployed to a prop firm account is checked against verified, up-to-date rules before execution begins.

---

## Three-Layer Architecture

```
Layer 1: OpenClaw Monitors        (AI sidecar — watches, flags, recommends)
Layer 2: Rule Engine Enforces      (deterministic Python — no AI judgment)
Layer 3: Human Approves            (trader validates drift, overrides gates)
```

### Layer 1 — OpenClaw Compliance Guard (AI Monitor)

- System prompt: `src/agents/OPENCLAW_COMPLIANCE_GUARD.md`
- Runs as a sidecar agent alongside the strategy pipeline
- Monitors prop firm documentation for rule changes across all 8 firms
- Flags ambiguities, contradictions, and undocumented edge cases
- Produces structured compliance reviews stored via `POST /api/compliance/review`
- Has zero execution authority — it recommends, the gate decides

### Layer 2 — Compliance Gate (Deterministic Rule Engine)

- Implementation: `src/engine/compliance/compliance_gate.py`
- Pure rule matching against verified rulesets — no AI judgment
- Runs the pre-session gate daily at 9:15 AM ET before trading begins
- Checks freshness, drift status, and strategy compliance for every active strategy
- Returns gate decisions: `APPROVED | BLOCKED | RESTRICTED`
- A strategy that fails any check is blocked — no exceptions, no overrides from Layer 1

### Layer 3 — Human Approval

- The trader is the final authority on ruleset verification
- After drift detection, only a human can re-verify rules via `PATCH /api/compliance/rulesets/:id/verify`
- After drift resolution, only a human can resolve drift events via `PATCH /api/compliance/drift/:id/resolve`
- Human verification resets the freshness clock and clears drift flags

---

## Freshness Gates

Rulesets have maximum age thresholds. If a ruleset exceeds its age limit, all strategies targeting that firm are blocked.

| Context | Max Age | Rationale |
|---------|---------|-----------|
| `active_trading` | 24 hours | Rules must be verified within the last day before live trading |
| `research_only` | 72 hours | Looser threshold for backtesting and research pipelines |
| `after_drift_detected` | 0 hours | Immediate block — no trading until human revalidates |

Freshness is calculated from the `retrieved_at` timestamp on each ruleset. The check returns one of three statuses:

- **`verified`** — Ruleset is fresh and within age limits
- **`stale`** — Ruleset has exceeded its max age; re-fetch required
- **`blocked_drift`** — Drift was detected; human revalidation required before any use

---

## Drift Detection

Drift detection catches when a prop firm changes its rules after we last verified them.

### How It Works

1. On every document fetch, the system computes a SHA-256 hash of the raw content
2. The new hash is compared against the stored hash from the last verified fetch
3. If hashes differ, `drift_detected` is set to `true` on the ruleset
4. The drift event is logged to `compliance_drift_log` with old/new hashes
5. All strategies targeting the affected firm are immediately blocked (max age = 0 hours)
6. Trading resumes only after a human reviews the changes and verifies the updated ruleset

### Functions

```python
compute_content_hash(content: str) -> str
    # SHA-256 of raw content

detect_drift(stored_hash: str, new_content: str) -> dict
    # Returns: { drift_detected: bool, old_hash: str, new_hash: str }
```

---

## Strategy Compliance Checks

The rule engine checks each strategy's backtest results against a firm's normalized rules. Six checks are performed:

| Check | What It Compares | Violation Threshold | Risk Score |
|-------|-----------------|---------------------|------------|
| **Drawdown** | `strategy.max_drawdown` vs `firm.max_drawdown_limit` | Exceeds limit | +40 |
| **Daily Loss** | `strategy.daily_loss` vs `firm.daily_loss_limit` | Exceeds limit | +30 |
| **Consistency** | `strategy.best_day_pnl / total_pnl` vs `firm.consistency_threshold` | Exceeds threshold | +25 |
| **Overnight Holding** | `strategy.overnight_holding` vs `firm.overnight_allowed` | Holds when prohibited | +20 |
| **Contract Limits** | `strategy.contracts_per_symbol` vs `firm.contract_limits` | Exceeds per-symbol cap | +15 |
| **Automation Policy** | `strategy.automated` vs `firm.automation_banned` | Bot used when banned | +30 |

Each check also has a **warning zone** at 80% of the violation threshold (adds lower risk score).

### Results

- **`pass`** — No violations, no warnings. Risk score 0.
- **`needs_review`** — No violations, but warnings present. Strategy proceeds with monitoring.
- **`fail`** — One or more violations. Strategy is blocked.

### Risk Score

Cumulative 0-100 score. Higher = more dangerous. Violations stack additively, capped at 100.

---

## Pre-Session Gate

Runs daily at 9:15 AM ET before the trading session opens.

### Flow

```
For each active strategy:
  1. Find matching firm ruleset
     - No ruleset found → BLOCKED ("No ruleset found for firm")
  2. Check freshness
     - Stale or drift detected → BLOCKED (with freshness message)
  3. Check strategy compliance against firm rules
     - Violations → BLOCKED (with violation details)
     - Warnings only → RESTRICTED (with warning details)
     - Clean → APPROVED
```

### Gate Decisions

| Decision | Meaning | Action |
|----------|---------|--------|
| `APPROVED` | Fresh rules, no violations | Strategy may execute |
| `RESTRICTED` | Fresh rules, warnings only | Strategy may execute with enhanced monitoring |
| `BLOCKED` | Stale rules, drift, or violations | Strategy must not execute |

---

## API Routes

All routes are mounted at `/api/compliance/`.

### Ruleset Management

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/rulesets` | All firm rulesets with freshness status (age, trading/research freshness) |
| `GET` | `/rulesets/freshness` | Quick freshness check — returns `allFreshForTrading`, `staleFirms`, per-firm status |
| `GET` | `/rulesets/:firm` | Rulesets for a specific firm |
| `PATCH` | `/rulesets/:id/verify` | Human verifies an updated ruleset — clears drift, resets freshness |

### Compliance Reviews

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/review` | Store a compliance review (produced by OpenClaw or rule engine) |
| `GET` | `/review/:strategyId` | All compliance reviews for a strategy, newest first |
| `GET` | `/review/:strategyId/:firm` | Latest compliance review for a strategy at a specific firm |

Required fields for `POST /review`: `strategyId`, `firm`, `complianceResult`, `executionGate`.

### Gate Decisions

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/gate/today` | Today's per-strategy gate decisions, including stale firm overrides |

The gate endpoint cross-references ruleset freshness with compliance reviews. If a firm's rules are stale, all strategies at that firm are overridden to `BLOCKED` regardless of compliance result.

### Drift Management

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/drift` | All drift events, newest first |
| `GET` | `/drift/unresolved` | Only unresolved drift events |
| `PATCH` | `/drift/:id/resolve` | Human resolves a drift event (sets `resolved`, `resolvedBy`, `notes`) |

### Health Dashboard

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/status` | Overall compliance health — healthy/degraded, per-firm status, unresolved drift count |

A firm is **healthy** if its ruleset is fresh (< 24h), verified, and has no drift. Overall health is **degraded** if any firm is unhealthy.

---

## Database Tables

### `compliance_rulesets`

Stores the current verified ruleset for each firm/account-type combination.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `firm` | text | Firm identifier (e.g., `topstep`, `mffu`, `tpt`) |
| `accountType` | text | Account type (e.g., `50k`, `100k`) |
| `rules` | jsonb | Normalized rule object (drawdown limits, consistency thresholds, contract caps) |
| `contentHash` | text | SHA-256 hash for drift detection |
| `retrievedAt` | timestamp | When the rules were last fetched from source |
| `status` | text | `verified` or `unverified` |
| `driftDetected` | boolean | Whether content hash changed since last verification |
| `driftDiff` | text | Human-readable diff of what changed (nullable) |
| `verifiedBy` | text | Who verified (`human` or `openclaw`) |
| `verifiedAt` | timestamp | When last verified |
| `createdAt` | timestamp | Row creation time |
| `updatedAt` | timestamp | Last update time |

### `compliance_reviews`

Stores compliance check results for each strategy-firm pair.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `strategyId` | text | Strategy being reviewed |
| `firm` | text | Target firm |
| `accountType` | text | Account type at the firm |
| `rulesetId` | UUID | FK to the ruleset used for this review |
| `complianceResult` | text | `pass`, `fail`, or `needs_review` |
| `riskScore` | integer | 0-100 cumulative risk score |
| `violations` | jsonb | Array of violation strings |
| `warnings` | jsonb | Array of warning strings |
| `requiredChanges` | jsonb | Array of required changes to achieve compliance |
| `reasoningSummary` | text | Human-readable explanation |
| `executionGate` | text | `APPROVED`, `BLOCKED`, or `RESTRICTED` |
| `reviewedBy` | text | `openclaw` or `human` |
| `createdAt` | timestamp | When the review was created |

### `compliance_drift_log`

Audit trail of every drift event detected.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `firm` | text | Affected firm |
| `oldHash` | text | Previous content hash |
| `newHash` | text | New content hash after drift |
| `detectedAt` | timestamp | When drift was detected |
| `resolved` | boolean | Whether a human has resolved this drift |
| `resolvedAt` | timestamp | When resolved (nullable) |
| `resolvedBy` | text | Who resolved it (nullable) |
| `notes` | text | Resolution notes (nullable) |

---

## Covered Firms

The compliance system tracks all 8 prop firms with their specific rule variations. Full rules are documented in `docs/prop-firm-rules.md`.

| Firm | Drawdown Type | Consistency Rule | Daily Loss Limit | Key Constraint |
|------|--------------|------------------|-------------------|----------------|
| **Topstep** | Trailing EOD, locks | None | $1,000 soft | No overnight; TopstepX platform required |
| **Take Profit Trader (TPT)** | Trailing EOD | 50% single-day cap (eval + PRO) | None | Consistency removed at PRO+ |
| **My Funded Futures (MFFU)** | Trailing EOD, locks | 50% eval / 40% funded | None | Lowest fees; $0 activation |
| **Apex Trader Funding** | Trailing EOD, locks | 50% on funded payouts | $1,000 (EOD only) | 6 max payouts per account; $85/mo funded fee |
| **Funded Futures Network (FFN)** | Trailing EOD, locks | 40% single-day cap | None | Two-step eval; $126/mo data fee |
| **Alpha Futures** | Trailing EOD | None | None | $0 commissions; smallest firm |
| **Tradeify** | Trailing EOD, locks | None | None | $1.29/side commissions (highest) |
| **Earn2Trade** | Trailing EOD | None | None | 60-day time limit on evaluation |

---

## Integration with Strategy Pipeline

```
Strategy Proposed (by OpenClaw/Ollama)
    │
    ▼
Backtest Engine runs walk-forward + Monte Carlo
    │
    ▼
Compliance Gate checks against ALL 8 firms
    │
    ├── For each firm: freshness check → compliance check → gate decision
    │
    ▼
Compliance Review stored (POST /api/compliance/review)
    │
    ▼
Pre-Session Gate at 9:15 AM ET checks all active strategies
    │
    ├── APPROVED → Strategy signals delivered to trader
    ├── RESTRICTED → Signals with enhanced monitoring warnings
    └── BLOCKED → No signals. Reason logged. Trader notified.
```

---

## Critical Rules

1. **Compliance beats profit.** No strategy runs if current rules are stale, ambiguous, or violated.
2. **Drift blocks everything.** A single content hash mismatch blocks all trading at that firm until a human verifies.
3. **Freshness is non-negotiable.** 24h for active trading, 72h for research, 0h after drift. No exceptions.
4. **The gate is deterministic.** Layer 2 uses pure rule matching. No AI judgment, no probabilistic overrides.
5. **Human is the final authority.** Only a human can verify rulesets, resolve drift, and unblock strategies after drift events.
6. **All 8 firms are always checked.** When a strategy is proposed, it is evaluated against every firm's rules to find the best fit.
