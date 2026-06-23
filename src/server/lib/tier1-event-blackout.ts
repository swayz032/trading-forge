/**
 * tier1-event-blackout.ts — In-process Tier-1 economic event blackout checker.
 *
 * FIX B (2026-06-22): When the Python calendar_filter subprocess is down,
 * CALENDAR_SAFE_DEFAULT previously returned is_economic_event:false — silently
 * opening FOMC/CPI/NFP windows for all strategies → MFFU compliance ban.
 *
 * This module provides a conservative in-process fallback that runs WITHOUT
 * spawning Python. It mirrors the STATIC_EVENTS list from
 * src/engine/economic_calendar.py for the six MFFU-restricted Tier-1 events:
 * FOMC, CPI, NFP, GDP, ISM, PPI.
 *
 * Wave hardening 2026-06-22, macro-blackout MFFU §5 extension — GDP/ISM/PPI:
 *   GDP, ISM, PPI added to TIER1_EVENTS to match the extension made to
 *   calendar_filter.py._ECONOMIC_EVENTS.  Dates are copied from
 *   src/engine/economic_calendar.py::STATIC_EVENTS[2026-2027] (TS cannot
 *   import Python at runtime).  A parity gate (check:ts-python-tier1-parity)
 *   asserts exact date/time agreement between this file and STATIC_EVENTS to
 *   prevent silent calendar drift.
 *
 * Retail Sales gap (TODO): MFFU §5 also restricts Retail Sales.
 *   economic_calendar.py has no confirmed Retail Sales dates.  Do NOT add
 *   invented dates.  Wire when BLS/Census 2026-2027 dates are confirmed.
 *
 * The blackout window is ±30 minutes around each event release time (matching
 * calendar_filter.py EVENT_BLACKOUT_MINUTES default).
 *
 * Usage:
 *   getCachedSignalCalendarStatus() catches subprocess errors and calls this
 *   checker. If the bar falls inside a Tier-1 window, it returns a synthetic
 *   "blocked" sentinel instead of the fail-open CALENDAR_SAFE_DEFAULT.
 *
 * Correctness contract:
 *   - Times are in ET (Eastern Time: EST UTC-5 / EDT UTC-4).
 *   - DST switches in 2026: spring-forward Mar 8 02:00, fall-back Nov 1 02:00.
 *   - All FOMC/CPI/GDP/ISM/PPI dates through 2027 are present (matching
 *     economic_calendar.py STATIC_EVENTS).
 *   - NFP is the first Friday of each month at 08:30 ET — computed dynamically.
 *   - Window: [event_time - 30min, event_time + 30min].
 */

import { isUsDst } from "./dst-utils.js";

export const TIER1_BLACKOUT_MINUTES = 30;

/** Tier-1 event descriptor. time_et is "HH:MM" in Eastern Time. */
export interface Tier1Event {
  date: string;       // "YYYY-MM-DD"
  time_et: string;    // "HH:MM"
  event_type: string; // "FOMC" | "CPI" | "NFP" | "GDP" | "ISM" | "PPI"
}

// ─── FOMC 2025-2027 (matching economic_calendar.py STATIC_EVENTS["FOMC"]) ────

const FOMC_EVENTS: Tier1Event[] = [
  // 2025
  { date: "2025-01-29", time_et: "14:00", event_type: "FOMC" },
  { date: "2025-03-19", time_et: "14:00", event_type: "FOMC" },
  { date: "2025-05-07", time_et: "14:00", event_type: "FOMC" },
  { date: "2025-06-18", time_et: "14:00", event_type: "FOMC" },
  { date: "2025-07-30", time_et: "14:00", event_type: "FOMC" },
  { date: "2025-09-17", time_et: "14:00", event_type: "FOMC" },
  { date: "2025-11-05", time_et: "14:00", event_type: "FOMC" },
  { date: "2025-12-17", time_et: "14:00", event_type: "FOMC" },
  // 2026
  { date: "2026-01-28", time_et: "14:00", event_type: "FOMC" },
  { date: "2026-03-18", time_et: "14:00", event_type: "FOMC" },
  { date: "2026-05-06", time_et: "14:00", event_type: "FOMC" },
  { date: "2026-06-17", time_et: "14:00", event_type: "FOMC" },
  { date: "2026-07-29", time_et: "14:00", event_type: "FOMC" },
  { date: "2026-09-16", time_et: "14:00", event_type: "FOMC" },
  { date: "2026-11-04", time_et: "14:00", event_type: "FOMC" },
  { date: "2026-12-16", time_et: "14:00", event_type: "FOMC" },
  // 2027
  { date: "2027-01-27", time_et: "14:00", event_type: "FOMC" },
  { date: "2027-03-17", time_et: "14:00", event_type: "FOMC" },
  { date: "2027-05-05", time_et: "14:00", event_type: "FOMC" },
  { date: "2027-06-16", time_et: "14:00", event_type: "FOMC" },
  { date: "2027-07-28", time_et: "14:00", event_type: "FOMC" },
  { date: "2027-09-22", time_et: "14:00", event_type: "FOMC" },
  { date: "2027-11-03", time_et: "14:00", event_type: "FOMC" },
  { date: "2027-12-15", time_et: "14:00", event_type: "FOMC" },
];

