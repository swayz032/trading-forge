import { describe, it, expect } from "vitest";
import {
  symbolToStreet,
  lifecycleToStation,
  formatBag,
  betSize,
  oddsOuttaHundred,
  unmappedAccountDisclosure,
  liveModeDataDisclosure,
} from "../../lib/slumhouse/translate.js";

describe("slumhouse translate", () => {
  describe("symbolToStreet", () => {
    it("maps micro symbols to friendly names", () => {
      expect(symbolToStreet("MES")).toBe("Mini-S&P");
      expect(symbolToStreet("MNQ")).toBe("Mini-Nasdaq");
      expect(symbolToStreet("MCL")).toBe("Mini-Oil");
    });
    it("maps Phase 5 mini symbols", () => {
      expect(symbolToStreet("ES")).toBe("S&P");
      expect(symbolToStreet("NQ")).toBe("Nasdaq");
    });
    it("handles lowercase", () => {
      expect(symbolToStreet("mes")).toBe("Mini-S&P");
    });
    it("returns input for unknown symbols", () => {
      expect(symbolToStreet("UNKNOWN")).toBe("UNKNOWN");
    });
    it("handles empty input", () => {
      expect(symbolToStreet("")).toBe("Unknown");
    });
  });

  describe("lifecycleToStation", () => {
    it("maps lifecycle_state to cooking station", () => {
      expect(lifecycleToStation("CANDIDATE")).toBe("Prep Station");
      expect(lifecycleToStation("TESTING")).toBe("On the Stove");
      expect(lifecycleToStation("SHADOW")).toBe("On the Stove");
      expect(lifecycleToStation("PAPER")).toBe("Taste Test");
      expect(lifecycleToStation("DEPLOY_READY")).toBe("Small Plates");
      expect(lifecycleToStation("PILOT")).toBe("Small Plates");
      expect(lifecycleToStation("DEPLOYED")).toBe("On the Menu");
      expect(lifecycleToStation("DECLINING")).toBe("On the Menu");
      expect(lifecycleToStation("GRAVEYARD")).toBe("Tossed");
    });
    it("returns Unknown on null/empty", () => {
      expect(lifecycleToStation(null)).toBe("Unknown");
      expect(lifecycleToStation("")).toBe("Unknown");
      expect(lifecycleToStation(undefined)).toBe("Unknown");
    });
  });

  describe("formatBag", () => {
    it("shows signed dollars with grouping", () => {
      expect(formatBag(2847.5)).toBe("+$2,848");
      expect(formatBag(-430.21)).toBe("−$430");
      expect(formatBag(0)).toBe("$0");
      expect(formatBag(1)).toBe("+$1");
      expect(formatBag(-1)).toBe("−$1");
      expect(formatBag(1234567)).toBe("+$1,234,567");
    });
    it("handles NaN/Infinity defensively", () => {
      expect(formatBag(NaN)).toBe("$0");
      expect(formatBag(Infinity)).toBe("$0");
      expect(formatBag(-Infinity)).toBe("$0");
    });
  });

  describe("betSize", () => {
    it("buckets contracts into small/medium/big", () => {
      expect(betSize(1)).toBe("small bet");
      expect(betSize(3)).toBe("small bet");
      expect(betSize(6)).toBe("small bet");
      expect(betSize(7)).toBe("medium bet");
      expect(betSize(9)).toBe("medium bet");
      expect(betSize(12)).toBe("medium bet");
      expect(betSize(13)).toBe("big bet");
      expect(betSize(50)).toBe("big bet");
    });
    it("defaults to small bet on 0/negative/NaN", () => {
      expect(betSize(0)).toBe("small bet");
      expect(betSize(-3)).toBe("small bet");
      expect(betSize(NaN)).toBe("small bet");
    });
  });

  describe("oddsOuttaHundred", () => {
    it("formats a [0,1] probability to N outta 100", () => {
      expect(oddsOuttaHundred(0.03)).toBe("3 outta 100");
      expect(oddsOuttaHundred(0.5)).toBe("50 outta 100");
      expect(oddsOuttaHundred(0)).toBe("0 outta 100");
      expect(oddsOuttaHundred(1)).toBe("100 outta 100");
    });
    it("clamps out-of-bound values", () => {
      expect(oddsOuttaHundred(-0.5)).toBe("0 outta 100");
      expect(oddsOuttaHundred(1.5)).toBe("100 outta 100");
    });
    it("handles NaN", () => {
      expect(oddsOuttaHundred(NaN)).toBe("0 outta 100");
    });
  });

  // ── FIX 2 + FIX 3 disclosure functions ────────────────────────────────────
  describe("unmappedAccountDisclosure", () => {
    it("returns a non-empty plain-English string", () => {
      const msg = unmappedAccountDisclosure();
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(10);
    });
    it("mentions account linking", () => {
      // Ensures the copy is actionable (tells the user WHY, not just '$0')
      const msg = unmappedAccountDisclosure();
      expect(msg.toLowerCase()).toMatch(/linked|connect|account/);
    });
  });

  describe("liveModeDataDisclosure", () => {
    it("returns a non-empty plain-English string", () => {
      const msg = liveModeDataDisclosure();
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(10);
    });
    it("mentions live trading and broker", () => {
      // Ensures the copy explains the source of truth in live mode
      const msg = liveModeDataDisclosure();
      expect(msg.toLowerCase()).toMatch(/live|broker/);
    });
  });
});
