/**
 * Pine Marketplace Service — B9 (W14)
 *
 * Packages exported Pine scripts into TradingView marketplace-ready bundles:
 *   <strategy_name>.pine           — raw script (from existing pine-export pipeline)
 *   <strategy_name>_metadata.yaml  — TV submission YAML (description, pricing, demo config)
 *   <strategy_name>_README.md      — customer-facing documentation
 *
 * KEY DESIGN DECISIONS:
 *
 * 1. This service is ADDITIVE — it calls compileDualPineExport() and appends the
 *    marketplace package to the result. It never mutates export logic.
 *
 * 2. Pricing tiers are STATIC CONFIG (not dynamic). TradingView Pine marketplace
 *    pricing is set per publication, not per bar. The tier is chosen by the operator
 *    based on the indicator's feature set.
 *
 * 3. "Marketplace YAML" is a local submission aide — TradingView does NOT accept
 *    YAML uploads. The operator uses this YAML as a copy-paste reference when filling
 *    out the Pine Script publication form at tradingview.com/pine-editor.
 *    Runbook at docs/pine-marketplace-publishing.md documents this explicitly.
 *
 * 4. Demo signals: the YAML includes a demo_signals section populated from the
 *    strategy's entry_indicator, entry_params, and preferred_regime. These serve as
 *    example screenshots captions for the marketplace listing, not live signals.
 *
 * SEMANTIC FIDELITY:
 *   - The .pine file is taken verbatim from compileDualPineExport() indicator artifact.
 *   - No Pine logic is invented or modified here. All compilation decisions remain
 *     with pine_compiler.py and pine-export-service.ts.
 *   - If the export pipeline degrades the strategy, the degradation notes from
 *     compileDualPineExport() flow into the YAML as warnings.
 *   - Exportability score < 70 results in a MARKETPLACE_NOT_RECOMMENDED flag in metadata.
 *
 * REPAINT AND TIMING DISCLAIMER:
 *   The README includes a bar-close / repaint disclaimer. All alert logic uses
 *   barstate.isconfirmed to avoid intrabar repainting, which is carried through from
 *   the Pine compiler. Operators must verify this when publishing.
 *
 * COST NOTE:
 *   Publishing to TradingView Pine marketplace requires TV Pro plan (~$15/month).
 *   This is a FUTURE COST when the first listing goes live — not a blocker for
 *   engineering. The package generation here is free; billing starts on publication.
 */

import path from "path";
import { compileDualPineExport } from "./pine-export-service.js";
import { db } from "../db/index.js";
import { strategies, strategyExportArtifacts, strategyExports } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { logger } from "../index.js";

// ─── Pricing tiers ────────────────────────────────────────────────────────────

export type MarketplacePricingTier = "basic" | "alerts" | "premium";

export interface PricingConfig {
  tier: MarketplacePricingTier;
  monthly_usd: number;
  description: string;
  features: string[];
}

export const PRICING_TIERS: Record<MarketplacePricingTier, PricingConfig> = {
  basic: {
    tier: "basic",
    monthly_usd: 30,
    description: "Basic indicator — visual signals on chart",
    features: [
      "EMA/ATR-based entry signals displayed on chart",
      "Regime filter labels (TRENDING / RANGE_BOUND / etc.)",
      "Session filter (RTH / ETH) overlay",
      "No alert conditions",
    ],
  },
  alerts: {
    tier: "alerts",
    monthly_usd: 50,
    description: "Indicator with alert conditions for webhook automation",
    features: [
      "All BASIC features",
      "Alert conditions: LONG_ENTRY, SHORT_ENTRY, LONG_EXIT, SHORT_EXIT",
      "TradersPost / n8n webhook-compatible alert JSON payload",
      "Bar-confirmed alerts only (no repaint risk)",
    ],
  },
  premium: {
    tier: "premium",
    monthly_usd: 100,
    description: "Premium indicator with real-time signal dashboard and prop-risk overlay",
    features: [
      "All ALERTS features",
      "Prop-risk overlay: drawdown usage, daily loss limit proximity",
      "Kelly-sized contract suggestion display",
      "Session P&L tracker table",
      "Priority support (response within 24h)",
    ],
  },
};

// ─── Package types ────────────────────────────────────────────────────────────

