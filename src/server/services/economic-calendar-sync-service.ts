/**
 * economic-calendar-sync-service.ts — Authoritative macro release-date sync (2026-06-22).
 *
 * ROOT-CAUSE FIX. The Tier-1 news blackout dates were hardcoded static lists, and several
 * (notably FOMC) were PROJECTED by shifting the prior year's calendar forward — i.e. WRONG
 * (code FOMC 2026 had May 6/Nov 4/Dec 16 vs the Fed's published Apr 29/Oct 28/Dec 9). We
 * have the authoritative government APIs in .env the whole time (FRED/BLS/EIA). This service
 * pulls real release dates from them into `economic_release_dates` (migration 0172), refreshed
 * monthly + at boot. The blackout consumers read from there; the hardcoded lists are only a
 * fail-safe fallback when the table is empty/stale (a compliance gate must never silently open).
 *
 * Sources:
 *   • FRED /fred/release/dates (FRED_API_KEY) — NFP (release_id 50), CPI (10), PPI (46),
 *     GDP (53). Future scheduled dates as BLS/BEA publish them. FRED returns dates only out
 *     to the published horizon (e.g. 2027 NFP is empty until BLS releases the 2027 schedule).
 *   • Federal Reserve published FOMC calendar — FOMC announce dates (stable, 2yr ahead) +
 *     FOMC_MINUTES (exactly 3 weeks / 21 days later, 14:00 ET). Verified against
 *     federalreserve.gov/monetarypolicy/fomccalendars.htm (2026-06-22).
 *   • EIA crude-oil-inventory schedule (Wed 10:30 ET, holiday→Thu 11:00) — from the generated
 *     list (eia-dates.ts) until the EIA release-schedule API is wired (carry-forward).
 *
 * Fail-safe: each source is fetched independently; a source failure logs + skips and leaves
 * existing rows intact (UPSERT, never DELETE). A total failure leaves the prior good rows.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { logger } from "../lib/logger.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { EIA_EVENTS } from "../lib/eia-dates.js";

// FRED release_id → (event_type, time_et). Only the events we actually gate on / track.
const FRED_RELEASES: Array<{ releaseId: number; eventType: string; timeEt: string }> = [
  { releaseId: 50, eventType: "NFP", timeEt: "08:30" }, // Employment Situation
  { releaseId: 10, eventType: "CPI", timeEt: "08:30" }, // Consumer Price Index
  { releaseId: 46, eventType: "PPI", timeEt: "08:30" }, // Producer Price Index (data only — not T1 blackout)
  { releaseId: 53, eventType: "GDP", timeEt: "08:30" }, // GDP (data only — not T1 blackout)
];

// Federal Reserve published FOMC announce dates (the rate decision is the 2nd meeting day).
// Verified against the Fed's official calendar 2026-06-22. 14:00 ET. Stable (published 2yr
// ahead) — these are AUTHORITATIVE, not projected. FOMC_MINUTES are computed as +21 days.
export const FOMC_ANNOUNCE_DATES: string[] = [
  // 2024 (historical — verified vs federalreserve.gov; backtests need history)
  "2024-01-31", "2024-03-20", "2024-05-01", "2024-06-12",
  "2024-07-31", "2024-09-18", "2024-11-07", "2024-12-18",
  // 2025 (historical — verified)
  "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18",
  "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-10",
  // 2026
  "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
  "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
  // 2027 (Fed publishes these; tentative until confirmed)
  "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09",
  "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08",
];

// Historical anchor — sync from here forward so the DB has past dates for BACKTESTS
// (which run on history) as well as future dates for the live gate. FRED returns
// historical release dates; FOMC history is the hardcoded verified set above.
const HISTORICAL_ANCHOR = "2024-01-01";

interface ReleaseRow {
  eventType: string;
  releaseDate: string; // YYYY-MM-DD
  timeEt: string;
  source: string;
  affectsProducts?: string | null;
}

/** Add N days to a YYYY-MM-DD date string, returning YYYY-MM-DD (UTC-safe, no Date.now). */
export function addDays(dateStr: string, days: number): string {
  const ms = Date.parse(`${dateStr}T00:00:00.000Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Fetch FRED release dates for one release_id over [start, end]. Returns [] on any failure. */
async function fetchFredReleaseDates(
  releaseId: number,
  apiKey: string,
  startDate: string,
  endDate: string,
): Promise<string[]> {
  const url =
    `https://api.stlouisfed.org/fred/release/dates?release_id=${releaseId}` +
    `&api_key=${apiKey}&file_type=json&include_release_dates_with_no_data=true` +
    `&realtime_start=${startDate}&realtime_end=${endDate}&sort_order=asc&limit=200`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) {
      logger.warn({ releaseId, status: res.status }, "FRED release_dates non-200 — skipping (keep existing rows)");
      return [];
    }
    const json = (await res.json()) as { release_dates?: Array<{ date: string }> };
    return (json.release_dates ?? []).map((r) => r.date).filter(Boolean);
  } catch (err) {
    logger.warn({ releaseId, err }, "FRED release_dates fetch failed — skipping (keep existing rows)");
    return [];
  }
}

