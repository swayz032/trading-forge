/**
 * Tests for computeRollSpreadCost in roll-calendar-loader.ts.
 *
 * Covers the four required edge cases from the task spec plus
 * realistic scenarios for each symbol family.
 *
 * Parity contract: the function is pure (no I/O) and deterministic.
 * These tests serve as both correctness verification and documentation
 * of the boundary conditions that must be maintained for paper/backtest parity.
 */

import { describe, it, expect } from "vitest";
import { computeRollSpreadCost } from "./roll-calendar-loader.js";

// ─── Helper ──────────────────────────────────────────────────────────────────

function utc(isoDate: string, timeStr = "T12:00:00Z"): Date {
  return new Date(isoDate + timeStr);
}

// ─── Edge case 1: position opened AFTER the roll ─────────────────────────────

describe("computeRollSpreadCost — position opens after roll date", () => {
  it("returns 0 cost when entryTime is after the roll date", () => {
    // MES March 2026 roll: 2026-03-12
    // Position opens 2026-03-13 (day after roll) → already on new contract
    const result = computeRollSpreadCost(
      "MES",
      1,
      utc("2026-03-13"),  // entry AFTER roll
      utc("2026-04-01"),  // exit well after
    );
    expect(result.estimatedSpreadCost).toBe(0);
    expect(result.contractsRolled).toBe(0);
    expect(result.rollDates).toHaveLength(0);
  });
});

// ─── Edge case 2: position closes ON the roll date (boundary) ────────────────

describe("computeRollSpreadCost — position closes on the roll date", () => {
  it("applies spread cost when exitTime lands on the roll date midnight boundary", () => {
    // MES March 2026 roll: 2026-03-12T00:00:00Z
    // Position: entry 2026-03-10, exit exactly at 2026-03-12T00:00:00Z
    // Boundary contract: roll_date <= exitTime (the position crossed the roll)
    const result = computeRollSpreadCost(
      "MES",
      1,
      utc("2026-03-10"),        // entry before roll
      new Date("2026-03-12T00:00:00Z"),  // exit exactly at roll midnight
    );
    expect(result.estimatedSpreadCost).toBe(2);  // MES = $2/contract
    expect(result.rollDates).toContain("2026-03-12");
  });

  it("does NOT apply cost when exitTime is one millisecond before roll midnight", () => {
    // Position closes at 2026-03-11T23:59:59.999Z — does NOT cross the 2026-03-12 roll
    const result = computeRollSpreadCost(
      "MES",
      1,
      utc("2026-03-10"),
      new Date("2026-03-11T23:59:59.999Z"),
    );
    expect(result.estimatedSpreadCost).toBe(0);
    expect(result.rollDates).toHaveLength(0);
  });
});

// ─── Edge case 3: unknown symbol ─────────────────────────────────────────────

describe("computeRollSpreadCost — unknown symbol", () => {
  it("returns 0 cost for a symbol with no calendar entry", () => {
    const result = computeRollSpreadCost("AAPL", 2, utc("2024-01-01"), utc("2026-12-31"));
    expect(result.estimatedSpreadCost).toBe(0);
    expect(result.contractsRolled).toBe(0);
    expect(result.rollDates).toHaveLength(0);
  });

  it("is case-insensitive for symbol lookup", () => {
    // "mes" lowercase should still find MES calendar
    const lower = computeRollSpreadCost("mes", 1, utc("2026-03-10"), utc("2026-03-12"));
    const upper = computeRollSpreadCost("MES", 1, utc("2026-03-10"), utc("2026-03-12"));
    expect(lower.estimatedSpreadCost).toBe(upper.estimatedSpreadCost);
  });
});

// ─── Edge case 4: multiple rolls crossed ─────────────────────────────────────