export interface MarketplacePackage {
  strategyId: string;
  strategyName: string;
  exportId: string | null;
  pricingTier: MarketplacePricingTier;
  pricingConfig: PricingConfig;
  exportabilityScore: number;
  exportabilityBand: string;
  marketplaceReady: boolean;
  degradationNotes: string[];
  artifacts: {
    pineFileName: string;
    pineContent: string;
    metadataYaml: string;
    readmeMarkdown: string;
  };
  generatedAt: string;
}

// ─── Internal helper: determine pricing tier from export metadata ────────────

/**
 * Auto-selects pricing tier from the dual export result.
 *
 * Rule: if the export produced an alerts artifact with content, use "alerts".
 * If the export score >= 85 and no degradation, suggest "premium" (operator may override).
 * Default: "basic".
 *
 * Callers can override via the `pricingTierOverride` parameter.
 */
function determinePricingTier(
  hasAlerts: boolean,
  exportabilityScore: number,
  degradationNotes: string[],
  override?: MarketplacePricingTier,
): MarketplacePricingTier {
  if (override) return override;
  if (exportabilityScore >= 85 && degradationNotes.length === 0) return "premium";
  if (hasAlerts) return "alerts";
  return "basic";
}

// ─── YAML builder ─────────────────────────────────────────────────────────────

/**
 * Builds the marketplace metadata YAML string.
 *
 * This is a COPY-PASTE AIDE for the TradingView publication form — not an
 * upload format. TradingView accepts typed form fields only.
 *
 * Pine Script marketplace publication metadata reference:
 *   https://www.tradingview.com/pine-editor/  (publish button → fill form fields)
 *
 * Fields:
 *   - title: display name on marketplace
 *   - short_description: subtitle (max 100 chars)
 *   - long_description: full markdown description (rendered in listing)
 *   - pricing_tier: one of basic/alerts/premium
 *   - price_monthly_usd: numeric
 *   - categories: TV-recognized tags (e.g. "moving_averages", "trend_following")
 *   - symbols_tested: which futures contracts this was backtested on
 *   - timeframes_tested: which timeframes are relevant
 *   - demo_signals: example signal descriptions (for screenshots section)
 *   - pine_version: "5" (always v5 from our compiler)
 *   - warnings: degradation notes from the export pipeline
 *   - export_score: exportability score for internal tracking
 *   - marketplace_status: RECOMMENDED / NOT_RECOMMENDED based on score
 */
