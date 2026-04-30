import { db } from "../db/index.js";
import { sql } from "drizzle-orm";

export async function computeCosts(since?: Date) {
  const sinceDate = since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days

  // Data provider costs (Databento) — dataSyncJobs.costUsd column
  let databentoCost = 0;
  try {
    const [ds] = await db.execute(sql`
      SELECT coalesce(sum(cost_usd::numeric), 0) as total
      FROM data_sync_jobs
      WHERE created_at >= ${sinceDate}
    `);
    databentoCost = Number((ds as any)?.total ?? 0);
  } catch { /* table/column may not exist yet */ }

  // Quantum costs (AWS Braket) — quantumMcRuns.cloudCostDollars column
  let quantumCost = 0;
  try {
    const [qc] = await db.execute(sql`
      SELECT coalesce(sum(cloud_cost_dollars::numeric), 0) as total
      FROM quantum_mc_runs
      WHERE created_at >= ${sinceDate}
    `);
    quantumCost = Number((qc as any)?.total ?? 0);
  } catch { /* table/column may not exist yet */ }

  // AI inference costs (estimate from tokens) — ai_inference_log may not exist yet
  let aiTokenCost = 0;
  try {
    const [ai] = await db.execute(sql`
      SELECT
        coalesce(sum(prompt_tokens), 0) as total_prompt,
        coalesce(sum(completion_tokens), 0) as total_completion
      FROM ai_inference_log
      WHERE created_at >= ${sinceDate}
    `);
    const promptTokens = Number((ai as any)?.total_prompt ?? 0);
    const completionTokens = Number((ai as any)?.total_completion ?? 0);
    // GPT-5-mini pricing estimate: $0.15/1M input, $0.60/1M output
    aiTokenCost = (promptTokens * 0.15 / 1_000_000) + (completionTokens * 0.60 / 1_000_000);
  } catch { /* table may not exist yet */ }

  // Compute hours (backtest execution time) — backtests.executionTimeMs column
  let computeHours = 0;
  try {
    const [ch] = await db.execute(sql`
      SELECT coalesce(sum(execution_time_ms), 0) as total_ms
      FROM backtests
      WHERE created_at >= ${sinceDate} AND status = 'completed'
    `);
    computeHours = Number((ch as any)?.total_ms ?? 0) / 3_600_000;
  } catch { /* table may not exist yet */ }

  return {
    period: { since: sinceDate.toISOString(), until: new Date().toISOString() },
    costs: {
      databento: { usd: Math.round(databentoCost * 100) / 100, label: "Data provider (Databento)" },
      quantum: { usd: Math.round(quantumCost * 100) / 100, label: "Cloud quantum (AWS Braket)" },
      ai: { usd: Math.round(aiTokenCost * 100) / 100, label: "AI inference (GPT-5-mini)" },
      compute: { hours: Math.round(computeHours * 100) / 100, label: "Compute (backtest CPU hours)" },
    },
    totalUsd: Math.round((databentoCost + quantumCost + aiTokenCost) * 100) / 100,
  };
}
