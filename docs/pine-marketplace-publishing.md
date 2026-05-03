# Pine Marketplace Publishing Runbook

**Version:** 1.0 (B9 / W14)
**Owner:** Pine Export pipeline
**Last updated:** 2026-04-30

---

## Purpose

This runbook documents the end-to-end process for publishing a Trading Forge strategy as a paid TradingView Pine Script indicator. This is an independent income channel that does not depend on prop-firm trading performance.

**Income model:**
| Tier | Price | Target buyer |
|------|-------|--------------|
| Basic | $30/month | Retail traders who want chart signals |
| Alerts | $50/month | Traders using TradersPost / n8n for semi-automation |
| Premium | $100/month | Pro traders who want prop-risk overlays + signals |

At 10 buyers on the Alerts tier: $500/month passive. At 50: $2,500/month. No ongoing work beyond initial publication.

**Cost to publish:** TradingView Pro plan (~$15/month). This is a future cost when the first listing goes live — not a blocker for package generation. Engineering is free.

---

## Prerequisites

- [ ] Strategy has reached DEPLOY_READY or DEPLOYED lifecycle state
- [ ] Pine dual export completed with exportability score >= 70 (`GET /api/pine-export/:id`)
- [ ] Marketplace package generated (see Step 1 below)
- [ ] TradingView account with Pro plan (for publication access)
- [ ] Screenshots captured from TradingView chart (see Step 4)

---

## Step 1 — Generate the Marketplace Package

Use the internal admin endpoint to generate the marketplace package.

### Via API (curl)

```bash
# Generate package for a strategy (get strategyId from GET /api/strategies)
curl -X POST http://localhost:4000/api/pine-marketplace/package/<strategyId> \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Optional: override pricing tier or target a specific prop firm overlay:

```bash
curl -X POST http://localhost:4000/api/pine-marketplace/package/<strategyId> \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pricingTierOverride": "alerts", "firmKey": "topstep_50k"}'
```

### Response

The response contains three artifacts:

```json
{
  "package": {
    "strategyName": "Trend Follow MNQ RTH",
    "pricingTier": "alerts",
    "pricingConfig": { "monthly_usd": 50, ... },
    "exportabilityScore": 88,
    "marketplaceReady": true,
    "degradationNotes": [],
    "artifacts": {
      "pineFileName": "trend_follow_mnq_rth_INDICATOR.pine",
      "pineContent": "...",        // full Pine Script
      "metadataYaml": "...",       // copy-paste aide for TV form
      "readmeMarkdown": "..."      // customer-facing docs
    }
  }
}
```

### Automated Trigger

Package generation also fires automatically (fire-and-forget, non-blocking) after every successful `POST /api/pine-export/compile` with `exportType: "pine_dual"`. The SSE event `pine:marketplace-package-ready` signals completion. You do not need to call the package endpoint manually if you just triggered a dual export.

### List Available Candidates

To see which strategies are ready for marketplace publishing:

```bash
curl http://localhost:4000/api/pine-marketplace/listings \
  -H "Authorization: Bearer $API_KEY"
```

---

## Step 2 — Save Package Files Locally

TradingView does NOT accept YAML or file uploads. You need to copy-paste fields from the package artifacts into the TradingView publication form. Save the artifacts locally first:

```bash
# Create a local package directory
mkdir -p ~/pine-packages/<strategy_slug>/

# Save Pine script
echo '<pineContent from API response>' > ~/pine-packages/<strategy_slug>/<fileName>.pine

# Save metadata YAML (your copy-paste reference)
echo '<metadataYaml from API response>' > ~/pine-packages/<strategy_slug>/metadata.yaml

