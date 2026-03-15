# Prop Firm Compliance Architecture

> **The right setup:** OpenClaw watches the official prop-firm docs and flags drift.
> Trading Forge enforces a deterministic rule engine. No strategy is allowed to run
> if the current rules are stale, ambiguous, or violated.

---

## Why This Exists

Prop firms change rules without warning. Topstep publishes consistency-target and
maximum-loss-limit rules. Take Profit Trader PRO bans bots/algos and has
prohibited-news flat rules. Alpha publishes separate docs for maximum loss,
consistency, news, and prohibited practices.

Trading against stale rules is an account-killing mistake that no amount of edge
can fix. This architecture prevents that.

---

## Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: OpenClaw Compliance Guard (Monitor + Alert)   │
│                                                         │
│  - Fetches official prop-firm documentation             │
│  - Normalizes rules into structured JSON                │
│  - Detects drift (content hash comparison)              │
│  - Produces compliance reviews per strategy per firm    │
│  - Alerts operator on rule changes                      │
│  - DOES NOT execute or block trades directly            │
│                                                         │
│  System prompt: src/agents/OPENCLAW_COMPLIANCE_GUARD.md │
│  Orchestration: n8n workflows                           │
│  Model: Ollama (local)                                  │
└──────────────────────────┬──────────────────────────────┘
                           │ structured compliance JSON
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 2: Trading Forge Rule Engine (Enforce)           │
│                                                         │
│  - Consumes compliance JSON from OpenClaw               │
│  - Enforces hard gates: no trade if stale/fail/review   │
│  - Checks ruleset_max_age_hours before every session    │
│  - Blocks strategies that fail compliance               │
│  - Logs all gate decisions to audit_log                  │
│  - Deterministic — no AI judgment, pure rule matching   │
│                                                         │
│  Code: src/engine/compliance/                           │
│  API: /api/compliance/*                                 │
│  DB: compliance_rulesets, compliance_reviews             │
└──────────────────────────┬──────────────────────────────┘
                           │ STALE / DRIFT / AMBIGUOUS
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 3: Human Operator (Approve)                      │
│                                                         │
│  - Receives alerts when rules change                    │
│  - Reviews OpenClaw's diff output                       │
│  - Approves updated rulesets                            │
│  - Unblocks strategies after review                     │
│  - Final authority on ambiguous rules                   │
│                                                         │
│  Interface: Dashboard alerts + n8n notifications        │
└─────────────────────────────────────────────────────────┘
```

### Why This Split Matters

- **OpenClaw is useful as a compliance sidecar**, but its own security model is a
  personal-assistant / one-trusted-operator boundary, not a shared multi-tenant
  control plane. It should not be your only enforcement layer.

- **The rule engine is deterministic.** It doesn't interpret. It reads the compliance
  JSON and applies boolean gates. If `ruleset_status != "verified"`, strategy is blocked.
  No exceptions.

- **The human is the final authority.** When firms publish ambiguous or conflicting
  rules, no AI should make the call. The operator reviews and approves.

---

## Ruleset Freshness Gate

The single most important addition. Prevents stale-doc stupidity.

```yaml
ruleset_max_age_hours:
  active_trading: 24     # Block if rules older than 24h for live/paper trading
  research_only: 72      # Warn if rules older than 72h for backtesting/research
  after_drift_detected: 0  # Immediate block until human revalidates
```

### How It Works

```
Before any strategy execution:
  1. Load compliance_rulesets for the target firm
  2. Check retrieved_at timestamp
  3. Calculate age_hours = NOW() - retrieved_at
  4. If context == "active_trading" AND age_hours > 24:
       → BLOCK. "Ruleset for {firm} is {age_hours}h old. Maximum 24h for active trading."
  5. If context == "research_only" AND age_hours > 72:
       → WARN. "Ruleset for {firm} is {age_hours}h old. Results may not reflect current rules."
  6. If drift_detected == true:
       → BLOCK. "Rule drift detected for {firm}. Awaiting human revalidation."
```

---

## Data Flow

### Rule Ingestion (OpenClaw → DB)

```
1. OpenClaw fetches official firm docs (URLs in system prompt)
2. Parses and normalizes into structured JSON
3. Computes content_hash of raw document
4. Compares to stored content_hash in compliance_rulesets
5. If changed:
   a. Generates diff (old rules vs new rules)
   b. Marks firm as STALE_PENDING_REVIEW
   c. Stores new raw content + normalized rules
   d. Alerts operator via n8n notification
6. If unchanged:
   a. Updates retrieved_at timestamp
   b. Status remains VERIFIED
```

### Strategy Compliance Review (OpenClaw → DB → Rule Engine)

```
1. Strategy promoted to PAPER or LIVE
2. Rule engine loads compliance_rulesets for target firm
3. Checks freshness gate (ruleset_max_age_hours)
4. If fresh → OpenClaw runs strategy compliance review
5. OpenClaw evaluates:
   - Drawdown behavior vs firm limits
   - Overnight holding vs firm policy
   - Automation vs firm automation policy
   - Consistency vs firm consistency rules
   - News sensitivity vs firm news rules
   - Best-day concentration vs consistency thresholds
6. OpenClaw returns compliance JSON
7. Rule engine stores in compliance_reviews
8. Rule engine applies gate:
   - PASS → strategy approved for target firm
   - FAIL → strategy blocked, violations listed
   - REVIEW → strategy blocked, escalated to human
```

### Pre-Session Gate (Daily, 9:15 AM ET)

```
1. Load all strategies scheduled for today
2. For each strategy:
   a. Check ruleset freshness for target firm
   b. Check today's news calendar against firm news rules
   c. Check flatten requirements (Alpha: must flatten before close)
   d. Check blackout windows (firm-specific)
3. Output per-strategy gate decision:
   - APPROVED: trade normally
   - RESTRICTED: trade with constraints (e.g., reduced size near news)
   - BLOCKED: do not trade (stale rules, news blackout, etc.)
```

---

## Database Schema

### compliance_rulesets

Stores the normalized rules for each firm, with freshness tracking.

```sql
CREATE TABLE compliance_rulesets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm TEXT NOT NULL,                        -- topstep | tpt | mffu | apex | ffn | alpha | tradeify | earn2trade
  account_type TEXT NOT NULL,                -- e.g. "50k_standard" | "100k_advanced"
  status TEXT NOT NULL DEFAULT 'verified',   -- verified | stale_pending_review | stale_or_ambiguous | needs_human_review
  source_bundle JSONB NOT NULL,              -- array of {title, url, retrieved_at_utc, effective_date, official}
  content_hash TEXT NOT NULL,                -- SHA-256 of raw source content
  normalized_rules JSONB NOT NULL,           -- structured rules object
  drift_detected BOOLEAN DEFAULT false,
  drift_diff JSONB,                          -- diff when drift detected
  retrieved_at TIMESTAMPTZ NOT NULL,         -- when rules were last fetched
  verified_by TEXT,                          -- 'openclaw' | 'human' | null
  verified_at TIMESTAMPTZ,                  -- when human approved (if applicable)
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(firm, account_type)
);

CREATE INDEX idx_compliance_firm ON compliance_rulesets (firm);
CREATE INDEX idx_compliance_status ON compliance_rulesets (status);
CREATE INDEX idx_compliance_retrieved ON compliance_rulesets (retrieved_at);
```

### compliance_reviews

Stores per-strategy, per-firm compliance review results.

```sql
CREATE TABLE compliance_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES strategies(id),
  firm TEXT NOT NULL,
  account_type TEXT NOT NULL,
  ruleset_id UUID REFERENCES compliance_rulesets(id),
  compliance_result TEXT NOT NULL,           -- pass | fail | review
  risk_score INTEGER,                        -- 0-100
  violations JSONB DEFAULT '[]',
  warnings JSONB DEFAULT '[]',
  required_changes JSONB DEFAULT '[]',
  reasoning_summary TEXT,
  execution_gate JSONB NOT NULL,             -- {approved, blocker_type, blocker_reason}
  reviewed_by TEXT NOT NULL,                 -- 'openclaw' | 'human'
  expires_at TIMESTAMPTZ,                    -- review expires when rules change
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_review_strategy ON compliance_reviews (strategy_id);
CREATE INDEX idx_review_firm ON compliance_reviews (firm);
CREATE INDEX idx_review_result ON compliance_reviews (compliance_result);
```

### compliance_drift_log

Tracks every detected rule change across all firms.

```sql
CREATE TABLE compliance_drift_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_url TEXT NOT NULL,
  old_content_hash TEXT,
  new_content_hash TEXT,
  diff JSONB NOT NULL,                       -- structured diff of what changed
  severity TEXT NOT NULL,                    -- info | warning | critical
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,                          -- human operator name/id
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_drift_firm ON compliance_drift_log (firm);
CREATE INDEX idx_drift_resolved ON compliance_drift_log (resolved);
```

---

## API Routes

```
# Rulesets
GET    /api/compliance/rulesets                — All firm rulesets + freshness status
GET    /api/compliance/rulesets/:firm          — Specific firm ruleset
POST   /api/compliance/rulesets/:firm/refresh  — Trigger OpenClaw to re-fetch rules
PATCH  /api/compliance/rulesets/:id/verify     — Human approves updated ruleset
GET    /api/compliance/rulesets/freshness      — Freshness check for all firms

# Strategy Reviews
POST   /api/compliance/review                 — Run compliance review for strategy + firm
GET    /api/compliance/review/:strategy_id     — All reviews for a strategy
GET    /api/compliance/review/:strategy_id/:firm — Review for strategy at specific firm

# Session Gates
GET    /api/compliance/gate/today              — Today's per-strategy gate decisions
GET    /api/compliance/gate/:strategy_id       — Gate status for specific strategy

# Drift Monitoring
GET    /api/compliance/drift                   — All drift events
GET    /api/compliance/drift/unresolved        — Unresolved drift events
PATCH  /api/compliance/drift/:id/resolve       — Mark drift as resolved

# Dashboard
GET    /api/compliance/status                  — Overall compliance health dashboard
```

---

## n8n Workflows

### 1. Daily Compliance Check (9:00 AM ET)

```yaml
trigger: cron "0 9 * * 1-5"
nodes:
  - name: fetch_all_firm_docs
    action: "For each firm, fetch official doc URLs"
    tool: "HTTP Request node"

  - name: compare_content_hash
    action: "SHA-256 current content vs stored content_hash"
    tool: "Code node"

  - name: if_changed
    action: "Generate diff, mark STALE_PENDING_REVIEW, alert operator"
    tool: "IF node → Slack/Discord/Email notification"

  - name: if_unchanged
    action: "Update retrieved_at timestamp, mark VERIFIED"
    tool: "HTTP Request → PATCH /api/compliance/rulesets/:id"

  - name: check_freshness
    action: "GET /api/compliance/rulesets/freshness"
    tool: "HTTP Request node"

  - name: block_if_stale
    action: "If any firm stale, send critical alert"
    tool: "IF node → notification"
```

### 2. Pre-Session Gate (9:15 AM ET)

```yaml
trigger: cron "15 9 * * 1-5"
nodes:
  - name: load_today_strategies
    action: "GET /api/strategies?status=active"

  - name: check_compliance_gate
    action: "GET /api/compliance/gate/today"

  - name: route_decisions
    action: "For each strategy: APPROVED → proceed | BLOCKED → notify + skip"

  - name: check_news_calendar
    action: "Fetch today's economic calendar, compare to firm news rules"

  - name: notify_operator
    action: "Summary: X strategies approved, Y blocked, Z restricted"
```

### 3. Weekly Full Re-Parse (Sunday 8:00 PM ET)

```yaml
trigger: cron "0 20 * * 0"
nodes:
  - name: force_refresh_all
    action: "POST /api/compliance/rulesets/:firm/refresh for each firm"

  - name: run_openclaw_full_parse
    action: "OpenClaw re-reads all docs, re-normalizes all rules"

  - name: diff_against_stored
    action: "Compare new normalized_rules vs stored normalized_rules"

  - name: generate_weekly_report
    action: "Compliance health report: fresh/stale/changed per firm"

  - name: notify_operator
    action: "Weekly compliance report delivered"
```

---

## Integration with Existing Systems

### prop-firm-rules.md (Existing)

`docs/prop-firm-rules.md` remains the **static reference** — the baseline rules
as of last manual review. OpenClaw uses this as a starting point and then checks
official docs for drift.

```
prop-firm-rules.md = manually maintained baseline (March 2026 snapshot)
compliance_rulesets DB = live, auto-refreshed, drift-monitored rules
```

If OpenClaw detects that a firm's official docs differ from `prop-firm-rules.md`,
it produces a diff and flags both the DB ruleset AND the static file for human review.

### Survival Optimizer (Phase 4.12)

The survival optimizer loads compliance data from the rule engine, not from
the static file:

```
Survival Optimizer → GET /api/compliance/rulesets/:firm → normalized_rules
  → Uses drawdown_type, consistency_rule, daily_loss_limit
  → Calculates survival score against LIVE rules, not stale snapshot
```

### Strategy Promotion Pipeline

```
Current:  Backtest → Walk-Forward → Monte Carlo → Forge Score → Deploy
New:      Backtest → Walk-Forward → Monte Carlo → Forge Score
          → Survival Score (Phase 4.12)
          → Compliance Review (this system)
          → Deploy

If compliance_result == "fail": BLOCKED. Cannot promote.
If compliance_result == "review": BLOCKED. Escalated to human.
If compliance_result == "pass" AND ruleset_status == "verified": APPROVED.
```

### Skip Engine (Phase 4.11)

The skip engine checks compliance before deciding to trade:

```
Skip Engine pre-session check:
  1. GET /api/compliance/gate/today
  2. If any firm's ruleset is stale → SKIP (cannot verify compliance)
  3. If today has news blackout for firm → SKIP or RESTRICT
  4. If strategy's compliance review expired → SKIP until re-reviewed
```

---

## Firm-Specific Compliance Hazards

These are the specific rule shapes that differ materially between firms
and that OpenClaw must monitor closely:

| Firm | Hazard | Why It Matters |
|------|--------|----------------|
| **Topstep** | Consistency target + max loss limit changes | They've changed rules multiple times in 2024-2025 |
| **TPT** | PRO bans bots/algos, prohibited-news flat rules | Automation policy is strict and can change |
| **Alpha** | Separate docs for max loss, consistency, news, prohibited practices | Rules are scattered across multiple pages |
| **Apex** | 20-account scaling + 100% first $25K changes | Payout rules have changed multiple times |
| **FFN** | Express 15% consistency + $126/mo data fee | Consistency rule is unusually tight |
| **MFFU** | Trailing DD locks at starting balance | Simplest rules but verify locking behavior |
| **Tradeify** | Real-time trailing (not EOD) | Only firm with intraday trailing — massive difference |

---

## Key Principle

> OpenClaw monitors. The engine enforces. Nobody gets cute with rule drift.
>
> The compliance layer has to read current docs, not rely on memory.
> Because the major firms really do have materially different rule shapes,
> and those shapes change without notice.
