import { describe, it, expect } from "vitest";
import {
  etHourOf,
  etMinuteOf,
  etDateOf,
  resolveDailyRange,
  resolveIntradayRange,
  shapeDailyBars,
  shapeIntraBars,
  filterOvernightWindow,
  filterHourWindow,
  firstRthBar,
  type RawBar,
} from "../bars-window.js";

function bar(ts: string, o = 1, h = 2, l = 0.5, c = 1.5, v: number | null = 100): RawBar {
  return { ts_event: ts, open: o, high: h, low: l, close: c, volume: v };
}

describe("etHourOf / etMinuteOf / etDateOf — DST-correct", () => {
  it("winter (EST, UTC-5): 14:00Z -> 09:00 ET", () => {
    expect(etHourOf("2026-01-15T14:00:00Z")).toBe(9);
    expect(etMinuteOf("2026-01-15T14:00:00Z")).toBe(0);
    expect(etDateOf("2026-01-15T14:00:00Z")).toBe("2026-01-15");
  });

  it("summer (EDT, UTC-4): 13:00Z -> 09:00 ET — same wall-clock hour, different UTC offset", () => {
    expect(etHourOf("2026-07-15T13:00:00Z")).toBe(9);
    expect(etDateOf("2026-07-15T13:00:00Z")).toBe("2026-07-15");
  });

  it("crosses ET midnight: 03:00Z -> prev ET calendar date", () => {
    // 2026-06-02T03:00:00Z is 2026-06-01 23:00 EDT
    expect(etDateOf("2026-06-02T03:00:00Z")).toBe("2026-06-01");
    expect(etHourOf("2026-06-02T03:00:00Z")).toBe(23);
  });

  it("09:30 ET exactly", () => {
    // 2026-06-02 09:30 EDT = 13:30Z
    expect(etHourOf("2026-06-02T13:30:00Z")).toBe(9);
    expect(etMinuteOf("2026-06-02T13:30:00Z")).toBe(30);
  });
});

describe("resolveDailyRange", () => {
  it("goes back enough calendar days to cover the requested trading-day limit", () => {
    const { start, end } = resolveDailyRange(90, "2026-06-15");
    expect(end).toBe("2026-06-15");
    // 90 trading days * 1.6 + 15 buffer ~= 159 calendar days back
    const startD = new Date(`${start}T12:00:00Z`);
    const endD = new Date(`${end}T12:00:00Z`);
    const daysBack = Math.round((endD.getTime() - startD.getTime()) / 86_400_000);
    expect(daysBack).toBeGreaterThanOrEqual(159);
  });

  it("defaults end to today when not provided", () => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const { end } = resolveDailyRange(10);
    expect(end).toBe(todayIso);
  });
});

describe("resolveIntradayRange", () => {
  it("non-overnight: start === end === date", () => {
    expect(resolveIntradayRange({ date: "2026-06-02" })).toEqual({ start: "2026-06-02", end: "2026-06-02" });
  });

  it("overnight: start is the prior calendar day", () => {
    expect(resolveIntradayRange({ date: "2026-06-02", overnight: true })).toEqual({
      start: "2026-06-01",
      end: "2026-06-02",
    });
  });

  it("overnight across a month boundary", () => {
    expect(resolveIntradayRange({ date: "2026-07-01", overnight: true })).toEqual({
      start: "2026-06-30",
      end: "2026-07-01",
    });
  });
});

describe("shapeDailyBars", () => {
  it("maps fields, sorts newest-first, and caps at limit", () => {
    const raw = [
      bar("2026-06-01T09:30:00Z", 100, 105, 99, 104, 1000),
      bar("2026-06-03T09:30:00Z", 102, 107, 101, 106, 1200),
      bar("2026-06-02T09:30:00Z", 101, 106, 100, 105, 1100),
    ];
    const out = shapeDailyBars(raw, 2);
    expect(out).toHaveLength(2);
    expect(out[0].date).toBe("2026-06-03");
    expect(out[1].date).toBe("2026-06-02");
    expect(out[0]).toMatchObject({ open: 102, high: 107, low: 101, close: 106, volume: 1200 });
  });

  it("omits volume key when null (no fabricated zero)", () => {
    const raw = [bar("2026-06-01T09:30:00Z", 1, 2, 0.5, 1.5, null)];
    const out = shapeDailyBars(raw, 10);
    expect(out[0]).not.toHaveProperty("volume");
  });
});

describe("shapeIntraBars", () => {
  it("sorts ascending by ts and drops volume (IntraBar has no volume field)", () => {
    const raw = [bar("2026-06-01T10:00:00Z"), bar("2026-06-01T09:00:00Z")];
    const out = shapeIntraBars(raw);
    expect(out[0].ts).toBe("2026-06-01T09:00:00Z");
    expect(out[1].ts).toBe("2026-06-01T10:00:00Z");
    expect(out[0]).not.toHaveProperty("volume");
  });
});