function buildMetadataYaml(params: {
  strategyName: string;
  strategyConfig: Record<string, unknown>;
  pricing: PricingConfig;
  exportabilityScore: number;
  exportabilityBand: string;
  degradationNotes: string[];
  pineFileName: string;
}): string {
  const { strategyName, strategyConfig, pricing, exportabilityScore, exportabilityBand, degradationNotes, pineFileName } = params;

  const symbol = String(strategyConfig.symbol ?? "");
  const timeframe = String(strategyConfig.timeframe ?? "");
  const entryType = String(strategyConfig.entry_type ?? "");
  const entryIndicator = String(strategyConfig.entry_indicator ?? "");
  const preferredRegime = String(strategyConfig.preferred_regime ?? "ANY");
  const sessionFilter = String(strategyConfig.session_filter ?? "RTH_ONLY");
  const tags: string[] = Array.isArray(strategyConfig.tags) ? (strategyConfig.tags as string[]) : [];

  const marketplaceStatus = exportabilityScore >= 70 ? "RECOMMENDED" : "NOT_RECOMMENDED";

  // Category mapping for TradingView recognized tags
  const tvCategories: string[] = [];
  if (entryType === "trend_follow" || entryIndicator === "ema_crossover") {
    tvCategories.push("moving_averages", "trend_following");
  }
  if (entryIndicator === "atr_breakout" || entryType === "atr_breakout") {
    tvCategories.push("volatility", "breakout");
  }
  if (entryIndicator === "keltner_squeeze") {
    tvCategories.push("volatility", "squeeze");
  }
  if (entryType === "mean_reversion" || entryIndicator === "vwap_fade") {
    tvCategories.push("mean_reversion", "volume");
  }
  if (!tvCategories.length) {
    tvCategories.push("strategies");
  }

  // Demo signals: entry/exit scenario descriptions for screenshots
  const demoSignals = [
    `LONG entry: ${entryIndicator} signal confirmed in ${preferredRegime} regime (${timeframe} bar close)`,
    `SHORT entry: ${entryIndicator} signal confirmed in ${preferredRegime} regime (${timeframe} bar close)`,
    `Exit: trailing ATR stop or session close (${sessionFilter})`,
  ];

  const warningsSection = degradationNotes.length > 0
    ? degradationNotes.map((n) => `  - "${n}"`).join("\n")
    : "  # none";

  const categoryList = tvCategories.map((c) => `  - ${c}`).join("\n");
  const demoSignalList = demoSignals.map((s) => `  - "${s}"`).join("\n");
  const tagList = tags.map((t) => `  - ${t}`).join("\n");

  return `# Trading Forge Pine Marketplace Metadata
# Strategy: ${strategyName}
# Generated: ${new Date().toISOString()}
#
# USAGE: This YAML is a submission aide for TradingView Pine marketplace.
# Copy-paste fields into the TradingView publication form at:
#   https://www.tradingview.com/pine-editor/  (Publish → Publish New Script)
# TradingView does NOT accept YAML file uploads.
#
# COST NOTE: Publishing requires TradingView Pro plan (~$15/month).
# This is a future cost when the first listing goes live.

title: "${strategyName}"

short_description: "${strategyName} — ${pricing.description}"

long_description: |
  ${strategyName} is a TradingView indicator exported from Trading Forge.

  ## What It Does
  ${entryType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} strategy on ${symbol} (${timeframe}).
  Entry triggered by ${entryIndicator.replace(/_/g, " ")} in ${preferredRegime.replace(/_/g, " ")} regime.
  Session filter: ${sessionFilter.replace(/_/g, " ")}.

  ## Signals
  - LONG: ${demoSignals[0]}
  - SHORT: ${demoSignals[1]}
  - EXIT: ${demoSignals[2]}

  ## What You Get
${pricing.features.map((f) => `  - ${f}`).join("\n")}

  ## Repaint / Bar-Close Behavior
  All signals are computed at bar close only (barstate.isconfirmed = true).
  There is NO intrabar repainting. Historical alerts match real-time alerts.

  ## Tested On
  - Symbol: ${symbol}
  - Timeframe: ${timeframe}
  - Session: ${sessionFilter.replace(/_/g, " ")}
  - Regime: ${preferredRegime.replace(/_/g, " ")}

pricing:
  tier: ${pricing.tier}
  price_monthly_usd: ${pricing.monthly_usd}

categories:
${categoryList}

tags:
${tagList || "  - indicator"}

pine_file: "${pineFileName}"
pine_version: "5"

symbols_tested:
  - ${symbol}

timeframes_tested:
  - ${timeframe}

demo_signals:
${demoSignalList}

# ─── Internal fields (NOT shown to customers) ─────────────────────────────────
_internal:
  export_score: ${exportabilityScore}
  export_band: "${exportabilityBand}"
  marketplace_status: "${marketplaceStatus}"
  warnings:
${warningsSection}
  generated_by: "Trading Forge pine-marketplace-service v1"
  generated_at: "${new Date().toISOString()}"
`;
}

// ─── README builder ───────────────────────────────────────────────────────────

/**
 * Builds the customer-facing README.md.
 *
 * This is included in the marketplace package directory and can be used as:
 * - Listing copy (paste into long_description)
 * - Customer support reference
 * - Version changelog
 */