# Save README (customer docs — also paste into TV long_description)
echo '<readmeMarkdown from API response>' > ~/pine-packages/<strategy_slug>/README.md
```

Keep these files version-controlled in a separate private repo or local folder. They are NOT committed to the Trading Forge repo (contain strategy IP).

---

## Step 3 — Open Pine Script Editor and Paste

1. Go to [https://www.tradingview.com/pine-editor/](https://www.tradingview.com/pine-editor/)
2. Create a new script (or open an existing draft)
3. Select all existing content and delete it
4. Paste the full content of your `.pine` file
5. Click "Add to chart" to verify it renders without errors
6. Check the chart: signals should appear on historical bars. If no signals appear, check that your test symbol and timeframe match the strategy's `symbol` and `timeframe` fields.

**Verify no repaint:** Enable TradingView Replay Mode, step through bars one at a time, and confirm signals appear exactly at bar close (not earlier).

---

## Step 4 — Capture Screenshots

TradingView requires at least 1 screenshot for a marketplace listing. The YAML's `demo_signals` section contains caption text for screenshots.

Recommended screenshots:
1. **LONG signal** — zoom in on a bar where a LONG_ENTRY fired, show the signal label
2. **SHORT signal** — same for SHORT
3. **Full view** — a 3-month chart showing overall signal density and drawdown profile
4. **Prop-risk table** (Premium tier only) — show the on-chart drawdown/P&L table

Save screenshots to `~/pine-packages/<strategy_slug>/screenshots/`.

---

## Step 5 — Publish to TradingView Marketplace

1. In Pine Script Editor, click **Publish** (top right) → **Publish New Script**
2. Fill in the form fields using your `metadata.yaml` as reference:

| TV Form Field | Source |
|---------------|--------|
| Title | `title` in YAML |
| Short description | `short_description` in YAML |
| Long description | `long_description` in YAML (or paste README.md content) |
| Access type | **Paid** (requires Pro account) |
| Price | `price_monthly_usd` from pricing tier |
| Categories | `categories` list in YAML |
| Tags | `tags` list in YAML |
| Screenshots | Captured in Step 4 |

3. Set access: **Invite-only** initially (lets you test the subscription flow before going public)
4. Click **Publish**

---

## Step 6 — Test Subscription Flow

Before making the listing public:

1. Subscribe to your own indicator with a second TradingView account (or use a test account)
2. Verify the indicator appears in the subscriber's Pine Script library
3. Add it to a chart and verify signals render correctly
4. If alerts tier: set up an alert condition and verify it fires
5. Switch to **Public** once the flow is confirmed

---

## Step 7 — Manage Versions

When the strategy is updated and re-exported:

1. Generate a new marketplace package (Step 1)
2. Paste the new Pine content into the existing published script
3. Click **Publish** → **Update Published Script**
4. Add a version note in the description (e.g., "v1.1.0 — improved regime filter")
5. Update the `README.md` version history table

Subscribers are NOT notified of updates automatically by TradingView. Consider posting in the TradingView "Script Comments" section to announce updates.

---

## Customer Support Flow

TradingView subscriber messages arrive via TradingView's built-in chat.

### Common questions and answers

**"The signals don't match what I see in historical data"**
All signals are bar-confirmed (`barstate.isconfirmed = true`). If a signal appears mid-bar in your chart, you may have a non-confirmed bar rendering. Refresh the chart and check again.

**"I'm not getting alerts"**
Ensure the alert is set to "Once Per Bar" trigger, not "Once Per Bar Close" (our indicator already filters on close). The alert condition name must match exactly (e.g., `Trend Follow MNQ RTH: LONG_ENTRY`).

**"The indicator doesn't work on my symbol"**
This indicator was developed and validated specifically on [SYMBOL]. Other symbols are not supported. Using it on a different symbol or timeframe may produce meaningless signals.

**"Can you add [feature]?"**
Premium tier subscribers get priority responses. Feature requests are evaluated quarterly. To request a feature, describe the use case and why it would improve the indicator.

### Escalation

For serious complaints (e.g., claims of data error, refund requests), respond within 24h (Premium) or 72h (Basic/Alerts). TradingView handles refunds directly — direct the subscriber to TradingView support for billing issues.

---

## Pricing Tier Decision Guide

| Scenario | Recommended Tier |
|----------|-----------------|
| Indicator is visual-only, no alert support in Pine | Basic ($30) |
| Indicator has alert conditions in Pine | Alerts ($50) |
| Indicator has alerts + prop-risk overlay table | Premium ($100) |
| Exportability score < 70 | Do NOT publish — fix export issues first |
| Heavy degradation notes in package | Do NOT publish — review degradation |

The `metadata.yaml` `_internal.marketplace_status` field shows `RECOMMENDED` or `NOT_RECOMMENDED` based on export score. Never publish a `NOT_RECOMMENDED` package without operator review.

---

## Repaint Risk Statement

All Trading Forge indicator exports use `barstate.isconfirmed = true` for all signal logic. This means:

- Signals appear ONLY after a bar closes — not while the bar is forming
- Historical signal positions are IDENTICAL to real-time signal positions
- There is no intrabar repainting

This is verifiable by the subscriber using TradingView's Replay Mode (bar-by-bar playback). Include this statement in the listing description.

---

## Revenue Tracking

TradingView marketplace revenue is tracked in the TV account dashboard. Update your accounting records monthly. This income is independent of prop-firm payouts and does not affect account evaluations.

Target milestones:
- 1 subscriber → proof of concept
- 5 subscribers → $150–$500/month depending on tier mix
- 20 subscribers → meaningful passive income ($600–$2,000/month)
- 50 subscribers → material passive income ($1,500–$5,000/month)

---

## Troubleshooting

### Package generation returns 404
Strategy not found or the dual export failed. Check:
1. `GET /api/strategies` — confirm strategy exists and is not in GRAVEYARD state
2. `GET /api/pine-export/:id` — check the latest export status and exportability score
3. Server logs for `pine-marketplace` component errors

### Package generation returns 423
Pipeline is paused. Resume the pipeline (`POST /api/admin/pipeline`) and retry.

### Pine script has compilation errors in TV editor
The Pine compiler produced a script with a syntax error that was not caught locally. Report the specific error message alongside the strategy name to the pine-export-service maintainer. Do NOT publish a script with compilation errors.

### Exportability score < 70
The strategy uses constructs that cannot be faithfully translated to Pine. Check the `deductions` array in the export result for specifics. Common causes:
- Complex multi-timeframe logic (not supported in indicator mode)
- Order execution semantics (stop-limit, partial fills)
- Intrabar logic that requires strategy mode

For strategies with score 50–69: consider publishing to Alerts tier with a disclaimer that the indicator approximates the full strategy logic.

For strategies with score < 50: do NOT publish. Fix the Pine compatibility issues first or use a different strategy.

---

## Files Reference

| File | Purpose |
|------|---------|
| `src/server/services/pine-marketplace-service.ts` | Package generation logic |
| `src/server/routes/pine-marketplace.ts` | Admin API endpoints |
| `src/server/services/pine-export-service.ts` | Underlying Pine compiler pipeline |
| `docs/pine-marketplace-publishing.md` | This runbook |

**API endpoints:**
- `GET /api/pine-marketplace/listings` — list marketplace candidates
- `POST /api/pine-marketplace/package/:strategyId` — generate package
- `GET /api/pine-marketplace/pricing-tiers` — pricing tier definitions