// ─── CPI 2025-2027 (matching economic_calendar.py STATIC_EVENTS["CPI"]) ─────

const CPI_EVENTS: Tier1Event[] = [
  // 2025
  { date: "2025-01-15", time_et: "08:30", event_type: "CPI" },
  { date: "2025-02-12", time_et: "08:30", event_type: "CPI" },
  { date: "2025-03-12", time_et: "08:30", event_type: "CPI" },
  { date: "2025-04-10", time_et: "08:30", event_type: "CPI" },
  { date: "2025-05-13", time_et: "08:30", event_type: "CPI" },
  { date: "2025-06-11", time_et: "08:30", event_type: "CPI" },
  { date: "2025-07-15", time_et: "08:30", event_type: "CPI" },
  { date: "2025-08-12", time_et: "08:30", event_type: "CPI" },
  { date: "2025-09-10", time_et: "08:30", event_type: "CPI" },
  { date: "2025-10-15", time_et: "08:30", event_type: "CPI" },
  { date: "2025-11-13", time_et: "08:30", event_type: "CPI" },
  { date: "2025-12-10", time_et: "08:30", event_type: "CPI" },
  // 2026
  { date: "2026-01-14", time_et: "08:30", event_type: "CPI" },
  { date: "2026-02-11", time_et: "08:30", event_type: "CPI" },
  { date: "2026-03-11", time_et: "08:30", event_type: "CPI" },
  { date: "2026-04-14", time_et: "08:30", event_type: "CPI" },
  { date: "2026-05-12", time_et: "08:30", event_type: "CPI" },
  { date: "2026-06-10", time_et: "08:30", event_type: "CPI" },
  { date: "2026-07-14", time_et: "08:30", event_type: "CPI" },
  { date: "2026-08-12", time_et: "08:30", event_type: "CPI" },
  { date: "2026-09-15", time_et: "08:30", event_type: "CPI" },
  { date: "2026-10-13", time_et: "08:30", event_type: "CPI" },
  { date: "2026-11-10", time_et: "08:30", event_type: "CPI" },
  { date: "2026-12-10", time_et: "08:30", event_type: "CPI" },
  // 2027 (projected — matches economic_calendar.py)
  { date: "2027-01-13", time_et: "08:30", event_type: "CPI" },
  { date: "2027-02-10", time_et: "08:30", event_type: "CPI" },
  { date: "2027-03-10", time_et: "08:30", event_type: "CPI" },
  { date: "2027-04-13", time_et: "08:30", event_type: "CPI" },
  { date: "2027-05-12", time_et: "08:30", event_type: "CPI" },
  { date: "2027-06-10", time_et: "08:30", event_type: "CPI" },
  { date: "2027-07-13", time_et: "08:30", event_type: "CPI" },
  { date: "2027-08-11", time_et: "08:30", event_type: "CPI" },
  { date: "2027-09-14", time_et: "08:30", event_type: "CPI" },
  { date: "2027-10-13", time_et: "08:30", event_type: "CPI" },
  { date: "2027-11-10", time_et: "08:30", event_type: "CPI" },
  { date: "2027-12-10", time_et: "08:30", event_type: "CPI" },
];

// ─── NFP — first Friday of each month at 08:30 ET ────────────────────────────
// Computed dynamically rather than enumerated to avoid stale lists.

/**
 * Returns the first Friday of the given year+month (1-indexed).
 * Returns null if the computation fails for any reason.
 */
function firstFridayOfMonth(year: number, month: number): Date | null {
  try {
    // month is 1-indexed; Date.UTC uses 0-indexed
    const d = new Date(Date.UTC(year, month - 1, 1));
    // getUTCDay(): 0=Sun, 1=Mon, ..., 5=Fri
    const dow = d.getUTCDay();
    const daysUntilFriday = dow <= 5 ? (5 - dow) : (7 - dow + 5);
    d.setUTCDate(1 + daysUntilFriday);
    return d;
  } catch {
    return null;
  }
}