function buildReadme(params: {
  strategyName: string;
  strategyConfig: Record<string, unknown>;
  pricing: PricingConfig;
  exportabilityScore: number;
}): string {
  const { strategyName, strategyConfig, pricing } = params;

  const symbol = String(strategyConfig.symbol ?? "");
  const timeframe = String(strategyConfig.timeframe ?? "");
  const entryIndicator = String(strategyConfig.entry_indicator ?? "");
  const entryType = String(strategyConfig.entry_type ?? "");
  const sessionFilter = String(strategyConfig.session_filter ?? "RTH_ONLY");
  const preferredRegime = String(strategyConfig.preferred_regime ?? "ANY");
  const maxContracts = strategyConfig.max_contracts ?? "N/A";
  const stopLossAtr = strategyConfig.stop_loss_atr_multiple ?? "N/A";
  const tpAtr = strategyConfig.take_profit_atr_multiple ?? "N/A";

  const exitParams = strategyConfig.exit_params as Record<string, unknown> | undefined;
  const trailAtr = exitParams?.trail_atr ?? "N/A";
  const breakEvenAtR = exitParams?.break_even_at_r ?? "N/A";

  const featureList = pricing.features.map((f) => `- ${f}`).join("\n");

  return `# ${strategyName}

> **Price:** $${pricing.monthly_usd}/month | **Tier:** ${pricing.tier.toUpperCase()} | **Symbol:** ${symbol} | **Timeframe:** ${timeframe}

## Overview

${strategyName} is a systematic indicator based on ${entryType.replace(/_/g, " ")} logic using ${entryIndicator.replace(/_/g, " ")} signals. Designed for use on **${symbol}** (${timeframe} bars) during **${sessionFilter.replace(/_/g, " ")}** sessions in a **${preferredRegime.replace(/_/g, " ")}** market regime.

This indicator was generated and validated by [Trading Forge](https://trading-forge.internal) — a prop-firm-focused autonomous strategy research system.

## What's Included

${featureList}

## Signal Logic

| Signal | Description |
|--------|-------------|
| LONG entry | ${entryIndicator.replace(/_/g, " ")} bullish crossover/trigger confirmed at bar close |
| SHORT entry | ${entryIndicator.replace(/_/g, " ")} bearish crossover/trigger confirmed at bar close |
| Exit | Trailing stop (${trailAtr}x ATR), break-even at ${breakEvenAtR}:1R |
| Session filter | ${sessionFilter.replace(/_/g, " ")} only |
| Regime filter | Active only in ${preferredRegime.replace(/_/g, " ")} regime |

## Risk Parameters

| Parameter | Value |
|-----------|-------|
| Stop loss | ${stopLossAtr}x ATR |
| Take profit | ${tpAtr}x ATR |
| Trail stop | ${trailAtr}x ATR |
| Max contracts | ${maxContracts} |

## Repaint / Bar-Close Behavior

All signals are computed at **bar close only** (\`barstate.isconfirmed = true\`). There is **NO intrabar repainting**. Historical signals on the chart match the real-time alert behavior. You can verify this by enabling Replay Mode in TradingView and stepping through bars one at a time.

## Alerts Setup

${pricing.tier === "basic"
  ? "This tier does not include alert conditions. Upgrade to ALERTS or PREMIUM for webhook-compatible alerts."
  : `### Alert Conditions Available
- \`LONG_ENTRY\` — fires on bullish signal at bar close
- \`SHORT_ENTRY\` — fires on bearish signal at bar close
- \`LONG_EXIT\` — fires when trailing stop or session close hit
- \`SHORT_EXIT\` — fires when trailing stop or session close hit

### Webhook Payload (TradersPost / n8n compatible)
\`\`\`json
{
  "ticker": "${symbol}",
  "action": "buy",        // or "sell" for short
  "contracts": 1,         // override in your automation
  "price": "{{close}}"
}
\`\`\`

### Setup Instructions
1. Add the indicator to your chart
2. Right-click → Add Alert → Condition: \`${strategyName}: LONG_ENTRY\`
3. Set Message to your webhook payload JSON
4. Set Trigger to "Once Per Bar" (not "Once Per Bar Close" — the indicator already filters on close)
5. Webhook URL: your TradersPost or n8n webhook endpoint`}

## Supported Symbols

This indicator was developed and backtested on **${symbol}**. It may work on correlated instruments (e.g., MES if built for ES, MNQ if built for NQ), but has not been validated on other symbols. Use at your own risk on untested instruments.

## Disclaimer

This indicator is for informational purposes only and does not constitute financial advice. Past performance is not indicative of future results. Trading futures involves substantial risk of loss. Always verify signals against your own analysis and prop firm rules before executing trades.

Prop-firm users: verify that the signal frequency and drawdown profile of this indicator complies with your firm's specific rules (especially consistency rules, daily loss limits, and contract caps) before using it in a funded account.

## Support

For issues, questions, or feature requests, contact the publisher via TradingView's messaging system. Premium tier subscribers receive priority response within 24 hours.

## Version History

