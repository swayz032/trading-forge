/**
 * frankenstein-service-deterministic-bars.test.ts — capital-safety-compliance-gates
 * wave (2026-07-17), MED fix.
 *
 * Proves fetchBarsFromTrades() (the A4 Frankenstein gate's trade->bar
 * synthesizer) no longer draws its OHLC spread from unseeded Math.random():
 *
 *   1. Same backtestId (same underlying trades) -> byte-identical bars across
 *      two independent calls (replay-determinism for a fail-closed capital-
 *      safety gate — re-running the same inputs must not silently flip the
 *      A4 passed/failed verdict).
 *   2. Different backtestId -> a different bar series (sanity: the fix did
 *      not degenerate into a constant/identical-everywhere output).
 *   3. Structural regression guard: no bare Math.random() anywhere in
 *      frankenstein-service.ts (mirrors the equivalent M2 guard in
 *      deterministic-rng-replay.test.ts for paper-execution-service.ts).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// frankenstein-service.ts imports `db` from "../db/index.js" and `logger`
// from "../index.js" (which boots the full Express chain if not mocked) —
// same minimal-mock pattern as frankenstein-lifecycle-gate.test.ts.
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type TradeRow = { entryPrice: string; exitPrice: string | null; direction: string };

// Each test sets this to control what the mocked db.select(...).from(...)
// .where(...).orderBy(...) chain resolves to, keyed by backtestId so a single
// mock implementation can serve multiple distinct fetchBarsFromTrades() calls
// within one test (the real query filters by backtestId via .where()).
let tradesByBacktestId: Record<string, TradeRow[]> = {};

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          // The real query chain is .where(eq(...)).orderBy(...) with no
          // .limit() — resolve directly off orderBy(). We can't introspect
          // Drizzle's `eq()` column/value pair reliably here, so instead we
          // return a thin object whose orderBy() reads a module-level
          // "current" backtestId set by the test via a side-channel below.
          orderBy: vi.fn(() => Promise.resolve(tradesByBacktestId[__currentBacktestId] ?? [])),
        })),
      })),
    })),
  },
}));

vi.mock("../db/schema.js", () => ({
  backtestTrades: {
    backtestId: "backtestId",
    entryPrice: "entryPrice",
    exitPrice: "exitPrice",
    direction: "direction",
    entryTime: "entryTime",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => {
    // Side-channel: capture the backtestId being queried so the mocked
    // orderBy() above can look up the right fixture row set.
    __currentBacktestId = val as string;
    return { val };
  }),
}));

// eslint-disable-next-line prefer-const
let __currentBacktestId = "";

const { fetchBarsFromTrades } = await import("../services/frankenstein-service.js");

function makeTrades(n: number, priceBase: number): TradeRow[] {
  return Array.from({ length: n }, (_, i) => ({
    entryPrice: String(priceBase + i),
    exitPrice: String(priceBase + i + 2),
    direction: i % 2 === 0 ? "long" : "short",
  }));
}

describe("fetchBarsFromTrades — deterministic seeding (MED fix)", () => {
  it("produces byte-identical bars across two calls with the same backtestId", async () => {
    tradesByBacktestId = { "bt-det-1": makeTrades(10, 5000) };

    const first = await fetchBarsFromTrades("bt-det-1");
    const second = await fetchBarsFromTrades("bt-det-1");

    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  it("produces a different bar series for a different backtestId (not degenerate)", async () => {
    tradesByBacktestId = {
      "bt-det-a": makeTrades(10, 5000),
      "bt-det-b": makeTrades(10, 5000), // same price shape, different id
    };

    const a = await fetchBarsFromTrades("bt-det-a");
    const b = await fetchBarsFromTrades("bt-det-b");

    expect(a.length).toBe(b.length);
    // Closes are identical (same price interpolation math) but the
    // synthesized open/high/low spread must differ per backtestId.
    const opensA = a.map((bar) => bar[0]);
    const opensB = b.map((bar) => bar[0]);
    expect(opensA).not.toEqual(opensB);
  });

  it("open/high/low stay within the documented ±0.1% spread of close on every bar", async () => {
    tradesByBacktestId = { "bt-det-bounds": makeTrades(10, 4500) };
    const bars = await fetchBarsFromTrades("bt-det-bounds");

    for (const [open, high, low, close] of bars) {
      const spread = close * 0.001;
      expect(high).toBeGreaterThanOrEqual(Math.max(open, close));
      expect(low).toBeLessThanOrEqual(Math.min(open, close));
      expect(Math.abs(open - close)).toBeLessThanOrEqual(spread / 2 + 1e-9);
      expect(high - Math.max(open, close)).toBeLessThanOrEqual(spread + 1e-9);
      expect(Math.min(open, close) - low).toBeLessThanOrEqual(spread + 1e-9);
    }
  });

  it("structural regression guard: no bare Math.random() call in frankenstein-service.ts CODE", () => {
    const src = readFileSync(
      resolve(import.meta.dirname, "../services/frankenstein-service.ts"),
      "utf8",
    );
    // Strip comment lines (this file's own doc-comments reference the old
    // Math.random() call in prose, e.g. "previously drew from unseeded
    // Math.random()") — the guard is about live CODE, not documentation.
    const codeLines = src
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
      })
      .join("\n");
    const bareMathRandom = codeLines.match(/Math\.random\(\)/g);
    expect(bareMathRandom).toBeNull();
  });
});