describe("computeRollSpreadCost — multiple rolls crossed", () => {
  it("sums spread cost across all crossed roll dates", () => {
    // MES quarterly rolls: 2026-03-12 and 2026-06-11
    // 1 contract × ($2 + $2) = $4
    const result = computeRollSpreadCost(
      "MES",
      1,
      utc("2026-01-01"),   // entry before first roll
      utc("2026-07-01"),   // exit after second roll
    );
    expect(result.estimatedSpreadCost).toBe(4);
    expect(result.rollDates).toContain("2026-03-12");
    expect(result.rollDates).toContain("2026-06-11");
    expect(result.rollDates).toHaveLength(2);
  });

  it("scales spread cost by number of contracts", () => {
    // 3 contracts × $2 per MES roll × 2 rolls = $12
    const result = computeRollSpreadCost(
      "MES",
      3,
      utc("2026-01-01"),
      utc("2026-07-01"),
    );
    expect(result.estimatedSpreadCost).toBe(12);
    expect(result.contractsRolled).toBe(3);
  });

  it("uses abs(contracts) so short positions pay the same spread", () => {
    // Short position: -2 contracts; abs(-2) = 2
    const long = computeRollSpreadCost("MES", 2, utc("2026-01-01"), utc("2026-04-01"));
    const short = computeRollSpreadCost("MES", -2, utc("2026-01-01"), utc("2026-04-01"));
    expect(long.estimatedSpreadCost).toBe(short.estimatedSpreadCost);
    expect(short.contractsRolled).toBe(2);
  });
});

// ─── Realistic scenario: manual trace from task spec ─────────────────────────

describe("computeRollSpreadCost — manual trace (task spec)", () => {
  it("ES: position opens 2026-03-10, closes 2026-04-15, 1 contract → $8", () => {
    // Roll: ES 2026-03-12 ($8/contract)
    const result = computeRollSpreadCost(
      "ES",
      1,
      utc("2026-03-10"),
      utc("2026-04-15"),
    );
    expect(result.estimatedSpreadCost).toBe(8);
    expect(result.rollDates).toContain("2026-03-12");
  });

  it("ES: 2 contracts → $16", () => {
    const result = computeRollSpreadCost(
      "ES",
      2,
      utc("2026-03-10"),
      utc("2026-04-15"),
    );
    expect(result.estimatedSpreadCost).toBe(16);
    expect(result.contractsRolled).toBe(2);
  });
});

// ─── No roll in window ────────────────────────────────────────────────────────

describe("computeRollSpreadCost — no roll in hold window", () => {
  it("returns 0 when position is entirely between roll dates", () => {
    // MES quarterly rolls: 2026-03-12 and 2026-06-11
    // Position: 2026-04-01 to 2026-04-30 — no roll in this window
    const result = computeRollSpreadCost(
      "MES",
      1,
      utc("2026-04-01"),
      utc("2026-04-30"),
    );
    expect(result.estimatedSpreadCost).toBe(0);
    expect(result.rollDates).toHaveLength(0);
  });
});

// ─── CL monthly rolls ────────────────────────────────────────────────────────

describe("computeRollSpreadCost — CL (crude, monthly)", () => {
  it("CL: position crosses March 2026 roll, 1 contract → $15", () => {
    // CL roll 2026-03-24
    const result = computeRollSpreadCost(
      "CL",
      1,
      utc("2026-03-20"),
      utc("2026-03-25"),
    );
    expect(result.estimatedSpreadCost).toBe(15);
    expect(result.rollDates).toContain("2026-03-24");
  });

  it("MCL: same roll date as CL but lower spread ($4/contract)", () => {
    const result = computeRollSpreadCost(
      "MCL",
      1,
      utc("2026-03-20"),
      utc("2026-03-25"),
    );
    expect(result.estimatedSpreadCost).toBe(4);
  });
});

// ─── GC bi-monthly rolls ─────────────────────────────────────────────────────

describe("computeRollSpreadCost — GC (gold, bi-monthly)", () => {
  it("GC: position crosses February 2026 roll, 1 contract → $12", () => {
    // GC roll 2026-02-23
    const result = computeRollSpreadCost(
      "GC",
      1,
      utc("2026-02-20"),
      utc("2026-02-24"),
    );
    expect(result.estimatedSpreadCost).toBe(12);
    expect(result.rollDates).toContain("2026-02-23");
  });
});

// ─── contracts = 0 (defensive) ───────────────────────────────────────────────

describe("computeRollSpreadCost — 0 contracts (defensive)", () => {
  it("returns 0 cost with 0 contracts even if roll is crossed", () => {
    const result = computeRollSpreadCost(
      "MES",
      0,
      utc("2026-03-10"),
      utc("2026-03-15"),
    );
    expect(result.estimatedSpreadCost).toBe(0);
    expect(result.contractsRolled).toBe(0);
  });
});