describe("filterOvernightWindow — 18:00 ET prev-day (inclusive) -> 09:30 ET session date (exclusive)", () => {
  const sessionDate = "2026-06-02"; // Tuesday, EDT (summer, UTC-4)

  it("includes a bar exactly at 18:00 ET prev day", () => {
    // 2026-06-01 18:00 EDT = 22:00Z
    const raw = [bar("2026-06-01T22:00:00Z")];
    expect(filterOvernightWindow(raw, sessionDate)).toHaveLength(1);
  });

  it("excludes a bar 5 minutes before 18:00 ET prev day", () => {
    const raw = [bar("2026-06-01T21:55:00Z")]; // 17:55 ET
    expect(filterOvernightWindow(raw, sessionDate)).toHaveLength(0);
  });

  it("includes a bar just before 09:30 ET session date", () => {
    const raw = [bar("2026-06-02T13:25:00Z")]; // 09:25 ET
    expect(filterOvernightWindow(raw, sessionDate)).toHaveLength(1);
  });

  it("excludes a bar exactly at 09:30 ET session date (window end is exclusive)", () => {
    const raw = [bar("2026-06-02T13:30:00Z")]; // 09:30 ET
    expect(filterOvernightWindow(raw, sessionDate)).toHaveLength(0);
  });

  it("excludes bars from two days before session date even if hour >= 18", () => {
    const raw = [bar("2026-05-31T22:00:00Z")]; // wrong prior day
    expect(filterOvernightWindow(raw, sessionDate)).toHaveLength(0);
  });

  it("does not truncate a full ~186-bar window to a small limit (range-accuracy contract)", () => {
    const raw: RawBar[] = [];
    // 2026-06-01 18:00 ET through 2026-06-02 09:25 ET at 5-min spacing
    let t = new Date("2026-06-01T22:00:00Z").getTime();
    const endT = new Date("2026-06-02T13:25:00Z").getTime();
    while (t <= endT) {
      raw.push(bar(new Date(t).toISOString()));
      t += 5 * 60_000;
    }
    const out = filterOvernightWindow(raw, sessionDate);
    expect(out.length).toBeGreaterThan(120); // would be silently truncated if capped at a 120 "limit"
  });

  it("preserves the true high/low across the full window (not just the most-recent slice)", () => {
    // extreme high sits early in the window, near 18:00 ET — a truncate-to-recent-N
    // implementation would drop it and understate the true overnight range.
    const raw = [
      bar("2026-06-01T22:00:00Z", 100, 999, 99, 100), // early-window extreme high
      bar("2026-06-02T13:00:00Z", 100, 101, 99, 100),
    ];
    const out = filterOvernightWindow(raw, sessionDate);
    const high = Math.max(...out.map((b) => b.high));
    expect(high).toBe(999);
  });
});

describe("filterHourWindow — fixed ET hour window on a given date", () => {
  it("London range 03:00-08:00 ET: includes boundary start, excludes boundary end", () => {
    const raw = [
      bar("2026-06-02T07:00:00Z"), // 03:00 ET — included
      bar("2026-06-02T11:59:00Z"), // 07:59 ET — included
      bar("2026-06-02T12:00:00Z"), // 08:00 ET — excluded (end exclusive)
      bar("2026-06-02T06:59:00Z"), // 02:59 ET — excluded (before start)
    ];
    const out = filterHourWindow(raw, "2026-06-02", 3, 8);
    expect(out).toHaveLength(2);
  });

  it("excludes bars on a different ET date even if the UTC hour matches", () => {
    const raw = [bar("2026-06-03T07:00:00Z")]; // 03:00 ET on 06-03, window is for 06-02
    expect(filterHourWindow(raw, "2026-06-02", 3, 8)).toHaveLength(0);
  });
});

describe("firstRthBar", () => {
  it("returns the first bar at or after 09:30 ET on the given date", () => {
    const raw = [
      bar("2026-06-02T13:35:00Z"), // 09:35 ET
      bar("2026-06-02T13:30:00Z"), // 09:30 ET exactly — this is the RTH open
      bar("2026-06-02T13:25:00Z"), // 09:25 ET — before RTH
    ];
    const out = firstRthBar(raw, "2026-06-02");
    expect(out?.ts).toBe("2026-06-02T13:30:00Z");
  });

  it("returns null when no bar in the window qualifies", () => {
    const raw = [bar("2026-06-02T13:00:00Z")]; // 09:00 ET, before RTH
    expect(firstRthBar(raw, "2026-06-02")).toBeNull();
  });
});