/**
 * Sync authoritative macro release dates into economic_release_dates.
 * @param opts.startDate / endDate — horizon (default: today → +18 months). Pass explicit
 *   dates in tests/replay (no Date.now in the pure parts).
 */
export async function runEconomicCalendarSync(opts?: {
  startDate?: string;
  endDate?: string;
  nowMs?: number;
}): Promise<{ upserted: number; bySource: Record<string, number>; sources: string[] }> {
  const nowMs = opts?.nowMs ?? Date.now();
  const startDate = opts?.startDate ?? HISTORICAL_ANCHOR; // history for backtests + future for live
  const endDate = opts?.endDate ?? new Date(nowMs + 550 * 86_400_000).toISOString().slice(0, 10); // ~18 mo

  const rows: ReleaseRow[] = [];
  const sourcesOk: string[] = [];

  // ── FRED: NFP / CPI / PPI / GDP ──────────────────────────────────────────
  const fredKey = process.env.FRED_API_KEY;
  if (fredKey) {
    for (const rel of FRED_RELEASES) {
      const dates = await fetchFredReleaseDates(rel.releaseId, fredKey, startDate, endDate);
      if (dates.length > 0) {
        sourcesOk.push(`fred:${rel.eventType}`);
        for (const d of dates) {
          rows.push({ eventType: rel.eventType, releaseDate: d, timeEt: rel.timeEt, source: "fred" });
        }
      }
    }
  } else {
    logger.warn("FRED_API_KEY not set — FRED sync skipped (NFP/CPI fall back to hardcoded)");
  }

  // ── Federal Reserve: FOMC + FOMC_MINUTES (authoritative, computed) ───────────
  for (const d of FOMC_ANNOUNCE_DATES) {
    if (d >= startDate && d <= endDate) {
      rows.push({ eventType: "FOMC", releaseDate: d, timeEt: "14:00", source: "fed" });
    }
    const minutes = addDays(d, 21); // minutes released exactly 3 weeks later, 14:00 ET
    if (minutes >= startDate && minutes <= endDate) {
      rows.push({ eventType: "FOMC_MINUTES", releaseDate: minutes, timeEt: "14:00", source: "fed" });
    }
  }
  sourcesOk.push("fed:FOMC");

  // ── EIA crude inventories (generated Wed 10:30 / holiday Thu 11:00) ──────────
  // Product-scoped to crude. TODO: wire the EIA release-schedule API (EIA_API_KEY) to
  // replace the generated list. Until then this is the best available EIA source.
  for (const e of EIA_EVENTS) {
    if (e.date >= startDate && e.date <= endDate) {
      rows.push({
        eventType: "EIA",
        releaseDate: e.date,
        timeEt: e.time_et,
        source: "eia_generated",
        affectsProducts: "MCL,CL,QM",
      });
    }
  }
  sourcesOk.push("eia:generated");

  // ── Upsert (fail-safe: never delete; conflict updates time/source/fetched_at) ──
  let upserted = 0;
  const bySource: Record<string, number> = {};
  for (const r of rows) {
    try {
      await db.execute(sql`
        INSERT INTO economic_release_dates (event_type, release_date, time_et, source, affects_products, fetched_at)
        VALUES (${r.eventType}, ${r.releaseDate}, ${r.timeEt}, ${r.source}, ${r.affectsProducts ?? null}, NOW())
        ON CONFLICT (event_type, release_date)
        DO UPDATE SET time_et = EXCLUDED.time_et, source = EXCLUDED.source,
                      affects_products = EXCLUDED.affects_products, fetched_at = NOW()
      `);
      upserted++;
      bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    } catch (err) {
      logger.error({ err, row: r }, "economic_release_dates upsert failed for one row");
    }
  }

  // Write a JSON snapshot for the Python BACKTEST path (the tower Python has no psycopg2,
  // so it can't read the DB). economic_calendar.py reads this file (hardcoded fallback if
  // missing) → backtest dates == live dates. Best-effort; failure does not fail the sync.
  try {
    const { writeFileSync } = await import("fs");
    writeFileSync(
      "src/engine/economic_release_dates.json",
      JSON.stringify(
        {
          generatedHorizon: { startDate, endDate },
          sources: sourcesOk,
          events: rows.map((r) => ({ event_type: r.eventType, date: r.releaseDate, time_et: r.timeEt })),
        },
        null,
        0,
      ),
    );
  } catch (err) {
    logger.warn({ err }, "failed to write economic_release_dates.json snapshot — backtest uses hardcoded fallback");
  }

  await insertAuditRowSafe({
    action: "economic_calendar.synced",
    status: "info",
    entityType: "economic_release_dates",
    decisionAuthority: "system",
    result: { startDate, endDate, upserted, bySource, sources: sourcesOk } as Record<string, unknown>,
  });

  logger.info({ upserted, bySource, sources: sourcesOk }, "Economic calendar sync complete");
  return { upserted, bySource, sources: sourcesOk };
}
