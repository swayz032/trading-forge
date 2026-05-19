import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Camera } from "lucide-react";
import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  format,
  getDay,
  parseISO,
  addMonths,
  subMonths,
  isSameMonth,
  startOfWeek,
  endOfWeek,
  eachWeekOfInterval,
  isSameDay,
} from "date-fns";

export interface DailyPnl {
  date: string;
  pnl: number;
  trades?: number;
}

interface Props {
  dailyPnls: DailyPnl[];
  initialMonth?: Date;
  /** Earliest year selectable in the year dropdown (defaults to 2015 per user data history). */
  minYear?: number;
}

function fmtSignedDollars(v: number): string {
  if (v === 0) return "$0";
  const sign = v >= 0 ? "" : "-";
  const abs = Math.abs(v);
  if (abs >= 1000) {
    return `${v >= 0 ? "" : "-"}$${(abs / 1000).toFixed(2).replace(/\.00$/, "")}k`;
  }
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtFullDollars(v: number): string {
  if (v === 0) return "$0.00";
  const sign = v >= 0 ? "" : "-";
  const abs = Math.abs(v);
  return `${sign}$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function ProfitCalendar({ dailyPnls, initialMonth, minYear = 2015 }: Props) {
  // Lookup map
  const pnlMap = useMemo(() => {
    const map = new Map<string, DailyPnl>();
    for (const e of dailyPnls) map.set(e.date.slice(0, 10), e);
    return map;
  }, [dailyPnls]);

  // Default month — most recent month with data, else current month
  const defaultMonth = useMemo(() => {
    if (initialMonth) return startOfMonth(initialMonth);
    if (dailyPnls.length > 0) {
      const sorted = [...dailyPnls].sort((a, b) => b.date.localeCompare(a.date));
      return startOfMonth(parseISO(sorted[0].date));
    }
    return startOfMonth(new Date());
  }, [initialMonth, dailyPnls]);

  const [currentMonth, setCurrentMonth] = useState(defaultMonth);

  const monthLabel = format(currentMonth, "MMMM yyyy");
  const currentYear = currentMonth.getFullYear();
  const currentYearMonth = currentMonth.getMonth();
  const nowYear = new Date().getFullYear();
  const yearOptions = useMemo(() => {
    const arr: number[] = [];
    for (let y = minYear; y <= nowYear; y += 1) arr.push(y);
    return arr;
  }, [minYear, nowYear]);

  const monthOptions = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
  ];

  // Build weeks (Mon-anchored) covering the visible month
  const weeks = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

    const weekStarts = eachWeekOfInterval({ start: gridStart, end: gridEnd }, { weekStartsOn: 1 });
    return weekStarts.map((wkStart) => {
      const days = eachDayOfInterval({ start: wkStart, end: endOfWeek(wkStart, { weekStartsOn: 1 }) });
      return days;
    });
  }, [currentMonth]);

  // Aggregate month totals
  const monthTotals = useMemo(() => {
    let pnl = 0;
    let trades = 0;
    for (const e of dailyPnls) {
      const d = parseISO(e.date.slice(0, 10));
      if (isSameMonth(d, currentMonth)) {
        pnl += e.pnl;
        trades += e.trades ?? 0;
      }
    }
    return { pnl, trades };
  }, [dailyPnls, currentMonth]);

  const today = new Date();

  return (
    <div className="forge-card-glow p-5 relative overflow-hidden">
      {/* Subtle ambient glow behind the calendar grid */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, hsl(160 84% 39% / 0.08), transparent 70%)",
        }}
      />

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-base font-semibold text-foreground tracking-tight">
          Profit Calendar
        </h2>
        <div className="flex items-center gap-2">
          {/* Month switcher */}
          <button
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="w-8 h-8 rounded-full glass border border-emerald-500/20 hover:border-emerald-500/40 flex items-center justify-center text-text-secondary hover:text-emerald transition-all"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full glass border border-emerald-500/20">
            <select
              value={monthOptions[currentYearMonth]}
              onChange={(e) => {
                const idx = monthOptions.indexOf(e.target.value);
                if (idx >= 0) {
                  const next = new Date(currentMonth);
                  next.setMonth(idx);
                  setCurrentMonth(startOfMonth(next));
                }
              }}
              className="bg-transparent text-sm font-medium text-foreground outline-none cursor-pointer pr-2"
            >
              {monthOptions.map((m) => (
                <option key={m} value={m} className="bg-surface-1">
                  {m}
                </option>
              ))}
            </select>
            <select
              value={currentYear}
              onChange={(e) => {
                const next = new Date(currentMonth);
                next.setFullYear(Number(e.target.value));
                setCurrentMonth(startOfMonth(next));
              }}
              className="bg-transparent text-sm font-medium text-foreground outline-none cursor-pointer"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y} className="bg-surface-1">
                  {y}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="w-8 h-8 rounded-full glass border border-emerald-500/20 hover:border-emerald-500/40 flex items-center justify-center text-text-secondary hover:text-emerald transition-all"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCurrentMonth(startOfMonth(today))}
            className="px-3 h-8 rounded-full glass border border-emerald-500/20 hover:border-emerald-500/40 text-[11px] font-medium text-text-secondary hover:text-emerald transition-all"
          >
            Today
          </button>
          <div className="w-px h-5 bg-border/30 mx-1" />
          <button
            className="w-8 h-8 rounded-full glass border border-emerald-500/20 hover:border-emerald-500/40 flex items-center justify-center text-text-secondary hover:text-emerald transition-all"
            aria-label="Screenshot"
            title="Screenshot calendar"
          >
            <Camera className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="relative z-10 grid grid-cols-[repeat(7,1fr)_88px] gap-1.5 mb-1.5">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="text-[10px] uppercase tracking-widest text-text-muted text-center py-1"
          >
            {d}
          </div>
        ))}
        <div className="text-[10px] uppercase tracking-widest text-text-muted text-center py-1">
          Total
        </div>
      </div>

      {/* Weeks */}
      <div className="relative z-10 space-y-1.5">
        {weeks.map((week, wi) => {
          // Compute weekly total for this row
          let weekPnl = 0;
          let weekTrades = 0;
          let weekHasData = false;
          for (const day of week) {
            if (!isSameMonth(day, currentMonth)) continue;
            const key = format(day, "yyyy-MM-dd");
            const e = pnlMap.get(key);
            if (e) {
              weekPnl += e.pnl;
              weekTrades += e.trades ?? 0;
              weekHasData = true;
            }
          }

          return (
            <div key={wi} className="grid grid-cols-[repeat(7,1fr)_88px] gap-1.5">
              {week.map((day) => {
                const inMonth = isSameMonth(day, currentMonth);
                const dow = getDay(day); // 0=Sun, 6=Sat
                const isWeekend = dow === 0 || dow === 6;
                const key = format(day, "yyyy-MM-dd");
                const entry = pnlMap.get(key);
                const isToday = isSameDay(day, today);

                const hasData = !!entry && entry.pnl !== 0;
                const profit = hasData && entry!.pnl > 0;
                const loss = hasData && entry!.pnl < 0;

                // Hatched if outside current month OR weekend (no trading)
                const hatched = !inMonth || isWeekend;

                let bg = "bg-surface-1/60";
                let border = "border-border/15";
                if (hatched) {
                  bg = "bg-surface-0/30";
                  border = "border-border/10";
                } else if (profit) {
                  bg = "bg-profit/12";
                  border = "border-profit/40";
                } else if (loss) {
                  bg = "bg-loss/12";
                  border = "border-loss/40";
                }

                return (
                  <div
                    key={key}
                    className={`relative aspect-square min-h-[80px] rounded-lg border ${bg} ${border} px-2 py-1.5 flex flex-col transition-all ${
                      hatched ? "" : "hover:scale-[1.03] hover:shadow-[0_8px_24px_hsl(160_84%_39%/0.15)] hover:z-10 cursor-default"
                    }`}
                    style={
                      hatched
                        ? {
                            backgroundImage:
                              "repeating-linear-gradient(135deg, hsl(220 5% 47% / 0.06) 0px, hsl(220 5% 47% / 0.06) 6px, transparent 6px, transparent 12px)",
                          }
                        : undefined
                    }
                  >
                    {/* Date number */}
                    <div className="flex items-start justify-end">
                      <span
                        className={`text-[11px] font-mono ${
                          !inMonth
                            ? "text-text-muted/40"
                            : isToday
                            ? "text-emerald font-bold"
                            : "text-text-muted"
                        }`}
                      >
                        {format(day, "d")}
                      </span>
                    </div>

                    {/* Cell body */}
                    {inMonth && !isWeekend && (
                      <div className="flex-1 flex flex-col items-center justify-center text-center -mt-2">
                        {hasData ? (
                          <>
                            <p
                              className={`text-[12px] font-mono font-semibold leading-tight ${
                                profit ? "text-profit" : "text-loss"
                              }`}
                            >
                              {fmtSignedDollars(entry!.pnl)}
                            </p>
                            {entry!.trades != null && (
                              <p className="text-[9px] text-text-muted mt-0.5">
                                {entry!.trades} {entry!.trades === 1 ? "trade" : "trades"}
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-[10px] text-text-muted/40">—</p>
                        )}
                      </div>
                    )}

                    {/* Today indicator */}
                    {isToday && inMonth && (
                      <div className="absolute inset-0 rounded-lg ring-1 ring-emerald-500/60 pointer-events-none" />
                    )}
                  </div>
                );
              })}

              {/* Weekly Total cell */}
              <div
                className={`relative min-h-[80px] rounded-lg border px-2 py-1.5 flex flex-col items-center justify-center text-center ${
                  weekHasData
                    ? weekPnl >= 0
                      ? "bg-profit/8 border-profit/30"
                      : "bg-loss/8 border-loss/30"
                    : "bg-surface-1/40 border-border/15"
                }`}
              >
                {weekHasData ? (
                  <>
                    <p
                      className={`text-[13px] font-mono font-bold leading-tight ${
                        weekPnl >= 0 ? "text-profit" : "text-loss"
                      }`}
                    >
                      {fmtSignedDollars(weekPnl)}
                    </p>
                    <p className="text-[9px] text-text-muted mt-0.5">
                      {weekTrades} {weekTrades === 1 ? "trade" : "trades"}
                    </p>
                  </>
                ) : (
                  <p className="text-[10px] text-text-muted/40">—</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Month total footer */}
      <div className="relative z-10 mt-4 pt-3 border-t border-emerald-500/10 flex items-center justify-between flex-wrap gap-2">
        <span className="text-[10px] uppercase tracking-widest text-text-muted">
          {monthLabel} total
        </span>
        <div className="flex items-center gap-3">
          <span
            className={`text-base font-mono font-bold ${
              monthTotals.pnl >= 0 ? "text-profit" : "text-loss"
            }`}
          >
            {fmtFullDollars(monthTotals.pnl)}
          </span>
          <span className="text-[11px] text-text-muted">
            · {monthTotals.trades} {monthTotals.trades === 1 ? "trade" : "trades"}
          </span>
        </div>
      </div>
    </div>
  );
}