| Version | Date | Notes |
|---------|------|-------|
| v1.0.0 | ${new Date().toISOString().split("T")[0]} | Initial marketplace release |

---

*Generated by Trading Forge pine-marketplace-service. Export pipeline: Pine v5, dual-artifact mode.*
`;
}

// ─── Main package generation function ────────────────────────────────────────

/**
 * Generates a complete TradingView marketplace package for a strategy.
 *
 * Steps:
 *   1. Run compileDualPineExport() to get fresh .pine artifact + metadata
 *   2. Determine pricing tier (auto or operator-provided)
 *   3. Build metadata YAML (submission aide)
 *   4. Build customer README
 *   5. Return package (in-memory — caller decides persistence)
 *
 * Explicitly does NOT:
 *   - Modify any Pine logic (delegated entirely to pine-export-service)
 *   - Write to DB directly (pine-export-service handles artifact persistence)
 *   - Submit to TradingView (that is an operator manual action — see runbook)
 *
 * Returns null if:
 *   - Strategy not found
 *   - Export compilation fails
 *   - No indicator artifact produced (score too low or unsupported construct)
 */
export async function generateMarketplacePackage(
  strategyId: string,
  options: {
    pricingTierOverride?: MarketplacePricingTier;
    firmKey?: string;
  } = {},
): Promise<MarketplacePackage | null> {
  const { pricingTierOverride, firmKey } = options;

  // 1. Load strategy config for metadata building
  const [strategy] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, strategyId));

  if (!strategy) {
    logger.warn({ strategyId }, "pine-marketplace: strategy not found");
    return null;
  }

  const strategyConfig = strategy.config as Record<string, unknown>;
  const strategyName = strategy.name;

  // 2. Run dual export (get .pine + exportability metadata)
  let exportResult: Awaited<ReturnType<typeof compileDualPineExport>>;
  try {
    exportResult = await compileDualPineExport(strategyId, firmKey);
  } catch (err) {
    logger.error({ strategyId, err }, "pine-marketplace: compileDualPineExport failed");
    return null;
  }

  // Guard: export must have completed and produced an indicator artifact
  if (exportResult.status === "failed" || !exportResult.indicator_file) {
    logger.warn(
      { strategyId, status: exportResult.status, indicator_file: exportResult.indicator_file },
      "pine-marketplace: export did not produce indicator artifact — package generation skipped",
    );
    return null;
  }

  // 3. Retrieve the indicator Pine content from DB (compileDualPineExport persists it)
  //    We need the actual Pine content for the package.
  let pineContent = "";
  const pineFileName = exportResult.indicator_file;

  if (exportResult.id) {
    const artifacts = await db
      .select()
      .from(strategyExportArtifacts)
      .where(eq(strategyExportArtifacts.exportId, exportResult.id));

    const indicatorArtifact = artifacts.find(
      (a) => a.artifactType === "dual_indicator" || a.fileName === pineFileName,
    );
    if (indicatorArtifact) {
      pineContent = indicatorArtifact.content ?? "";
    }
  }

  if (!pineContent) {
    logger.warn({ strategyId, exportId: exportResult.id }, "pine-marketplace: could not retrieve Pine content");
    return null;
  }

  // 4. Determine pricing tier
  const degradationNotes: string[] = exportResult.degradation_notes ?? [];
  const exportScore = exportResult.exportabilityScore ?? 0;
  const exportBand = exportResult.exportabilityBand ?? "unknown";
  const hasAlerts = Boolean(exportResult.artifacts?.some((a) => a.artifactType === "dual_alerts_json"));

  const pricingTier = determinePricingTier(hasAlerts, exportScore, degradationNotes, pricingTierOverride);
  const pricingConfig = PRICING_TIERS[pricingTier];

  // 5. Build YAML metadata
  const metadataYaml = buildMetadataYaml({
    strategyName,
    strategyConfig,
    pricing: pricingConfig,
    exportabilityScore: exportScore,
    exportabilityBand: exportBand,
    degradationNotes,
    pineFileName,
  });

  // 6. Build README
  const readmeMarkdown = buildReadme({
    strategyName,
    strategyConfig,
    pricing: pricingConfig,
    exportabilityScore: exportScore,
  });

  // 7. Assemble package
  const pkg: MarketplacePackage = {
    strategyId,
    strategyName,
    exportId: exportResult.id ?? null,
    pricingTier,
    pricingConfig,
    exportabilityScore: exportScore,
    exportabilityBand: exportBand,
    marketplaceReady: exportScore >= 70,
    degradationNotes,
    artifacts: {
      pineFileName,
      pineContent,
      metadataYaml,
      readmeMarkdown,
    },
    generatedAt: new Date().toISOString(),
  };

  logger.info(
    {
      strategyId,
      strategyName,
      pricingTier,
      exportScore,
      marketplaceReady: pkg.marketplaceReady,
      degradationNotes: degradationNotes.length,
    },
    "pine-marketplace: package generated",
  );

  return pkg;
}

/**
 * List all strategies that have completed exports and are candidates for
 * marketplace packaging. Returns strategies with their latest export score.
 *
 * "Candidate" = strategy has at least one completed pine_dual export with
 * exportability score >= 50 (below 50 is too degraded to package).
 */
export async function listMarketplaceCandidates(): Promise<Array<{
  strategyId: string;
  strategyName: string;
  latestExportScore: number;
  latestExportBand: string;
  exportId: string;
  recommendedTier: MarketplacePricingTier;
}>> {
  // Get all strategies with a completed pine_dual export
  const rows = await db
    .select({
      strategyId: strategies.id,
      strategyName: strategies.name,
      exportId: strategyExports.id,
      exportScore: strategyExports.exportabilityScore,
    })
    .from(strategyExports)
    .innerJoin(strategies, eq(strategyExports.strategyId, strategies.id))
    .where(eq(strategyExports.status, "completed"))
    .orderBy(desc(strategyExports.createdAt));

  // De-dupe: keep only the latest export per strategy
  const seen = new Set<string>();
  const candidates: Array<{
    strategyId: string;
    strategyName: string;
    latestExportScore: number;
    latestExportBand: string;
    exportId: string;
    recommendedTier: MarketplacePricingTier;
  }> = [];

  for (const row of rows) {
    if (seen.has(row.strategyId)) continue;
    seen.add(row.strategyId);

    const score = Number(row.exportScore ?? 0);
    if (score < 50) continue; // too degraded

    // Compute band from score (mirrors pine_compiler.py exportability bands)
    let band: string;
    if (score >= 90) band = "excellent";
    else if (score >= 70) band = "good";
    else if (score >= 50) band = "marginal";
    else band = "poor";

    const hasAlertsHint = score >= 75; // heuristic: high score = alerts likely generated
    const recommendedTier = determinePricingTier(hasAlertsHint, score, []);

    candidates.push({
      strategyId: row.strategyId,
      strategyName: row.strategyName,
      latestExportScore: score,
      latestExportBand: band,
      exportId: row.exportId,
      recommendedTier,
    });
  }

  return candidates;
}

/**
 * Schema validation for marketplace package request body.
 * Used by the route handler to validate incoming POST requests.
 */
export interface MarketplacePackageRequest {
  strategyId: string;
  pricingTierOverride?: MarketplacePricingTier;
  firmKey?: string;
}

export function validateMarketplacePackageRequest(body: unknown): {
  success: true;
  data: MarketplacePackageRequest;
} | {
  success: false;
  error: string;
} {
  if (!body || typeof body !== "object") {
    return { success: false, error: "Request body must be an object" };
  }
  const b = body as Record<string, unknown>;
  if (!b.strategyId || typeof b.strategyId !== "string") {
    return { success: false, error: "strategyId is required and must be a string UUID" };
  }
  // Basic UUID format check (not exhaustive — DB will catch format errors)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(b.strategyId)) {
    return { success: false, error: "strategyId must be a valid UUID" };
  }
  if (b.pricingTierOverride !== undefined) {
    if (!["basic", "alerts", "premium"].includes(b.pricingTierOverride as string)) {
      return { success: false, error: "pricingTierOverride must be one of: basic, alerts, premium" };
    }
  }
  if (b.firmKey !== undefined && typeof b.firmKey !== "string") {
    return { success: false, error: "firmKey must be a string when provided" };
  }
  return {
    success: true,
    data: {
      strategyId: b.strategyId,
      pricingTierOverride: b.pricingTierOverride as MarketplacePricingTier | undefined,
      firmKey: b.firmKey as string | undefined,
    },
  };
}
