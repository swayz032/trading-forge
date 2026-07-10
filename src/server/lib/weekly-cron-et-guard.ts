// deepscan23 (2026-07-10): leaf module (NO imports) for the "is this cron tick the
// genuine Sunday-at-ET-hour moment" guard shared by weekly-drift-2sigma-check and
// n8n-drift-detector-weekly. Pulled out of inline string-matching so the exact
// instant can be unit-tested against concrete Date objects instead of only via
// source-text assertions.
//
// ICU quirk: some ICU versions format ET midnight as "24" rather than "0" —
// the `% 24` normalizes that.
export function isSundayAtEtHour(now: Date, targetHourEt: number): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hourStr = parts.find((p) => p.type === "hour")?.value;
  const hour = hourStr === undefined ? Number.NaN : Number(hourStr) % 24;
  return weekday === "Sun" && hour === targetHourEt;
}
