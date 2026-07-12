/**
 * python-weekday.ts (FG-3, deep-scan 2026-07-11) — convert a bar timestamp to the Python
 * `datetime.weekday()` convention (Mon=0, Tue=1, … Sun=6) that the anti-setup miner uses
 * (src/engine/anti_setups/miner.py::_get_day_of_week). JS `Date.getUTCDay()` is Sun=0..Sat=6,
 * so anti-setup `day_of_week` rules mined under Python's Mon=0 convention were shifted by one
 * weekday when fed a raw getDay()/getUTCDay() value. This helper is the single source of truth
 * for that mapping so the conversion is unit-tested and cannot silently regress (e.g. a future
 * refactor swapping getUTCDay for getDay, or the bar timestamp source flipping to local time).
 *
 * Pure + total: never throws for a valid Date/ISO/epoch input; an invalid Date yields NaN.
 */
export function toPythonWeekday(timestamp: string | number | Date): number {
  return (new Date(timestamp).getUTCDay() + 6) % 7;
}