/**
 * Build NFP events for the given year range [startYear, endYear].
 * NFP = first Friday of every month at 08:30 ET.
 */
export function buildNfpEvents(startYear: number, endYear: number): Tier1Event[] {
  const events: Tier1Event[] = [];
  for (let y = startYear; y <= endYear; y++) {
    for (let m = 1; m <= 12; m++) {
      const friday = firstFridayOfMonth(y, m);
      if (!friday) continue;
      const dateStr = friday.toISOString().slice(0, 10);
      events.push({ date: dateStr, time_et: "08:30", event_type: "NFP" });
    }
  }
  return events;
}

// Pre-build NFP for 2025-2027 at module load (pure, no I/O).
const NFP_EVENTS: Tier1Event[] = buildNfpEvents(2025, 2027);

// ─── GDP 2025-2027 (matching economic_calendar.py STATIC_EVENTS["GDP"]) ──────
// Wave hardening 2026-06-22, macro-blackout MFFU §5 extension — GDP.
// Quarterly advance BEA estimate, 08:30 ET. Dates copied from STATIC_EVENTS.
// Parity gate: check:ts-python-tier1-parity asserts exact agreement.

const GDP_EVENTS: Tier1Event[] = [
  // 2025
  { date: "2025-01-30", time_et: "08:30", event_type: "GDP" },
  { date: "2025-04-30", time_et: "08:30", event_type: "GDP" },
  { date: "2025-07-30", time_et: "08:30", event_type: "GDP" },
  { date: "2025-10-29", time_et: "08:30", event_type: "GDP" },
  // 2026 (projected — TODO: confirm from BEA when released)
  { date: "2026-01-29", time_et: "08:30", event_type: "GDP" },
  { date: "2026-04-29", time_et: "08:30", event_type: "GDP" },
  { date: "2026-07-29", time_et: "08:30", event_type: "GDP" },
  { date: "2026-10-28", time_et: "08:30", event_type: "GDP" },
  // 2027 (projected — TODO: confirm from BEA when released)
  { date: "2027-01-28", time_et: "08:30", event_type: "GDP" },
  { date: "2027-04-28", time_et: "08:30", event_type: "GDP" },
  { date: "2027-07-28", time_et: "08:30", event_type: "GDP" },
  { date: "2027-10-27", time_et: "08:30", event_type: "GDP" },
];

// ─── ISM 2025-2027 (matching economic_calendar.py STATIC_EVENTS["ISM"]) ──────
// Wave hardening 2026-06-22, macro-blackout MFFU §5 extension — ISM.
// ISM Manufacturing PMI — first business day of the month, 10:00 ET.
// Parity gate: check:ts-python-tier1-parity asserts exact agreement.

const ISM_EVENTS: Tier1Event[] = [
  // 2025
  { date: "2025-01-02", time_et: "10:00", event_type: "ISM" },
  { date: "2025-02-03", time_et: "10:00", event_type: "ISM" },
  { date: "2025-03-03", time_et: "10:00", event_type: "ISM" },
  { date: "2025-04-01", time_et: "10:00", event_type: "ISM" },
  { date: "2025-05-01", time_et: "10:00", event_type: "ISM" },
  { date: "2025-06-02", time_et: "10:00", event_type: "ISM" },
  { date: "2025-07-01", time_et: "10:00", event_type: "ISM" },
  { date: "2025-08-01", time_et: "10:00", event_type: "ISM" },
  { date: "2025-09-02", time_et: "10:00", event_type: "ISM" },
  { date: "2025-10-01", time_et: "10:00", event_type: "ISM" },
  { date: "2025-11-03", time_et: "10:00", event_type: "ISM" },
  { date: "2025-12-01", time_et: "10:00", event_type: "ISM" },
  // 2026 (projected — first business day of month)
  { date: "2026-01-02", time_et: "10:00", event_type: "ISM" },
  { date: "2026-02-02", time_et: "10:00", event_type: "ISM" },
  { date: "2026-03-02", time_et: "10:00", event_type: "ISM" },
  { date: "2026-04-01", time_et: "10:00", event_type: "ISM" },
  { date: "2026-05-01", time_et: "10:00", event_type: "ISM" },
  { date: "2026-06-01", time_et: "10:00", event_type: "ISM" },
  { date: "2026-07-01", time_et: "10:00", event_type: "ISM" },
  { date: "2026-08-03", time_et: "10:00", event_type: "ISM" },
  { date: "2026-09-01", time_et: "10:00", event_type: "ISM" },
  { date: "2026-10-01", time_et: "10:00", event_type: "ISM" },
  { date: "2026-11-02", time_et: "10:00", event_type: "ISM" },
  { date: "2026-12-01", time_et: "10:00", event_type: "ISM" },
  // 2027 (projected — first business day of month)
  { date: "2027-01-04", time_et: "10:00", event_type: "ISM" },
  { date: "2027-02-01", time_et: "10:00", event_type: "ISM" },
  { date: "2027-03-01", time_et: "10:00", event_type: "ISM" },
  { date: "2027-04-01", time_et: "10:00", event_type: "ISM" },
  { date: "2027-05-03", time_et: "10:00", event_type: "ISM" },
  { date: "2027-06-01", time_et: "10:00", event_type: "ISM" },
  { date: "2027-07-01", time_et: "10:00", event_type: "ISM" },
  { date: "2027-08-02", time_et: "10:00", event_type: "ISM" },
  { date: "2027-09-01", time_et: "10:00", event_type: "ISM" },
  { date: "2027-10-01", time_et: "10:00", event_type: "ISM" },
  { date: "2027-11-01", time_et: "10:00", event_type: "ISM" },
  { date: "2027-12-01", time_et: "10:00", event_type: "ISM" },
];

