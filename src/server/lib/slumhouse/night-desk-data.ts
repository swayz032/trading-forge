import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { learningLoopModeLabel, readLearningLoopMode } from "../learning-loop-mode.js";
import { assembleGptReports, type GptReport } from "./reports-data.js";

type NightlyCritique = {
  period_reviewed?: string;
  strategies_generated?: number;
  strategies_passed?: number;
  pass_rate?: number;
  top_concept?: string;
  worst_concept?: string;
  pattern_insights?: string[];
  parameter_insights?: string[];
  regime_insights?: string[];
  recommendations?: string[];
  confidence?: "high" | "medium" | "low";
};

export interface NightDeskPayload {
  generatedAt: string;
  learningLoop: {
    mode: 0 | 1 | 2;
    label: "OFF" | "OBSERVE" | "AUTOPILOT";
    advisoryOn: boolean;
    autonomousOn: boolean;
  };
  latest: {
    id: string;
    status: string;
    completedAt: string;
    durationMs: number | null;
    provider: string | null;
    model: string | null;
    serviceTier: string | null;
    cachedTokens: number;
    critique: NightlyCritique;
  } | null;
  nights: Array<{
    id: string;
    status: string;
    completedAt: string;
    durationMs: number | null;
    provider: string | null;
    model: string | null;
    serviceTier: string | null;
    cachedTokens: number;
    critique: NightlyCritique | null;
  }>;
  intelligence: {
    recordedAt: string;
    payload: Record<string, unknown>;
  } | null;
  reviews: GptReport[];
  reviewStats: { total: number; lastNight: number; byGrade: Record<string, number> };
  changes: Array<{
    id: string;
    kind: "test" | "parameter";
    name: string;
    status: string;
    happenedAt: string;
    detail: string;
  }>;
  health: {
    state: "complete" | "waiting" | "degraded";
    message: string;
    sources: Record<string, "ok" | "missing" | "error">;
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return objectValue(value);
  try { return objectValue(JSON.parse(value)); } catch { return {}; }
}

function critiqueValue(value: unknown): NightlyCritique {
  const raw = parseJsonObject(value);
  return {
    period_reviewed: typeof raw.period_reviewed === "string" ? raw.period_reviewed : undefined,
    strategies_generated: Number.isFinite(Number(raw.strategies_generated)) ? Number(raw.strategies_generated) : undefined,
    strategies_passed: Number.isFinite(Number(raw.strategies_passed)) ? Number(raw.strategies_passed) : undefined,
    pass_rate: Number.isFinite(Number(raw.pass_rate)) ? Number(raw.pass_rate) : undefined,
    top_concept: typeof raw.top_concept === "string" ? raw.top_concept : undefined,
    worst_concept: typeof raw.worst_concept === "string" ? raw.worst_concept : undefined,
    pattern_insights: Array.isArray(raw.pattern_insights) ? raw.pattern_insights.map(String) : [],
    parameter_insights: Array.isArray(raw.parameter_insights) ? raw.parameter_insights.map(String) : [],
    regime_insights: Array.isArray(raw.regime_insights) ? raw.regime_insights.map(String) : [],
    recommendations: Array.isArray(raw.recommendations) ? raw.recommendations.map(String) : [],
    confidence: raw.confidence === "high" || raw.confidence === "medium" || raw.confidence === "low" ? raw.confidence : undefined,
  };
}

export async function assembleNightDesk(): Promise<NightDeskPayload> {
  const failed = new Set<string>();
  const loop = await readLearningLoopMode();

  const parameterRows = await db.execute(sql`
    SELECT id::text, current_value::text, description, updated_at
    FROM system_parameters
    WHERE param_name = 'nightly_critique_latest'
    LIMIT 1
  `).catch(() => { failed.add("factory_brief"); return [] as unknown[]; }) as any[];

  const runRows = await db.execute(sql`
    SELECT id::text, status, duration_ms, result, created_at
    FROM audit_log
    WHERE action = 'nightly_critique.complete'
    ORDER BY created_at DESC
    LIMIT 14
  `).catch(() => { failed.add("night_history"); return [] as unknown[]; }) as any[];

  const modelRows = await db.execute(sql`
    SELECT result, created_at
    FROM audit_log
    WHERE result->>'role' = 'nightly_review'
    ORDER BY created_at DESC
    LIMIT 14
  `).catch(() => { failed.add("model_receipt"); return [] as unknown[]; }) as any[];

  const modelReceiptFor = (at: Date): Record<string, unknown> => {
    const match = modelRows.find((row) => {
      const diff = at.getTime() - new Date(row.created_at).getTime();
      return diff >= 0 && diff <= 15 * 60 * 1000;
    });
    return objectValue(match?.result);
  };

  const nights = runRows.map((row) => {
    const result = objectValue(row.result);
    const completedAt = new Date(row.created_at);
    const receipt = modelReceiptFor(completedAt);
    const fullCritique = result.critique ? critiqueValue(result.critique) : null;
    return {
      id: String(row.id),
      status: String(row.status ?? "complete"),
      completedAt: completedAt.toISOString(),
      durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
      provider: typeof result.provider === "string" ? result.provider : null,
      model: typeof receipt.model === "string" ? receipt.model : null,
      serviceTier: typeof receipt.serviceTier === "string" ? receipt.serviceTier : null,
      cachedTokens: Number.isFinite(Number(receipt.cachedTokens)) ? Number(receipt.cachedTokens) : 0,
      critique: fullCritique,
    };
  });

  const latestParam = parameterRows[0];
  const latestCritique = latestParam ? critiqueValue(latestParam.description) : null;
  const latestNight = nights[0] ?? null;
  const latest = latestCritique ? {
    id: latestNight?.id ?? `latest-${String(latestParam.current_value ?? "0")}`,
    status: latestNight?.status ?? "complete",
    completedAt: latestNight?.completedAt ?? new Date(latestParam.updated_at).toISOString(),
    durationMs: latestNight?.durationMs ?? null,
    provider: latestNight?.provider ?? null,
    model: latestNight?.model ?? null,
    serviceTier: latestNight?.serviceTier ?? null,
    cachedTokens: latestNight?.cachedTokens ?? 0,
    critique: latestNight?.critique ?? latestCritique,
  } : null;

  const intelligenceRows = await db.execute(sql`
    SELECT analyst_notes, created_at
    FROM system_journal
    WHERE source = '14a_nightly_intelligence'
    ORDER BY created_at DESC
    LIMIT 1
  `).catch(() => { failed.add("night_intelligence"); return [] as unknown[]; }) as any[];
  const intelligenceRow = intelligenceRows[0];
  const intelligencePayload = parseJsonObject(intelligenceRow?.analyst_notes);
  const intelligence = intelligenceRow && Object.keys(intelligencePayload).length > 0 ? {
    recordedAt: new Date(intelligenceRow.created_at).toISOString(),
    payload: intelligencePayload,
  } : null;

  const reports = await assembleGptReports({ scope: "night" }).catch(() => {
    failed.add("trade_reviews");
    return { reports: [], accounts: [], stats: { total: 0, lastNight: 0, byGrade: {} }, degraded: true };
  });
  if (reports.degraded) failed.add("trade_reviews");

  const testRows = await db.execute(sql`
    SELECT id::text, prompt_type, status, winner, started_at, ended_at
    FROM prompt_ab_tests
    ORDER BY COALESCE(ended_at, started_at) DESC
    LIMIT 20
  `).catch(() => { failed.add("change_tests"); return [] as unknown[]; }) as any[];
  const parameterChangeRows = await db.execute(sql`
    SELECT h.id::text, p.param_name, h.previous_value::text, h.new_value::text,
           h.reason, h.source, h.created_at
    FROM system_parameter_history h
    JOIN system_parameters p ON p.id = h.param_id
    ORDER BY h.created_at DESC
    LIMIT 20
  `).catch(() => { failed.add("parameter_changes"); return [] as unknown[]; }) as any[];

  const changes: NightDeskPayload["changes"] = [
    ...testRows.map((row) => ({
      id: String(row.id), kind: "test" as const, name: String(row.prompt_type),
      status: String(row.status), happenedAt: new Date(row.ended_at ?? row.started_at).toISOString(),
      detail: row.winner ? `Test finished. Winner: ${String(row.winner)}.` : "This proposed change is still being tested.",
    })),
    ...parameterChangeRows.map((row) => ({
      id: String(row.id), kind: "parameter" as const, name: String(row.param_name),
      status: "applied", happenedAt: new Date(row.created_at).toISOString(),
      detail: `${String(row.previous_value)} to ${String(row.new_value)}. ${String(row.reason ?? row.source ?? "Recorded change.")}`,
    })),
  ].sort((a, b) => b.happenedAt.localeCompare(a.happenedAt)).slice(0, 30);

  const hasAnyEvidence = Boolean(latest || intelligence || reports.reports.length || changes.length);
  return {
    generatedAt: new Date().toISOString(),
    learningLoop: {
      mode: loop.mode,
      label: learningLoopModeLabel(loop.mode),
      advisoryOn: loop.advisoryOn,
      autonomousOn: loop.autonomousOn,
    },
    latest,
    nights,
    intelligence,
    reviews: reports.reports,
    reviewStats: reports.stats,
    changes,
    health: {
      state: failed.size ? "degraded" : hasAnyEvidence ? "complete" : "waiting",
      message: failed.size
        ? "Some night records could not be read. The room is not calling that a quiet night."
        : hasAnyEvidence
          ? "The latest saved night records loaded correctly."
          : "No completed night has been saved yet.",
      sources: {
        factoryBrief: failed.has("factory_brief") ? "error" : latest ? "ok" : "missing",
        nightHistory: failed.has("night_history") ? "error" : nights.length ? "ok" : "missing",
        intelligence: failed.has("night_intelligence") ? "error" : intelligence ? "ok" : "missing",
        tradeReviews: failed.has("trade_reviews") ? "error" : reports.reports.length ? "ok" : "missing",
        changes: failed.has("change_tests") || failed.has("parameter_changes") ? "error" : changes.length ? "ok" : "missing",
      },
    },
  };
}
