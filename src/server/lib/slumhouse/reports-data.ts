/**
 * GPT trade-critique reports assembler — the Office "Reporting Room" feed.
 *
 * Reads the `trade_critique` table (one autopsy row per closed position) and
 * joins strategy + broker-account context so the Reporting Room can render each
 * GPT critique with its plain-English summary + technical attribution.
 *
 * Every query fail-softs to empty per the Slumhouse read-only contract — mirrors
 * the style in kitchen-data.ts / recipe-data.ts (raw `db.execute(sql\`...\`)`
 * with a `.catch(() => [])`). node-postgres returns jsonb columns already parsed
 * as JS objects, so the two JSONB blocks are consumed as plain objects.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";

export interface GptReport {
  id: string;
  positionId: string;
  accountId: string | null;
  accountLabel: string | null;
  strategy: string;
  symbol: string;
  grade: string;
  realizedR: number | null;
  entryQuality: number | null;
  oneLiner: string;
  whatWentRight: string;
  whatToWatch: string;
  actionNeeded: string;
  attribution: Record<string, number>;
  parameterHint: { field: string; current: string | number | null; suggested: string; confidence: number | null } | null;
  confluenceMissed: string[];
  regimeMismatch: boolean;
  model: string;
  provider: string;
  dataCompleteness: string;
  critiquedAt: string; // ISO
}

export interface ReportsPayload {
  reports: GptReport[];
  accounts: Array<{ id: string; label: string; count: number }>;
  stats: { total: number; lastNight: number; byGrade: Record<string, number> };
}

/**
 * Prettify a firm_id into a display label:
 *   'topstep_50k' → 'Topstep 50K'
 * Underscores become spaces, each word Title-Cased, and a trailing bare "k"
 * (e.g. "50k") is uppercased to "K".
 */
function prettifyFirmId(firmId: string | null | undefined): string | null {
  if (!firmId) return null;
  const words = String(firmId).split("_").filter(Boolean);
  if (words.length === 0) return null;
  return words
    .map((w) => {
      // "50k" / "150k" → "50K" / "150K"
      if (/^\d+k$/i.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

export async function assembleGptReports(opts: { scope: "night" | "all" }): Promise<ReportsPayload> {
  const timeFilter = opts.scope === "night"
    ? sql`AND tc.critiqued_at > NOW() - INTERVAL '24 hours'`
    : sql``;

  const rows = (await db.execute(sql`
    SELECT
      tc.id::text            AS id,
      tc.position_id::text   AS position_id,
      tc.account_id::text    AS account_id,
      tc.critiqued_at        AS critiqued_at,
      tc.grade               AS grade,
      tc.technical_diagnosis AS technical_diagnosis,
      tc.plain_english_summary AS plain_english_summary,
      tc.data_completeness   AS data_completeness,
      tc.provider            AS provider,
      tc.model               AS model,
      s.name                 AS name,
      s.symbols              AS symbols,
      ba.firm_id             AS firm_id
    FROM trade_critique tc
    LEFT JOIN strategies s ON s.id = tc.strategy_id
    LEFT JOIN broker_accounts ba ON ba.account_id = tc.account_id
    WHERE 1 = 1
    ${timeFilter}
    ORDER BY tc.critiqued_at DESC
    LIMIT 200
  `).catch(() => [] as unknown[])) as Array<{
    id: string;
    position_id: string;
    account_id: string | null;
    critiqued_at: string | Date;
    grade: string;
    technical_diagnosis: any;
    plain_english_summary: any;
    data_completeness: string;
    provider: string;
    model: string;
    name: string | null;
    symbols: string[] | null;
    firm_id: string | null;
  }>;

  const reports: GptReport[] = rows.map((r) => {
    const tech = (r.technical_diagnosis ?? {}) as any;
    const plain = (r.plain_english_summary ?? {}) as any;

    const paramHintRaw = tech.parameter_hint ?? null;
    const parameterHint = paramHintRaw
      ? {
          field: String(paramHintRaw.field ?? ""),
          current: paramHintRaw.current ?? null,
          suggested: String(paramHintRaw.suggested_range ?? ""),
          confidence: paramHintRaw.confidence != null ? Number(paramHintRaw.confidence) : null,
        }
      : null;

    return {
      id: String(r.id),
      positionId: String(r.position_id),
      accountId: r.account_id ?? null,
      accountLabel: r.account_id ? prettifyFirmId(r.firm_id) : null,
      strategy: String(r.name || "Strategy"),
      symbol: r.symbols?.[0] || "",
      grade: String(r.grade ?? ""),
      realizedR: tech.realized_r ?? null,
      entryQuality: tech.entry_quality_score ?? null,
      oneLiner: String(plain.one_liner ?? ""),
      whatWentRight: String(plain.what_went_right ?? ""),
      whatToWatch: String(plain.what_to_watch ?? ""),
      actionNeeded: String(plain.action_needed ?? ""),
      attribution: (tech.attribution ?? {}) as Record<string, number>,
      parameterHint,
      confluenceMissed: Array.isArray(tech.confluence_factors_missed) ? tech.confluence_factors_missed : [],
      regimeMismatch: !!tech.regime_mismatch,
      model: String(r.model ?? ""),
      provider: String(r.provider ?? ""),
      dataCompleteness: String(r.data_completeness ?? ""),
      critiquedAt: new Date(r.critiqued_at).toISOString(),
    };
  });

  // Distinct non-null accounts from the returned reports + their label + count.
  const accountMap = new Map<string, { id: string; label: string; count: number }>();
  for (const rep of reports) {
    if (!rep.accountId) continue;
    const existing = accountMap.get(rep.accountId);
    if (existing) {
      existing.count += 1;
    } else {
      accountMap.set(rep.accountId, {
        id: rep.accountId,
        label: rep.accountLabel ?? rep.accountId,
        count: 1,
      });
    }
  }
  const accounts = Array.from(accountMap.values());

  // byGrade computed from the returned reports.
  const byGrade: Record<string, number> = {};
  for (const rep of reports) {
    if (!rep.grade) continue;
    byGrade[rep.grade] = (byGrade[rep.grade] ?? 0) + 1;
  }

  // Total + last-night counts from the whole table (independent of scope filter).
  const statRows = (await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE critiqued_at > NOW() - INTERVAL '24 hours')::int AS last_night
    FROM trade_critique
  `).catch(() => [] as unknown[])) as Array<{ total: number; last_night: number }>;
  const statRow = statRows[0] ?? { total: 0, last_night: 0 };

  return {
    reports,
    accounts,
    stats: {
      total: Number(statRow.total ?? 0),
      lastNight: Number(statRow.last_night ?? 0),
      byGrade,
    },
  };
}
