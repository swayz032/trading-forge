/**
 * killzone.ts — Wave 25 Pass 1, W25.3
 *
 * First-class killzone helper extracted from the silver_bullet archetype
 * detection logic. Used by confluence-score.ts (killzone_active factor)
 * and downstream Stage 2 path.
 *
 * All times are Eastern Time (America/New_York). DST transitions are
 * handled automatically via Intl.DateTimeFormat — the same approach as
 * entry-windows.ts, which is the canonical pattern in this codebase.
 *
 * Boundary semantics: [start, end) — start-inclusive, end-exclusive.
 * e.g. ny_am is 07:00:00 through 09:59:59 ET (not 10:00:00).
 *
 * ICT vocabulary — operator-canonical per CLAUDE.md. Do NOT add zones
 * beyond these 5 without an explicit system-map change.
 *
 * Pure functions only — no I/O, no globals, no side effects.
 * Never throws on any input (invalid Date → false).
 */

// ─── Named boundary constants ────────────────────────────────────────────────
// All values are in minutes since 00:00:00 ET (wall-clock).
// Do NOT inline these — magic numbers are forbidden (CLAUDE.md §13).

// London killzone: 02:00 – 05:00 ET
const LONDON_START_MIN  = 2 * 60;       // 120
const LONDON_END_MIN    = 5 * 60;       // 300

// NY morning killzone: 07:00 – 10:00 ET
const NY_AM_START_MIN   = 7 * 60;       // 420
const NY_AM_END_MIN     = 10 * 60;      // 600

// NY afternoon killzone: 13:30 – 16:00 ET
const NY_PM_START_MIN   = 13 * 60 + 30; // 810
const NY_PM_END_MIN     = 16 * 60;      // 960

// Silver Bullet windows (3 separate OR'd windows)
const SB_WINDOW_1_START = 3 * 60;       // 03:00 ET
const SB_WINDOW_1_END   = 4 * 60;       // 04:00 ET
const SB_WINDOW_2_START = 10 * 60;      // 10:00 ET
const SB_WINDOW_2_END   = 11 * 60;      // 11:00 ET
const SB_WINDOW_3_START = 14 * 60;      // 14:00 ET
const SB_WINDOW_3_END   = 15 * 60;      // 15:00 ET

// Macro window (3 separate OR'd windows)
const MW_WINDOW_1_START = 9 * 60 + 50;  // 09:50 ET
const MW_WINDOW_1_END   = 10 * 60 + 10; // 10:10 ET
const MW_WINDOW_2_START = 2 * 60 + 33;  // 02:33 ET
const MW_WINDOW_2_END   = 3 * 60;       // 03:00 ET
const MW_WINDOW_3_START = 4 * 60 + 3;   // 04:03 ET
const MW_WINDOW_3_END   = 4 * 60 + 30;  // 04:30 ET

// ─── IANA timezone for ET ─────────────────────────────────────────────────────
const ET_TIMEZONE = "America/New_York";

// ─── Types ────────────────────────────────────────────────────────────────────

export type KillzoneName =
  | "london"        // 02:00 – 05:00 ET
  | "ny_am"         // 07:00 – 10:00 ET
  | "ny_pm"         // 13:30 – 16:00 ET
  | "silver_bullet" // 03:00–04:00 ET OR 10:00–11:00 ET OR 14:00–15:00 ET
  | "macro_window"; // 09:50–10:10 ET OR 02:33–03:00 ET OR 04:03–04:30 ET

// ─── Internal DST-correct conversion ─────────────────────────────────────────

/**
 * Convert a UTC Date to the ET wall-clock minutes-of-day.
 * Returns NaN if the date is invalid or if Intl.DateTimeFormat fails.
 *
 * Uses the same Intl.DateTimeFormat approach as entry-windows.ts:toMinutesOfDayInTz.
 * Handles DST automatically — no manual UTC offset arithmetic.
 */
function toEtMinutesOfDay(timestampUTC: Date): number {
  // Guard against invalid Date
  if (!(timestampUTC instanceof Date) || isNaN(timestampUTC.getTime())) {
    return NaN;
  }
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: ET_TIMEZONE,
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    }).formatToParts(timestampUTC);

    let h = 0;
    let m = 0;
    let s = 0;
    for (const part of parts) {
      if (part.type === "hour") {
        h = parseInt(part.value, 10);
        // Intl hour12:false returns "24" for midnight — normalize to 0
        if (h === 24) h = 0;
      } else if (part.type === "minute") {
        m = parseInt(part.value, 10);
      } else if (part.type === "second") {
        s = parseInt(part.value, 10);
      }
    }
    // Convert to fractional minutes so we can compare at second resolution.
    // minutesOfDay includes seconds as a fraction to honor the exclusive-end
    // boundary correctly (e.g. 10:00:00 ET = 600.000 which is >= NY_AM_END=600,
    // so it correctly falls OUTSIDE ny_am).
    return h * 60 + m + s / 60;
  } catch {
    return NaN;
  }
}

