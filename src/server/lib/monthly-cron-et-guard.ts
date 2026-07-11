// deepscan (2026-07-10): leaf module (NO imports) for the "is this cron tick the
// genuine 1st-of-month-at-ET-hour moment" guard used by n8n-drift-detector-monthly.
// Sibling to weekly-cron-et-guard.ts (isSundayAtEtHour) — kept in a SEPARATE file
// because that module's name + doc comment scope it explicitly to the weekly
// Sunday guard; the monthly 1st-of-month check is a distinct concern.
//
// Pulled out of the inline string-matching guard the monthly cron shipped with so
// the exact instant can be unit-tested against concrete Date objects. That inline
// guard was DOUBLY broken: `now.toLocaleString("en-US", { day:"numeric",
// hour:"numeric", hour12:false })` renders the ET moment as `"1, 09"` (ICU/CLDR
// inserts a ", " literal between the day and time fields, NOT a plain space, and
// zero-pads the hour), so `etStr.split(" ")[0]` was always `"1,"` (never `"1"`)
// AND `split(" ")[1]` was always `"09"` (never `"9"`). Both `!==` checks were
// therefore ALWAYS true — the cron has never fired since it shipped.
//
// formatToParts() + hourCycle:"h23" reads the day/hour fields structurally, so no
// locale separator or padding can leak into the comparison — this fixes the whole
// bug class permanently, not just the one comma. Mirrors the weekly guard's
// defensive shape: undefined parts coerce to NaN (never match), and `% 24`
// normalizes the ICU midnight-as-"24" quirk on some ICU versions.
export function isFirstOfMonthAtEtHour(now: Date, targetHourEt: number): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const dayStr = parts.find((p) => p.type === "day")?.value;
  const hourStr = parts.find((p) => p.type === "hour")?.value;
  const day = dayStr === undefined ? Number.NaN : Number(dayStr);
  const hour = hourStr === undefined ? Number.NaN : Number(hourStr) % 24;
  return day === 1 && hour === targetHourEt;
}
