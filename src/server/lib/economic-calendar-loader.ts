/**
 * economic-calendar-loader.ts — reads AUTHORITATIVE macro release dates from
 * economic_release_dates (synced from FRED/Fed/EIA) for the live Tier-1 news gate.
 *
 * Wave hardening 2026-06-23. This points the live blackout at the authoritative table
 * instead of the hardcoded lists (which were partly projected/wrong). Cached (6h TTL) so
 * the hot signal path doesn't hit the DB every bar. FAIL-SAFE: if the table is empty or the
 * read fails, falls back to the hardcoded TIER1_EVENTS + EIA_EVENTS so the compliance gate
 * NEVER silently opens. The economic-calendar-sync cron keeps the table fresh.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { logger } from "./logger.js";
import { isUsDst } from "./dst-utils.js";
import {
  eventAffectsSymbol,
  NEWS_ENTRY_BLOCK_BEFORE_MIN,
  NEWS_ENTRY_BLOCK_AFTER_MIN,
} from "./news-policy.js";
import { TIER1_EVENTS } from "./tier1-event-blackout.js";
import { EIA_EVENTS } from "./eia-dates.js";

interface ReleaseRow {
  eventType: string;
  date: string; // YYYY-MM-DD (ET)
  timeEt: string; // HH:MM
  // deep-scan market-data F-1: per-row provenance so the MATCHED window reports where ITS date came from
  // (authoritative DB vs hardcoded gap-fill), rather than a whole-set flag that flips to "fallback" the
  // moment any single type is gap-filled.
  origin: "db" | "fallback";
}

let _cache: ReleaseRow[] | null = null;
let _cacheAtMs = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — release dates change at most monthly

/** Hardcoded fail-safe calendar (universal T1 + EIA), used when the DB is empty/unreachable. */
function fallbackRows(): ReleaseRow[] {
  const rows: ReleaseRow[] = [];
  for (const e of TIER1_EVENTS) rows.push({ eventType: e.event_type, date: e.date, timeEt: e.time_et, origin: "fallback" });
  for (const e of EIA_EVENTS) rows.push({ eventType: "EIA", date: e.date, timeEt: e.time_et, origin: "fallback" });
  return rows;
}

async function getRows(nowMs: number): Promise<{ rows: ReleaseRow[]; source: "db" | "fallback" }> {
  if (_cache && nowMs - _cacheAtMs < CACHE_TTL_MS) return { rows: _cache, source: "db" };
  try {
    const res = (await db.execute(
      sql`SELECT event_type, release_date::text AS date, time_et FROM economic_release_dates`,
    )) as unknown as Array<{ event_type: string; date: string; time_et: string }>;
    const rows = res.map((r) => ({ eventType: r.event_type, date: r.date, timeEt: r.time_et, origin: "db" as const }));
    // deep-scan market-data F-1 (CRITICAL, 2026-07-06): the old logic used DB rows whenever the table had ANY
    // rows, and only fell back to the hardcoded calendar when the table was ENTIRELY empty. But the sync cron
    // inserts FOMC + EIA UNCONDITIONALLY while NFP/CPI/GDP/PPI/ISM are inserted only when FRED_API_KEY is set +
    // the FRED call succeeds. So the moment FRED is unset/expired/rate-limited/outage, the table still has
    // FOMC+EIA rows → the all-or-nothing branch used DB-only → NFP/CPI/GDP/PPI Tier-1 blackout SILENTLY dropped
    // to zero (MFFU-restricted-news trades slip through with no alert). FIX: gap-fill PER EVENT TYPE — DB wins
    // for any type it covers (authoritative dates); the hardcoded TIER1_EVENTS/EIA fallback fills any Tier-1
    // type the DB is MISSING ENTIRELY, so coverage can never silently collapse. Over-blocking on a projected
    // fallback date is the safe direction for a compliance gate; under-blocking (the old bug) is not.
    const dbTypes = new Set(rows.map((r) => r.eventType.toUpperCase()));
    const gapFill = fallbackRows().filter((r) => !dbTypes.has(r.eventType.toUpperCase()));
    const merged = gapFill.length > 0 ? [...rows, ...gapFill] : rows;
    if (merged.length > 0) {
      _cache = merged;
      _cacheAtMs = nowMs;
      if (gapFill.length > 0) {
        const missingTypes = [...new Set(gapFill.map((r) => r.eventType))].join(",");
        logger.warn(
          { missingTypes, dbTypeCount: dbTypes.size },
          "economic_release_dates MISSING Tier-1 event types — gap-filled from hardcoded fallback so the news " +
            "blackout can't silently open. Run economic-calendar-sync with a valid FRED_API_KEY to restore " +
            "authoritative dates for: " + missingTypes,
        );
      }
      // source="fallback" whenever ANY type was gap-filled — signals the dates are not fully authoritative.
      return { rows: merged, source: gapFill.length > 0 ? "fallback" : "db" };
    }
    logger.warn("economic_release_dates is EMPTY — using hardcoded fallback calendar (run economic-calendar-sync)");
    return { rows: fallbackRows(), source: "fallback" };
  } catch (err) {
    logger.error({ err }, "economic_release_dates read failed — using hardcoded fallback calendar (fail-safe)");
    return _cache ? { rows: _cache, source: "db" } : { rows: fallbackRows(), source: "fallback" };
  }
}