// ─── PPI 2025-2027 (matching economic_calendar.py STATIC_EVENTS["PPI"]) ──────
// Wave hardening 2026-06-22, macro-blackout MFFU §5 extension — PPI.
// Producer Price Index — typically 2nd Tuesday of month, 08:30 ET.
// Parity gate: check:ts-python-tier1-parity asserts exact agreement.

const PPI_EVENTS: Tier1Event[] = [
  // 2025 (BLS published schedule)
  { date: "2025-01-14", time_et: "08:30", event_type: "PPI" },
  { date: "2025-02-13", time_et: "08:30", event_type: "PPI" },
  { date: "2025-03-13", time_et: "08:30", event_type: "PPI" },
  { date: "2025-04-11", time_et: "08:30", event_type: "PPI" },
  { date: "2025-05-15", time_et: "08:30", event_type: "PPI" },
  { date: "2025-06-12", time_et: "08:30", event_type: "PPI" },
  { date: "2025-07-15", time_et: "08:30", event_type: "PPI" },
  { date: "2025-08-14", time_et: "08:30", event_type: "PPI" },
  { date: "2025-09-11", time_et: "08:30", event_type: "PPI" },
  { date: "2025-10-14", time_et: "08:30", event_type: "PPI" },
  { date: "2025-11-13", time_et: "08:30", event_type: "PPI" },
  { date: "2025-12-11", time_et: "08:30", event_type: "PPI" },
  // 2026 (projected — day after CPI release, typically)
  { date: "2026-01-15", time_et: "08:30", event_type: "PPI" },
  { date: "2026-02-12", time_et: "08:30", event_type: "PPI" },
  { date: "2026-03-12", time_et: "08:30", event_type: "PPI" },
  { date: "2026-04-15", time_et: "08:30", event_type: "PPI" },
  { date: "2026-05-13", time_et: "08:30", event_type: "PPI" },
  { date: "2026-06-11", time_et: "08:30", event_type: "PPI" },
  { date: "2026-07-15", time_et: "08:30", event_type: "PPI" },
  { date: "2026-08-13", time_et: "08:30", event_type: "PPI" },
  { date: "2026-09-16", time_et: "08:30", event_type: "PPI" },
  { date: "2026-10-14", time_et: "08:30", event_type: "PPI" },
  { date: "2026-11-11", time_et: "08:30", event_type: "PPI" },
  { date: "2026-12-11", time_et: "08:30", event_type: "PPI" },
  // 2027 (projected — TODO: confirm from BLS when released)
  { date: "2027-01-14", time_et: "08:30", event_type: "PPI" },
  { date: "2027-02-11", time_et: "08:30", event_type: "PPI" },
  { date: "2027-03-11", time_et: "08:30", event_type: "PPI" },
  { date: "2027-04-14", time_et: "08:30", event_type: "PPI" },
  { date: "2027-05-13", time_et: "08:30", event_type: "PPI" },
  { date: "2027-06-11", time_et: "08:30", event_type: "PPI" },
  { date: "2027-07-14", time_et: "08:30", event_type: "PPI" },
  { date: "2027-08-12", time_et: "08:30", event_type: "PPI" },
  { date: "2027-09-15", time_et: "08:30", event_type: "PPI" },
  { date: "2027-10-14", time_et: "08:30", event_type: "PPI" },
  { date: "2027-11-11", time_et: "08:30", event_type: "PPI" },
  { date: "2027-12-09", time_et: "08:30", event_type: "PPI" },
];

