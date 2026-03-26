import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fmtCurrency } from "@/lib/utils";
import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  format,
  getDay,
  addMonths,
  subMonths,
  isSameMonth,
  parseISO,
} from "date-fns";

interface PnLCalendarProps {
  dailyPnls: Array<{
    date: string; // "2024-01-15"
    pnl: number; // dollars
    trades?: number; // trade count that day
    balance?: number; // running balance
  }>;
  initialMonth?: string; // "2024-01" — defaults to most recent month in data
}

export function PnLCalendar({ dailyPnls, initialMonth }: PnLCalendarProps) {
  // Build a lookup map: "YYYY-MM-DD" -> entry
  const pnlMap = useMemo(() => {
    const map = new Map<string, (typeof dailyPnls)[number]>();
    for (const entry of dailyPnls) {
      map.set(entry.date, entry);
    }
    return map;
  }, [dailyPnls]);

  // Determine initial month to display
  const defaultMonth = useMemo(() => {
    if (initialMonth) {
      return parseISO(`${initialMonth}-01`);
    }
    if (dailyPnls.length > 0) {
      // Use the most recent date in data
      const sorted = [...dailyPnls].sort((a, b) => b.date.localeCompare(a.date));
      return startOfMonth(parseISO(sorted[0].date));
    }
    return startOfMonth(new Date());
  }, [initialMonth, dailyPnls]);

  const [currentMonth, setCurrentMonth] = useState(defaultMonth);

  // Generate all days in the current month view
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const allDays = eachDayOfInterval({ start: monthStart, end: monthEnd });

    // getDay: 0=Sun, 1=Mon ... 6=Sat
    // We want Mon=0, so shift: (getDay(d) + 6) % 7
    const startDayOfWeek = (getDay(monthStart) + 6) % 7;

    // Pad the beginning with nulls for alignment
    const padded: (Date | null)[] = Array(startDayOfWeek).fill(null);
    padded.push(...allDays);

    // Pad the end to fill the last row
    while (padded.length % 7 !== 0) {
      padded.push(null);
    }

    return padded;
  }, [currentMonth]);

  // Monthly summary stats
  const summary = useMemo(() => {
    const monthDays = calendarDays
      .filter((d): d is Date => d !== null)
      .map((d) => pnlMap.get(format(d, "yyyy-MM-dd")))
      .filter((entry): entry is NonNullable<typeof entry> => entry != null);

    if (monthDays.length === 0) {
      return null;
    }

    const totalPnl = monthDays.reduce((sum, d) => sum + d.pnl, 0);
    const winDays = monthDays.filter((d) => d.pnl > 0).length;
    const lossDays = monthDays.filter((d) => d.pnl < 0).length;
    const bestDay = monthDays.reduce((best, d) => (d.pnl > best.pnl ? d : best), monthDays[0]);
    const worstDay = monthDays.reduce((worst, d) => (d.pnl < worst.pnl ? d : worst), monthDays[0]);

    return { totalPnl, winDays, lossDays, bestDay, worstDay, tradingDays: monthDays.length };
  }, [calendarDays, pnlMap]);

  const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="forge-card p-5">
      {/* Month Navigation Header */}
      <div className="flex items-center justify-between mb-5">
        <button
          onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
          className="p-1.5 rounded-md hover:bg-surface-0/50 transition-colors text-text-secondary hover:text-foreground"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <h2 className="text-sm font-semibold text-foreground tracking-tight">
          {format(currentMonth, "MMMM yyyy")}
        </h2>
        <button
          onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
          className="p-1.5 rounded-md hover:bg-surface-0/50 transition-colors text-text-secondary hover:text-foreground"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Weekday Headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {weekDays.map((day) => (
          <div
            key={day}
            className={`text-center text-[10px] uppercase tracking-wider font-medium py-1.5 ${
              day === "Sat" || day === "Sun" ? "text-text-muted/40" : "text-text-muted"
            }`}
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((day, idx) => {
          if (!day) {
            // Empty padding cell
            return <div key={`pad-${idx}`} className="aspect-square rounded-md bg-surface-0/20" />;
          }

          const dateStr = format(day, "yyyy-MM-dd");
          const dayOfWeek = (getDay(day) + 6) % 7; // Mon=0 ... Sun=6
          const isWeekend = dayOfWeek >= 5;
          const entry = pnlMap.get(dateStr);
          const inMonth = isSameMonth(day, currentMonth);

          if (isWeekend || !inMonth) {
            return (
              <div
                key={dateStr}
                className="aspect-square rounded-md bg-surface-0/20 flex items-start p-1"
              >
                <span className="text-[9px] text-text-muted/30 font-mono">{format(day, "d")}</span>
              </div>
            );
          }

          const hasTrades = entry != null;
          const pnl = entry?.pnl ?? 0;
          const isProfit = pnl > 0;
          const isLoss = pnl < 0;

          let bgClass = "bg-surface-0/30"; // no trades
          if (hasTrades && isProfit) bgClass = "bg-profit/5";
          if (hasTrades && isLoss) bgClass = "bg-loss/5";

          let pnlColorClass = "text-text-muted"; // zero / no trades
          if (hasTrades && isProfit) pnlColorClass = "text-profit";
          if (hasTrades && isLoss) pnlColorClass = "text-loss";

          return (
            <div
              key={dateStr}
              className={`aspect-square rounded-md ${bgClass} flex flex-col justify-between p-1.5 transition-all duration-150 hover:ring-1 hover:ring-border/30 cursor-default relative`}
            >
              {/* Day number */}
              <span className="text-[9px] text-text-muted/60 font-mono leading-none">
                {format(day, "d")}
              </span>

              {/* P&L amount */}
              {hasTrades ? (
                <span
                  className={`text-[11px] font-mono font-semibold ${pnlColorClass} text-center leading-none`}
                >
                  {fmtCurrency(pnl)}
                </span>
              ) : (
                <span className="text-[9px] text-text-muted/30 text-center leading-none">--</span>
              )}

              {/* Trade count */}
              <span className="text-[8px] text-text-muted/40 font-mono text-right leading-none">
                {entry?.trades != null ? `${entry.trades}t` : ""}
              </span>
            </div>
          );
        })}
      </div>

      {/* Monthly Summary Row */}
      {summary && (
        <div className="mt-4 pt-3 border-t border-border/10">
          <div className="grid grid-cols-5 gap-2">
            {[
              {
                label: "Total P&L",
                value: fmtCurrency(summary.totalPnl),
                cls: summary.totalPnl >= 0 ? "text-profit" : "text-loss",
              },
              {
                label: "Win Days",
                value: `${summary.winDays} / ${summary.tradingDays}`,
                cls: "text-profit",
              },
              {
                label: "Loss Days",
                value: `${summary.lossDays} / ${summary.tradingDays}`,
                cls: "text-loss",
              },
              {
                label: "Best Day",
                value: fmtCurrency(summary.bestDay.pnl),
                cls: "text-profit",
              },
              {
                label: "Worst Day",
                value: fmtCurrency(summary.worstDay.pnl),
                cls: "text-loss",
              },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <span className="text-[9px] uppercase tracking-wider text-text-muted block mb-0.5">
                  {stat.label}
                </span>
                <span className={`text-xs font-mono font-semibold ${stat.cls}`}>{stat.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