/** Test-only: clear the in-process cache so a mocked DB result isn't masked. */
export function __resetEconomicCalendarCacheForTests(): void {
  _cache = null;
  _cacheAtMs = 0;
}

export interface T1WindowResult {
  inWindow: boolean;
  eventType: string; // "" when not in window
  source: "db" | "fallback";
}

/**
 * Is the bar inside a Tier-1 release window for THIS symbol? Authoritative DB dates with
 * hardcoded fallback. Product-scoped (EIA→crude, CPI/NFP→index, FOMC→all) via
 * eventAffectsSymbol. Asymmetric entry window [T−5min, T+2min] (operator's choice).
 * DST-correct ET conversion. Pure aside from the cached DB read.
 */
export async function getT1ReleaseWindow(
  symbol: string,
  barTimestampUtc: string,
  nowMs?: number,
): Promise<T1WindowResult> {
  const now = nowMs ?? Date.now();
  const { rows, source } = await getRows(now);

  let barDate: Date;
  try {
    barDate = new Date(barTimestampUtc);
    if (Number.isNaN(barDate.getTime())) return { inWindow: false, eventType: "", source };
  } catch {
    return { inWindow: false, eventType: "", source };
  }

  const etOffsetMs = (isUsDst(barDate) ? -4 : -5) * 3_600_000;
  const barEtDateStr = new Date(barDate.getTime() + etOffsetMs).toISOString().slice(0, 10);

  for (const r of rows) {
    if (r.date !== barEtDateStr) continue;
    if (!eventAffectsSymbol(r.eventType, symbol)) continue;
    const [hh, mm] = r.timeEt.split(":").map(Number);
    if (hh === undefined || mm === undefined || Number.isNaN(hh) || Number.isNaN(mm)) continue;
    const evtEtMidnightUtcMs =
      Date.UTC(
        parseInt(r.date.slice(0, 4)),
        parseInt(r.date.slice(5, 7)) - 1,
        parseInt(r.date.slice(8, 10)),
      ) - etOffsetMs;
    const evtUtcMs = evtEtMidnightUtcMs + (hh * 3_600_000 + mm * 60_000);
    const diffMs = barDate.getTime() - evtUtcMs;
    if (
      diffMs >= -NEWS_ENTRY_BLOCK_BEFORE_MIN * 60_000 &&
      diffMs <= NEWS_ENTRY_BLOCK_AFTER_MIN * 60_000
    ) {
      return { inWindow: true, eventType: r.eventType, source: r.origin };
    }
  }
  return { inWindow: false, eventType: "", source };
}