// ─── Combined Tier-1 event list ───────────────────────────────────────────────
// Wave hardening 2026-06-22: GDP_EVENTS + ISM_EVENTS + PPI_EVENTS added.
// Parity with Python STATIC_EVENTS enforced via check:ts-python-tier1-parity.

export const TIER1_EVENTS: Tier1Event[] = [
  ...FOMC_EVENTS,
  ...CPI_EVENTS,
  ...NFP_EVENTS,
  ...GDP_EVENTS,
  ...ISM_EVENTS,
  ...PPI_EVENTS,
];

// ─── Core checker ─────────────────────────────────────────────────────────────

export interface Tier1CheckResult {
  blocked: boolean;
  eventName: string;      // "" when not blocked
  eventType: string;      // "" when not blocked
  windowMinutes: number;  // TIER1_BLACKOUT_MINUTES when blocked, 0 otherwise
}

/**
 * Check whether a bar timestamp falls inside any Tier-1 economic event blackout
 * window, using only the in-process event list (no Python, no DB, no I/O).
 *
 * This is the conservative fallback invoked when the Python calendar_filter
 * subprocess is unavailable. It converts barTimestampUtc to ET using the
 * dst-utils helper and checks ±TIER1_BLACKOUT_MINUTES around each event.
 *
 * @param barTimestampUtc - ISO 8601 UTC timestamp string (e.g., "2026-01-28T19:00:00.000Z")
 * @param opts.bypassNewsBlackout - When true, bypass even in-process blocks
 *   (mirrors bypass_news_blackout per-strategy opt-in). Default: false.
 * @returns Tier1CheckResult — blocked=true if bar is inside any Tier-1 window
 */
export function checkInProcessTier1EventWindow(
  barTimestampUtc: string,
  opts: { bypassNewsBlackout?: boolean } = {},
): Tier1CheckResult {
  const NOT_BLOCKED: Tier1CheckResult = { blocked: false, eventName: "", eventType: "", windowMinutes: 0 };

  if (opts.bypassNewsBlackout === true) return NOT_BLOCKED;

  let barDate: Date;
  try {
    barDate = new Date(barTimestampUtc);
    if (isNaN(barDate.getTime())) return NOT_BLOCKED;
  } catch {
    return NOT_BLOCKED;
  }

  // Convert bar UTC to ET wall clock
  const isDst = isUsDst(barDate);
  const etOffsetMs = (isDst ? -4 : -5) * 3_600_000;
  const barEtMs = barDate.getTime() + etOffsetMs;
  const barEt = new Date(barEtMs);

  // ET date string: "YYYY-MM-DD"
  const barEtDateStr = barEt.toISOString().slice(0, 10);

  const windowMs = TIER1_BLACKOUT_MINUTES * 60 * 1000;

  for (const evt of TIER1_EVENTS) {
    if (evt.date !== barEtDateStr) continue;

    // Parse event time in ET
    const [hh, mm] = evt.time_et.split(":").map(Number);
    if (hh === undefined || mm === undefined || isNaN(hh) || isNaN(mm)) continue;

    // Build event UTC timestamp: ET date + time_et converted to UTC
    // We know the ET date matches, so construct by setting HH:MM on a UTC date
    // that represents midnight ET of evt.date:
    const evtEtMidnightUtcMs = Date.UTC(
      parseInt(evt.date.slice(0, 4)),
      parseInt(evt.date.slice(5, 7)) - 1,
      parseInt(evt.date.slice(8, 10)),
    ) - etOffsetMs; // subtract ET offset to go from ET midnight → UTC midnight
    const evtUtcMs = evtEtMidnightUtcMs + (hh * 3_600_000 + mm * 60_000);

    // Check ±windowMs
    const diffMs = barDate.getTime() - evtUtcMs;
    if (Math.abs(diffMs) <= windowMs) {
      return {
        blocked: true,
        eventName: `${evt.event_type} (in-process fallback)`,
        eventType: evt.event_type,
        windowMinutes: TIER1_BLACKOUT_MINUTES,
      };
    }
  }

  return NOT_BLOCKED;
}