// ─── Core evaluators ─────────────────────────────────────────────────────────

function isLondon(etMinutes: number): boolean {
  return etMinutes >= LONDON_START_MIN && etMinutes < LONDON_END_MIN;
}

function isNyAm(etMinutes: number): boolean {
  return etMinutes >= NY_AM_START_MIN && etMinutes < NY_AM_END_MIN;
}

function isNyPm(etMinutes: number): boolean {
  return etMinutes >= NY_PM_START_MIN && etMinutes < NY_PM_END_MIN;
}

function isSilverBullet(etMinutes: number): boolean {
  return (
    (etMinutes >= SB_WINDOW_1_START && etMinutes < SB_WINDOW_1_END) ||
    (etMinutes >= SB_WINDOW_2_START && etMinutes < SB_WINDOW_2_END) ||
    (etMinutes >= SB_WINDOW_3_START && etMinutes < SB_WINDOW_3_END)
  );
}

function isMacroWindow(etMinutes: number): boolean {
  return (
    (etMinutes >= MW_WINDOW_1_START && etMinutes < MW_WINDOW_1_END) ||
    (etMinutes >= MW_WINDOW_2_START && etMinutes < MW_WINDOW_2_END) ||
    (etMinutes >= MW_WINDOW_3_START && etMinutes < MW_WINDOW_3_END)
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check whether a UTC timestamp falls within the specified killzone.
 *
 * DST-correct: uses Intl.DateTimeFormat with America/New_York.
 * Never throws: invalid Date or unknown zone returns false.
 *
 * Boundary semantics: [start, end) — start minute-inclusive, end-exclusive.
 * Silver Bullet and Macro Window return true if ANY of their 3 windows matches.
 *
 * @param timestampUTC  Bar or signal timestamp in UTC.
 * @param zone          One of the 5 operator-canonical zone names.
 */
export function isInKillzone(timestampUTC: Date, zone: KillzoneName): boolean {
  const etMin = toEtMinutesOfDay(timestampUTC);
  if (isNaN(etMin)) return false;

  switch (zone) {
    case "london":        return isLondon(etMin);
    case "ny_am":         return isNyAm(etMin);
    case "ny_pm":         return isNyPm(etMin);
    case "silver_bullet": return isSilverBullet(etMin);
    case "macro_window":  return isMacroWindow(etMin);
    default:
      // Exhaustiveness guard: TypeScript will catch unhandled zones at compile time,
      // but runtime must also be safe for any unrecognized string.
      return false;
  }
}

/**
 * Return all killzone names that are active for the given UTC timestamp.
 * Returns an empty array when no zone is active.
 *
 * Zones are evaluated in canonical priority order (most-specific first):
 * silver_bullet is a sub-window of london / ny_am / ny_pm, so it will
 * appear alongside those when it overlaps.
 *
 * @param timestampUTC  Bar or signal timestamp in UTC.
 */
export function activeKillzones(timestampUTC: Date): KillzoneName[] {
  const etMin = toEtMinutesOfDay(timestampUTC);
  if (isNaN(etMin)) return [];

  const active: KillzoneName[] = [];
  if (isLondon(etMin))        active.push("london");
  if (isNyAm(etMin))          active.push("ny_am");
  if (isNyPm(etMin))          active.push("ny_pm");
  if (isSilverBullet(etMin))  active.push("silver_bullet");
  if (isMacroWindow(etMin))   active.push("macro_window");
  return active;
}

/**
 * Return true if the UTC timestamp is inside ANY of the 5 killzones.
 * Convenience wrapper for the killzone_active confluence factor.
 *
 * @param timestampUTC  Bar or signal timestamp in UTC.
 */
export function isInAnyKillzone(timestampUTC: Date): boolean {
  const etMin = toEtMinutesOfDay(timestampUTC);
  if (isNaN(etMin)) return false;

  return (
    isLondon(etMin) ||
    isNyAm(etMin) ||
    isNyPm(etMin) ||
    isSilverBullet(etMin) ||
    isMacroWindow(etMin)
  );
}
